import { runCrc } from './crc';
import type { CrcModel } from './types';

/**
 * 内置演示模型。观测值由 runCrc 按“现场设备”的真实参数在浏览器本地算出，
 * 仅用于预置可复现的样例；这些 ground truth 参数对反演器不可见。
 * 真实使用时工程师通过 JSON 导入或直接在表格中编辑。
 *
 * 取多项式 0x1D（系数重量为奇数，I+T 满秩）与不同长度的载荷，
 * 使 (init, xorOut) 在数学上可被唯一辨识。
 */
export function buildSampleModel(): CrcModel {
  const payloads = ['01 03 00 2A 00 02', 'DE AD BE EF', '48 65 6C 6C 6F', 'A5 5A 0D F0 17'];

  // 地面真值（仅生成观测用）：CRC-8，poly=0x1D，msb-first，init=0x12，xorOut=0x34
  const observed = payloads.map((p) => {
    const bytes = p.split(' ').map((h) => parseInt(h, 16));
    const out = runCrc({
      width: 8,
      poly: 0x1dn,
      direction: 'msb-first',
      bytes: Uint8Array.from(bytes),
      init: 0x12n,
      xorOut: 0x34n,
    });
    return out.checksum.toString(16).toUpperCase().padStart(2, '0');
  });

  return {
    name: '演示：CRC-8/0x1D 采集批次',
    samples: payloads.map((payload, i) => ({
      id: `S${i + 1}`,
      payload,
      observed: observed[i],
    })),
    candidates: [
      { id: 'C8-1D', width: 8, direction: 'msb-first', poly: '1D' },
      { id: 'C8-07', width: 8, direction: 'msb-first', poly: '07' },
      { id: 'C8-9B', width: 8, direction: 'msb-first', poly: '9B' },
      { id: 'C8-31R', width: 8, direction: 'lsb-first', poly: '31' },
      { id: 'C16-8005R', width: 16, direction: 'lsb-first', poly: '8005' },
      { id: 'C16-1021', width: 16, direction: 'msb-first', poly: '1021' },
    ],
  };
}

/**
 * 歧义演示：三条完全相同的单字节样本，堆叠后秩亏（零空间维数 8），
 * 任何候选一旦相容就有 256 组 (init, xorOut)。用于展示歧义判定、
 * 精确解数、字典序最小见证与第二份见证的切换核对。
 */
export function buildAmbiguousModel(): CrcModel {
  const payload = '00';
  const out = runCrc({
    width: 8,
    poly: 0x1dn,
    direction: 'msb-first',
    bytes: Uint8Array.from([0x00]),
    init: 0x12n,
    xorOut: 0x34n,
  });
  const observed = out.checksum.toString(16).toUpperCase().padStart(2, '0');

  return {
    name: '演示：秩亏样本导致的歧义',
    samples: [1, 2, 3].map((n) => ({ id: `S${n}`, payload, observed })),
    candidates: [
      { id: 'C8-1D', width: 8, direction: 'msb-first', poly: '1D' },
      { id: 'C8-07', width: 8, direction: 'msb-first', poly: '07' },
      { id: 'C8-31R', width: 8, direction: 'lsb-first', poly: '31' },
      { id: 'C16-1021', width: 16, direction: 'msb-first', poly: '1021' },
    ],
  };
}
