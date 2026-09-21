// CRC 逐位递推（不含 xorOut 的纯寄存器部分是 GF(2) 线性映射）
//
// 左移（MSB-first）：每拍 mixed = 寄存器最高位 XOR 输入位；
//   reg = ((reg << 1) & mask) XOR (mixed ? poly : 0)
// 右移（LSB-first）：每拍 mixed = 寄存器最低位 XOR 输入位；
//   reg = (reg >>> 1) XOR (mixed ? poly : 0)
// 最终校验值 = 末态寄存器 XOR xorOut。

import type { CandidateConfig, RegisterTrace, TraceStep } from './types';
import { widthMask } from './hex';

export interface CrcShape {
  width: 8 | 16;
  direction: 'left' | 'right';
  poly: number;
}

/** 仅计算载荷喂完后的寄存器（init 的仿射线性函数） */
export function crcFinalRegister(bytes: Uint8Array, cfg: CrcShape, init: number): number {
  const mask = widthMask(cfg.width);
  const top = cfg.width - 1;
  let reg = init & mask;
  if (cfg.direction === 'left') {
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      for (let bit = 7; bit >= 0; bit--) {
        const inBit = (b >> bit) & 1;
        const mixed = ((reg >> top) & 1) ^ inBit;
        reg = ((reg << 1) & mask) ^ (mixed ? cfg.poly : 0);
      }
    }
  } else {
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      for (let bit = 0; bit < 8; bit++) {
        const inBit = (b >> bit) & 1;
        const mixed = (reg & 1) ^ inBit;
        reg = (reg >>> 1) ^ (mixed ? cfg.poly : 0);
      }
    }
  }
  return reg >>> 0;
}

/** 最终校验值 = 末态寄存器 XOR xorOut */
export function crcChecksum(bytes: Uint8Array, cfg: CrcShape, init: number, xorOut: number): number {
  return (crcFinalRegister(bytes, cfg, init) ^ xorOut) >>> 0;
}

/** 带逐位轨迹的计算，供 UI 逐样本核对中间寄存器 */
export function crcWithTrace(
  bytes: Uint8Array,
  cfg: CrcShape,
  init: number,
  xorOut: number,
): RegisterTrace {
  const mask = widthMask(cfg.width);
  const top = cfg.width - 1;
  let reg = init & mask;
  const steps: TraceStep[] = [];
  const afterByte: number[] = [];

  const step = (byteIndex: number, bitIndex: number, inBit: 0 | 1) => {
    let mixed: 0 | 1;
    let shifted: number;
    if (cfg.direction === 'left') {
      mixed = (((reg >> top) & 1) ^ inBit) as 0 | 1;
      shifted = (reg << 1) & mask;
    } else {
      mixed = ((reg & 1) ^ inBit) as 0 | 1;
      shifted = reg >>> 1;
    }
    const appliedPoly = mixed === 1;
    reg = (shifted ^ (appliedPoly ? cfg.poly : 0)) >>> 0;
    steps.push({ byteIndex, bitIndex, inBit, mixed, shifted, appliedPoly, registerAfter: reg });
  };

  if (cfg.direction === 'left') {
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      for (let bit = 7; bit >= 0; bit--) step(i, bit, ((b >> bit) & 1) as 0 | 1);
      afterByte.push(reg >>> 0);
    }
  } else {
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      for (let bit = 0; bit < 8; bit++) step(i, bit, ((b >> bit) & 1) as 0 | 1);
      afterByte.push(reg >>> 0);
    }
  }

  const finalRegister = reg >>> 0;
  return {
    init: init & mask,
    afterByte,
    steps,
    finalRegister,
    xorOut,
    checksum: (finalRegister ^ xorOut) >>> 0,
  };
}

/**
 * 计算载荷对应的仿射线性映射 finalReg = M * init XOR c：
 * 返回 { zero: c（init=0 的末态）, columns: M 的 w 个列向量（按位打包成 w 位整数） }
 * 不枚举 init，只跑 w+1 次逐位递推。
 */
export function linearMap(bytes: Uint8Array, cfg: CrcShape): { zero: number; columns: Uint16Array } {
  const w = cfg.width;
  const zero = crcFinalRegister(bytes, cfg, 0);
  const columns = new Uint16Array(w);
  for (let k = 0; k < w; k++) {
    columns[k] = (crcFinalRegister(bytes, cfg, 1 << k) ^ zero) & 0xffff;
  }
  return { zero, columns };
}

export function asShape(cfg: CandidateConfig): CrcShape {
  return { width: cfg.width, direction: cfg.direction, poly: cfg.poly };
}
