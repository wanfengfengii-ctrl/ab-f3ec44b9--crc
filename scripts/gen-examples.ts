// 用应用自身的 CRC 递推生成 examples/*.json，保证示例与审计器同源自洽。
// 运行：npx vite-node scripts/gen-examples.ts
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { crcChecksum } from '../src/lib/crc';
import { bytesToHex } from '../src/lib/hex';
import type { Model } from '../src/lib/types';

const out = (m: Model, name: string) => {
  writeFileSync(resolve(process.cwd(), 'examples', name), JSON.stringify(m, null, 2) + '\n');
  console.log('wrote examples/' + name);
};

// 唯一解 + 无解对照（poly=0x1D 可逆；0x07 左移与 0xB8 右移为对照候选）
{
  const gen = { width: 8 as const, direction: 'left' as const, poly: 0x1d };
  const payloads = [
    Uint8Array.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a]),
    Uint8Array.from([0x01, 0x04, 0x02, 0xff, 0xff]),
    Uint8Array.from([0xa5, 0x5a, 0xde, 0xad, 0xbe, 0xef]),
    Uint8Array.from([0x00]),
    Uint8Array.from([0xff, 0xff, 0xff]),
    Uint8Array.from([0x12, 0x34, 0x56, 0x78, 0x9a]),
  ];
  out(
    {
      name: 'CRC-8 唯一解与无解对照',
      samples: payloads.map((b) => ({ payloadHex: bytesToHex(b), observed: crcChecksum(b, gen, 0x31, 0x5c) })),
      candidates: [
        { id: 'CRC8-1D-L', width: 8, direction: 'left', poly: 0x1d },
        { id: 'CRC8-07-L', width: 8, direction: 'left', poly: 0x07 },
        { id: 'CRC8-1D-R', width: 8, direction: 'right', poly: 0xb8 },
      ],
    },
    'crc8-unique.json',
  );
}

// 歧义（CRC-16/MODBUS 右移 0xA001，3 条单字节样本约束不足）
{
  const gen = { width: 16 as const, direction: 'right' as const, poly: 0xa001 };
  const payloads = [Uint8Array.from([0x01]), Uint8Array.from([0x02]), Uint8Array.from([0x03])];
  out(
    {
      name: 'CRC-16 三短样本歧义',
      samples: payloads.map((b) => ({ payloadHex: bytesToHex(b), observed: crcChecksum(b, gen, 0xffff, 0x0000) })),
      candidates: [{ id: 'MODBUS-A001-R', width: 16, direction: 'right', poly: 0xa001 }],
    },
    'crc16-ambiguous.json',
  );
}

// 较大模型：宽度混合、多候选（演示至多 128 候选与 64 样本的边界可用性）
{
  const gen = { width: 16 as const, direction: 'left' as const, poly: 0xc867 };
  const payloads = Array.from({ length: 12 }, (_, i) =>
    Uint8Array.from([i, 0x01, 0x02, (i * 7) & 0xff, 0x80, (i * 13) & 0xff, 0xaa, 0x55]),
  );
  out(
    {
      name: 'CRC-16 多候选族',
      samples: payloads.map((b) => ({ payloadHex: bytesToHex(b), observed: crcChecksum(b, gen, 0x2b3c, 0x1234) })),
      candidates: [
        { id: 'CRC16-C867-L', width: 16, direction: 'left', poly: 0xc867 },
        { id: 'CRC16-1021-L', width: 16, direction: 'left', poly: 0x1021 },
        { id: 'MODBUS-A001-R', width: 16, direction: 'right', poly: 0xa001 },
        { id: 'CRC16-E613-R', width: 16, direction: 'right', poly: 0xe613 },
        { id: 'CRC8-1D-L', width: 8, direction: 'left', poly: 0x1d },
      ],
    },
    'crc16-family.json',
  );
}
