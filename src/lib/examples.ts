// 内置示例：运行时用本库 CRC 递推生成观测值，保证自洽。
// 1) CRC-8（左移 poly=0x07），init=0x31, xorOut=0x5C（非平凡，需反演）
// 2) 同组样本附一个“错误多项式”候选，用于演示无解；
// 3) 仅 3 条短样本 + CRC-16/MODBUS 右移，制造歧义（自由位 > 0）。

import { crcChecksum } from './crc';
import { bytesToHex } from './hex';
import type { Model } from './types';

export function buildExampleModel(): Model {
  // poly=0x1D 左移：无 x+1 因子、转移映射可逆，样本充分时 init/xorOut 可唯一反演
  const gen = { width: 8 as const, direction: 'left' as const, poly: 0x1d };
  const payloads: Uint8Array[] = [
    new Uint8Array([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a]),
    new Uint8Array([0x01, 0x04, 0x02, 0xff, 0xff]),
    new Uint8Array([0xa5, 0x5a, 0xde, 0xad, 0xbe, 0xef]),
    new Uint8Array([0x00]),
    new Uint8Array([0xff, 0xff, 0xff]),
    new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a]),
  ];
  const samples = payloads.map((bytes) => ({
    payloadHex: bytesToHex(bytes),
    observed: crcChecksum(bytes, gen, 0x31, 0x5c),
  }));

  return {
    name: '示例：CRC-8 反演（唯一解 + 无解对照）',
    samples,
    candidates: [
      { id: 'CRC8-1D-L', width: 8, direction: 'left', poly: 0x1d },
      { id: 'CRC8-07-L', width: 8, direction: 'left', poly: 0x07 },
      { id: 'CRC8-1D-R', width: 8, direction: 'right', poly: 0xb8 },
    ],
  };
}

/** 歧义示例：CRC-16/MODBUS（右移 0xA001，init=0xFFFF xorOut=0x0000），3 条短样本约束不足 */
export function buildAmbiguousExampleModel(): Model {
  const payloads: Uint8Array[] = [new Uint8Array([0x01]), new Uint8Array([0x02]), new Uint8Array([0x03])];
  const samples = payloads.map((bytes) => ({
    payloadHex: bytesToHex(bytes),
    observed: crcChecksum(bytes, { width: 16, direction: 'right', poly: 0xa001 }, 0xffff, 0x0000),
  }));
  return {
    name: '示例：CRC-16 三短样本（歧义）',
    samples,
    candidates: [{ id: 'MODBUS-A001-R', width: 16, direction: 'right', poly: 0xa001 }],
  };
}
