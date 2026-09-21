import { affineMap } from './crc';
import { maskFor, parseHex, parsePayload } from './hex';
import type { CandidateConfig, CandidateVerdict, Sample } from './types';

/**
 * 对单个候选，把所有样本堆叠成 GF(2) 线性方程组后精确求解。
 *
 * 未知量 x 的位布局：高 w 位为 init（init_j 位于第 w+j 列），
 * 低 w 位为 xorOut（xorOut_k 位于第 k 列）——因此 x 的 2w 位无符号
 * 数值序与 (init, xorOut) 字典序一致，可直接求字典序最小见证。
 *
 * 每个样本 i 由逐位递推的仿射表示 register_i = M_i·init ⊕ d_i，
 * 观测值满足 M_i·init ⊕ xorOut = obs_i ⊕ d_i，即 w 个线性方程。
 *
 * 因此绝不枚举 init/xorOut（枚举空间最大 2^32）：
 * 用大位集行做高斯-若当消元，相容性 → 无解；零空间维数 d → 解数恰为 2^d。
 */

const RHS = 32; // 系数位 0..2w-1（w≤16）；第 32 位放右端项

interface System {
  rows: bigint[];
  unknowns: number;
}

function buildSystem(
  candidate: CandidateConfig,
  samples: Sample[],
): { system?: System; reason?: string } {
  const w = candidate.width;
  const mask = maskFor(w);
  let poly: bigint;
  try {
    poly = parseHex(candidate.poly) & mask;
  } catch {
    return { reason: `候选 ${candidate.id} 多项式非法` };
  }
  const rows: bigint[] = [];

  for (const sample of samples) {
    let bytes: Uint8Array;
    let obs: bigint;
    try {
      bytes = parsePayload(sample.payload);
      obs = parseHex(sample.observed);
    } catch {
      return { reason: `样本 ${sample.id} 十六进制非法` };
    }
    if (obs > mask) {
      return { reason: `样本 ${sample.id} 的观测值超出 ${w} 位宽度` };
    }
    const { columns, d } = affineMap(w, poly, candidate.direction, bytes);
    const rhsAll = obs ^ d;
    for (let k = 0; k < w; k++) {
      let row = 0n;
      for (let j = 0; j < w; j++) {
        if ((columns[j] >> BigInt(k)) & 1n) row |= 1n << BigInt(w + j);
      }
      if ((rhsAll >> BigInt(k)) & 1n) row |= 1n << BigInt(RHS);
      row |= 1n << BigInt(k); // xorOut 第 k 位系数恒为 1
      rows.push(row);
    }
  }
  return { system: { rows, unknowns: 2 * w } };
}

interface RrefResult {
  rank: number;
  consistent: boolean;
  /** pivot 列 -> 约化后行（系数中仅该 pivot 位为 1） */
  pivotRows: { col: number; row: bigint }[];
  freeCols: number[];
}

function rref(sys: System): RrefResult {
  const rows = sys.rows.slice();
  const pivotCols: number[] = [];
  let r = 0;
  for (let col = 0; col < sys.unknowns; col++) {
    let found = -1;
    for (let i = r; i < rows.length; i++) {
      if ((rows[i] >> BigInt(col)) & 1n) {
        found = i;
        break;
      }
    }
    if (found === -1) continue;
    [rows[r], rows[found]] = [rows[found], rows[r]];
    for (let i = 0; i < rows.length; i++) {
      if (i !== r && ((rows[i] >> BigInt(col)) & 1n)) rows[i] ^= rows[r];
    }
    pivotCols.push(col);
    r++;
  }
  // 全部消元完成后再读取主元行（早期主元行可能被后续消元修改）
  const pivotRows = pivotCols.map((col, idx) => ({ col, row: rows[idx] }));
  const pivotSet = new Set(pivotCols);
  const freeCols: number[] = [];
  for (let col = 0; col < sys.unknowns; col++) {
    if (!pivotSet.has(col)) freeCols.push(col);
  }
  const rhsMask = 1n << BigInt(RHS);
  const coeffMask = (1n << BigInt(sys.unknowns)) - 1n;
  const consistent = !rows.some((row) => (row & coeffMask) === 0n && (row & rhsMask) !== 0n);
  return { rank: r, consistent, pivotRows, freeCols };
}

/**
 * 零空间基再约化为约化行阶梯形：每个基向量拥有唯一的最高位（主元），
 * 且主元位不出现在任何其它基向量中。插入式维护该不变量。
 * 返回按最高位降序排列的基，供字典序贪心使用。
 */
function msbIndex(v: bigint): number {
  return v.toString(2).length - 1;
}

function reduceNullspace(input: bigint[]): bigint[] {
  let basis: bigint[] = [];
  for (const initial of input) {
    let v = initial;
    // 用已有主元清掉 v 中的对应位（从高主元向低）
    for (const b of basis) {
      if ((v >> BigInt(msbIndex(b))) & 1n) v ^= b;
    }
    if (v === 0n) continue;
    const lead = msbIndex(v);
    // v 已不含任何已有主元位；反过来把新主元位从旧向量中清掉，
    // 且不会重新引入旧主元（v 在旧主元处全为 0）。
    basis = basis.map((b) => (((b >> BigInt(lead)) & 1n) ? b ^ v : b));
    basis.push(v);
  }
  return basis.filter((x) => x !== 0n).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

export interface SolveOutcome {
  verdict: CandidateVerdict;
  /** 无法参与求解时的原因（如观测值超出候选宽度） */
  note?: string;
}

export function solveCandidate(candidate: CandidateConfig, samples: Sample[]): SolveOutcome {
  const w = candidate.width;
  const built = buildSystem(candidate, samples);
  if (!built.system) {
    return { verdict: { kind: 'none' }, note: built.reason };
  }
  const red = rref(built.system);
  if (!red.consistent) return { verdict: { kind: 'none' } };

  // 特解：自由位取 0，pivot 位取约化行 RHS。
  let x0 = 0n;
  for (const { col, row } of red.pivotRows) {
    if ((row >> BigInt(RHS)) & 1n) x0 |= 1n << BigInt(col);
  }

  const nullity = red.freeCols.length;
  const solutionCount = 1n << BigInt(nullity);
  if (nullity === 0) {
    return { verdict: { kind: 'unique', ...splitX(x0, w), nullity: 0, solutionCount } };
  }

  // 零空间基：每个自由位 f 对应向量（f 位为 1，pivot 位按 RREF 行反推）。
  const raw: bigint[] = red.freeCols.map((f) => {
    let vec = 1n << BigInt(f);
    for (const { col, row } of red.pivotRows) {
      if ((row >> BigInt(f)) & 1n) vec |= 1n << BigInt(col);
    }
    return vec;
  });
  // 按最高位降序排列且彼此约化；最高位贪心翻转即得字典序最小解。
  const basis = reduceNullspace(raw);
  let xMin = x0;
  for (let i = 0; i < basis.length; i++) {
    const lead = basis[i].toString(2).length - 1;
    if ((xMin >> BigInt(lead)) & 1n) xMin ^= basis[i];
  }
  // 次小见证 = 最小解 XOR 零空间中最高位最低的非零向量。
  const lowest = basis[basis.length - 1];
  const xSecond = xMin ^ lowest;

  return {
    verdict: {
      kind: 'ambiguous',
      ...splitX(xMin, w),
      nullity,
      solutionCount,
      second: splitX(xSecond, w),
    },
  };
}

function splitX(x: bigint, w: number): { init: bigint; xorOut: bigint } {
  const mask = maskFor(w as 8 | 16);
  return { init: (x >> BigInt(w)) & mask, xorOut: x & mask };
}
