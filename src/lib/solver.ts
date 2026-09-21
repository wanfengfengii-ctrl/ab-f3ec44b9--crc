// GF(2) 精确审计器
//
// 对给定候选（宽度 w、方向、多项式），每条样本 s 的末态寄存器是 init 的仿射线性函数：
//   final_s = M_s · init XOR c_s        （M_s 由逐位递推的 w+1 次差分得到，见 crc.ts）
// 观测约束 final_s XOR xorOut = obs_s 是关于 2w 个未知位（init、xorOut 各 w 位）的
// GF(2) 线性方程，每输出位一行。通过高斯-若尔当消元求秩并判定一致性：
//   - 出现 0=1 矛盾行    => 无解
//   - 零化度 d=0         => 唯一解
//   - 零化度 d>0         => 恰有 2^d 组解（精确计数，绝不枚举 init/xorOut）
//
// 主元按“字典序显著性”顺序（init 高位→低位，再 xorOut 高位→低位）选取；
// 再用零空间基按主元位对特解做贪心最小化，得到字典序最小见证，
// 次小见证 = 最小见证 XOR 主元位最不显著的零空间基向量。

import { crcFinalRegister, crcWithTrace, linearMap, type CrcShape } from './crc';
import type { CandidateResult, RegisterTrace, Witness } from './types';

export interface AuditProgress {
  /** 已完成候选数（用于取消检查点） */
  done: number;
  total: number;
}

/** 消元结果（内部） */
interface ReducedSystem {
  consistent: boolean;
  rank: number;
  /** 每个主元行对应的主元列（按显著性顺序加入） */
  pivotCols: number[];
  /** RREF 主元行：系数位掩码（位 k 对应变量列 k） */
  rowMasks: number[];
  /** RREF 主元行右端 */
  rowRhs: number[];
  /** 自由变量列（按显著性从高到低） */
  freeCols: number[];
  n: number;
}

/**
 * 对一组样本约束做 RREF。
 * @param rows 每条 [系数掩码, 右端位]
 * @param n 变量个数（2w）
 * @param columnOrder 显著性从高到低的列序（主元优先选择顺序）
 */
function rref(rows: Array<[number, number]>, n: number, columnOrder: number[]): ReducedSystem {
  const masks = new Uint32Array(rows.length);
  const rhs = new Uint8Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    masks[i] = rows[i][0];
    rhs[i] = rows[i][1];
  }

  const pivotCols: number[] = [];
  const pivotRows: number[] = []; // 主元所在行号

  let cursor = 0;
  for (const col of columnOrder) {
    const bit = 1 << col;
    let pick = -1;
    for (let r = cursor; r < masks.length; r++) {
      if (masks[r] & bit) {
        pick = r;
        break;
      }
    }
    if (pick === -1) continue;
    // 交换到 cursor
    if (pick !== cursor) {
      const tm = masks[cursor];
      masks[cursor] = masks[pick];
      masks[pick] = tm;
      const tr = rhs[cursor];
      rhs[cursor] = rhs[pick];
      rhs[pick] = tr;
    }
    // 全消元（RREF）：从其余所有行消去该列（含更早的主元行）
    const pm = masks[cursor];
    const pv = rhs[cursor];
    for (let r = 0; r < masks.length; r++) {
      if (r !== cursor && (masks[r] & bit)) {
        masks[r] ^= pm;
        rhs[r] ^= pv;
      }
    }
    pivotCols.push(col);
    pivotRows.push(cursor);
    cursor++;
  }

  // 关键：主元行必须在全部消元结束后读取，否则会拿到被后续主元改动前的过期快照
  const rowMasks = pivotRows.map((r) => masks[r] >>> 0);
  const rowRhs = pivotRows.map((r) => rhs[r]);

  // 一致性：非主元行（含主元行之后的残余行）系数全零时右端必须为 0
  let consistent = true;
  for (let r = 0; r < masks.length; r++) {
    if (masks[r] === 0 && rhs[r] === 1) {
      consistent = false;
      break;
    }
  }

  const pivotSet = new Set(pivotCols);
  const freeCols: number[] = [];
  for (const col of columnOrder) {
    if (!pivotSet.has(col)) freeCols.push(col);
  }

  return { consistent, rank: pivotCols.length, pivotCols, rowMasks, rowRhs, freeCols, n };
}

