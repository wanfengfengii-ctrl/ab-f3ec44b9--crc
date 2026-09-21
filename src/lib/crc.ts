import type { ShiftDirection, StepTrace } from './types';
import { maskFor } from './hex';

/**
 * 逐位 CRC 递推（规格的唯一权威实现）：
 *   每拍按方向取寄存器端位 endBit，与本拍输入位 inputBit 异或得到 mixed；
 *   寄存器向该方向移一位；mixed === 1 时再异或多项式；
 *   全部字节处理完后 checksum = register ^ xorOut。
 * - msb-first：端位取 MSB，左移；字节输入位从高位到低位；
 * - lsb-first：端位取 LSB，右移；字节输入位从低位到高位。
 * 多项式按候选配置逐字参与异或，不做隐式位序翻转。
 */
export interface RunOptions {
  width: 8 | 16;
  poly: bigint;
  direction: ShiftDirection;
  bytes: Uint8Array;
  init: bigint;
  xorOut?: bigint;
  trace?: boolean;
}

export interface RunResult {
  register: bigint;
  checksum: bigint;
  steps: StepTrace[];
}

export function runCrc(opts: RunOptions): RunResult {
  const { width, poly, direction, bytes, init } = opts;
  const xorOut = opts.xorOut ?? 0n;
  const mask = maskFor(width);
  const endShift = BigInt(width - 1);
  let reg = init & mask;
  const steps: StepTrace[] = [];

  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex++) {
    const byte = bytes[byteIndex];
    for (let k = 0; k < 8; k++) {
      const bitIndex = direction === 'msb-first' ? 7 - k : k;
      const inputBit: 0 | 1 = (byte >> bitIndex) & 1 ? 1 : 0;
      const regBefore = reg;
      let endBit: 0 | 1;
      let mixed: 0 | 1;
      if (direction === 'msb-first') {
        endBit = Number((reg >> endShift) & 1n) as 0 | 1;
        mixed = ((endBit ^ inputBit) & 1) as 0 | 1;
        reg = ((reg << 1n) & mask);
      } else {
        endBit = Number(reg & 1n) as 0 | 1;
        mixed = ((endBit ^ inputBit) & 1) as 0 | 1;
        reg = reg >> 1n;
      }
      const xored = mixed === 1;
      if (xored) reg ^= poly;

      if (opts.trace) {
        steps.push({
          byteIndex,
          bitIndex,
          regBefore,
          inputBit,
          endBit,
          xored,
          regAfter: reg,
        });
      }
    }
  }

  return { register: reg, checksum: reg ^ xorOut, steps };
}

/**
 * 同一份载荷下终态关于 init 的 GF(2) 仿射表示：register = M·init ⊕ d。
 * M 以 w 个 w 位列向量（bigint）给出：M 的第 j 列 = f(e_j) ⊕ f(0)。
 * 同步逐拍演化 M 的各列（输入位只进入常数项 d），无需跑 w+1 遍载荷。
 */
export interface AffineMap {
  /** 列向量：columns[j] 为 init 第 j 位取 1 时对终态的线性贡献 */
  columns: bigint[];
  /** init = 0 时的终态 */
  d: bigint;
}

export function affineMap(
  width: 8 | 16,
  poly: bigint,
  direction: ShiftDirection,
  bytes: Uint8Array,
): AffineMap {
  const mask = maskFor(width);
  const endShift = BigInt(width - 1);
  const columns: bigint[] = [];
  for (let j = 0; j < width; j++) columns.push(1n << BigInt(j));
  let d = 0n;

  for (const byte of bytes) {
    for (let k = 0; k < 8; k++) {
      const bitIndex = direction === 'msb-first' ? 7 - k : k;
      const inputBit = (byte >> bitIndex) & 1;
      for (let j = 0; j < width; j++) {
        let v = columns[j];
        const end =
          direction === 'msb-first'
            ? Number((v >> endShift) & 1n)
            : Number(v & 1n);
        v = direction === 'msb-first' ? (v << 1n) & mask : v >> 1n;
        if (end) v ^= poly;
        columns[j] = v;
      }
      const endD =
        direction === 'msb-first'
          ? Number((d >> endShift) & 1n)
          : Number(d & 1n);
      d = direction === 'msb-first' ? (d << 1n) & mask : d >> 1n;
      if ((endD ^ inputBit) === 1) d ^= poly;
    }
  }

  return { columns, d };
}