/** 依据 RREF：自由位赋值（freeAssign 与 freeCols 等长），构造完整解位向量 */
function buildSolution(sys: ReducedSystem, freeAssign: Uint8Array): Uint8Array {
  const x = new Uint8Array(sys.n);
  for (let i = 0; i < sys.freeCols.length; i++) x[sys.freeCols[i]] = freeAssign[i];
  for (let r = 0; r < sys.pivotCols.length; r++) {
    const m = sys.rowMasks[r];
    let v = sys.rowRhs[r];
    // x_pivot = rhs XOR Σ(系数·自由值)；主元自身位在 RREF 中是唯一的主元行 1，跳过它
    for (let k = 0; k < sys.n; k++) {
      if (k !== sys.pivotCols[r] && (m & (1 << k))) v ^= x[k];
    }
    x[sys.pivotCols[r]] = v;
  }
  return x;
}

function xToMask(x: Uint8Array): number {
  let m = 0;
  for (let k = 0; k < x.length; k++) if (x[k]) m |= 1 << k;
  return m >>> 0;
}

/**
 * 零空间基按“主元位（leading bit，位号越小越显著）”正交化为行阶梯：
 * 任一基向量最显著的 1 位唯一。之后对特解从显著到不显著贪心翻 0，
 * 即得仿射解空间上的字典序最小向量；次小解 = 最小解 XOR 主元位最不显著的基向量。
 */
function canonicalWitnesses(
  particular: Uint8Array,
  nullspace: Uint8Array[],
  n: number,
): { least: number; second: number | null } {
  const lead = new Map<number, number>();
  for (const vec of nullspace) {
    let v = xToMask(vec);
    while (v) {
      const l = lowestSetBit(v); // 位号最小 = 最显著的 1
      const b = lead.get(l);
      if (b === undefined) {
        lead.set(l, v);
        break;
      }
      v ^= b;
    }
  }
  let least = xToMask(particular);
  // 从显著到不显著：该位可翻转且当前为 1 时翻成 0（更不显著基向量不会再影响此位）
  for (let pos = 0; pos < n; pos++) {
    const b = lead.get(pos);
    if (b !== undefined && (least & (1 << pos))) least ^= b;
  }
  let second: number | null = null;
  let leastSignificantPos = -1;
  for (const pos of lead.keys()) {
    if (pos > leastSignificantPos) leastSignificantPos = pos;
  }
  if (leastSignificantPos >= 0) second = (least ^ lead.get(leastSignificantPos)!) >>> 0;
  return { least, second };
}

function lowestSetBit(v: number): number {
  return 31 - Math.clz32(v & -v);
}

/** 解位掩码（位 c = 列 c）→ {init, xorOut}：列 0..w-1 为 init 高位→低位，列 w..2w-1 为 xorOut */
export function maskToWitness(mask: number, w: 8 | 16): Witness {
  let init = 0;
  let xorOut = 0;
  for (let c = 0; c < 2 * w; c++) {
    if (!(mask & (1 << c))) continue;
    if (c < w) init |= 1 << (w - 1 - c);
    else xorOut |= 1 << (2 * w - 1 - c);
  }
  return { init: init >>> 0, xorOut: xorOut >>> 0 };
}

export interface AuditSample {
  bytes: Uint8Array;
  observed: number;
}

/** 对单个候选做完整审计（可注入 shouldCancel 检查点） */
export function auditCandidate(
  cfg: CrcShape,
  samples: AuditSample[],
  width: 8 | 16,
): {
  verdict: 'no-solution' | 'unique' | 'ambiguous';
  solutionCount: string;
  rank: number;
  nullity: number;
  witness: Witness | null;
  secondWitness: Witness | null;
} {
  const w = width;
  const n = 2 * w;
  const mask = w === 8 ? 0xff : 0xffff;

  // 列显著性顺序：init 高位→低位（列 0..w-1），xorOut 高位→低位（列 w..2w-1）
  const columnOrder: number[] = [];
  for (let c = 0; c < n; c++) columnOrder.push(c);

  const rows: Array<[number, number]> = [];
  for (const s of samples) {
    const { zero, columns } = linearMap(s.bytes, cfg);
    const obs = s.observed & mask;
    // 方程每输出位 j： Σ_k M[j,k]·init_k  XOR  xorOut_j = obs_j XOR c_j
    for (let j = 0; j < w; j++) {
      let coeff = 0;
      // init 部分：列 c = 显著性位置，对应 init 位 k = w-1-c
      for (let c = 0; c < w; c++) {
        const k = w - 1 - c;
        if ((columns[k] >> j) & 1) coeff |= 1 << c;
      }
      // xorOut 部分：输出位 j 对应变量列 w + (w-1-j)
      coeff |= 1 << (w + (w - 1 - j));
      const b = ((obs >> j) & 1) ^ ((zero >> j) & 1);
      rows.push([coeff >>> 0, b]);
    }
  }

  const sys = rref(rows, n, columnOrder);
  if (!sys.consistent) {
    return { verdict: 'no-solution', solutionCount: '0', rank: sys.rank, nullity: sys.freeCols.length, witness: null, secondWitness: null };
  }

  const nullity = sys.freeCols.length;
  const solutionCount = (1n << BigInt(nullity)).toString();

  // 特解（自由位全 0）+ 零空间基（自由位逐位置 1 的解与特解之差），再做字典序归一化
  const particular = buildSolution(sys, new Uint8Array(nullity));
  const nullspace: Uint8Array[] = [];
  for (let f = 0; f < nullity; f++) {
    const assign = new Uint8Array(nullity);
    assign[f] = 1;
    const other = buildSolution(sys, assign);
    const diff = new Uint8Array(n);
    for (let k = 0; k < n; k++) diff[k] = other[k] ^ particular[k];
    nullspace.push(diff);
  }
  const { least, second } = canonicalWitnesses(particular, nullspace, n);
  const witness = maskToWitness(least, w);
  const secondWitness = second === null ? null : maskToWitness(second, w);

  return {
    verdict: nullity === 0 ? 'unique' : 'ambiguous',
    solutionCount,
    rank: sys.rank,
    nullity,
    witness,
    secondWitness,
  };
}

/** 生成逐样本轨迹并逐条核对最终校验值 */
export function buildTraces(
  cfg: CrcShape,
  samples: AuditSample[],
  witness: Witness,
  width: 8 | 16,
): { traces: RegisterTrace[]; matched: boolean[] } {
  const mask = width === 8 ? 0xff : 0xffff;
  const traces: RegisterTrace[] = [];
  const matched: boolean[] = [];
  for (const s of samples) {
    const t = crcWithTrace(s.bytes, cfg, witness.init, witness.xorOut);
    traces.push(t);
    matched.push((t.checksum & mask) === (s.observed & mask));
  }
  return { traces, matched };
}

/** 复核：用见证重算全部样本（独立于反演路径，防止结论自证） */
export function verifyWitness(cfg: CrcShape, samples: AuditSample[], witness: Witness, width: 8 | 16): boolean[] {
  const mask = width === 8 ? 0xff : 0xffff;
  return samples.map((s) => (((crcFinalRegister(s.bytes, cfg, witness.init) ^ witness.xorOut) & mask) === (s.observed & mask)));
}
