import { describe, expect, it } from 'vitest';
import { runInversion } from '../src/lib/engine';
import { validateModel } from '../src/lib/validation';
import { crcChecksum } from '../src/lib/crc';
import type { Model } from '../src/lib/types';
import { bytesToHex } from '../src/lib/hex';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

describe('规模上限与性能', () => {
  it('64 样本 × 128 候选（混合宽度/方向/多项式）在合理时间内完成且结论齐全', () => {
    const r = rng(42);
    const gen = { width: 16 as const, direction: 'right' as const, poly: 0xe613 };
    const samples = Array.from({ length: 64 }, () => {
      const bytes = Uint8Array.from({ length: 1 + Math.floor(r() * 20) }, () => Math.floor(r() * 256));
      return { payloadHex: bytesToHex(bytes), observed: crcChecksum(bytes, gen, 0x7abc, 0x4455) };
    });
    const candidates = Array.from({ length: 128 }, (_, i) => {
      const width = (i % 2 === 0 ? 16 : 8) as 8 | 16;
      const direction = (i % 3 === 0 ? 'right' : 'left') as 'right' | 'left';
      const poly = width === 16 ? (0x1021 + ((i * 0x1357) & 0xffff)) & 0xffff : (0x07 + i) & 0xff;
      return { id: `CAND-${i.toString().padStart(3, '0')}`, width, direction, poly };
    });
    const model: Model = { name: 'stress', samples, candidates };
    const v = validateModel(model);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const t0 = Date.now();
    const report = runInversion(v.model);
    const elapsed = Date.now() - t0;
    expect(report.cancelled).toBe(false);
    expect(report.results).toHaveLength(128);
    expect(report.results.every((x) => ['unique', 'ambiguous', 'no-solution'].includes(x.verdict))).toBe(true);
    // 真候选（E613 右移 16 位）必须唯一命中，且见证与观测全部一致
    // 候选列表中未必包含完全相同的 poly；单独插入真候选再验
    expect(elapsed).toBeLessThan(30_000);
  });

  it('真候选在 128 个干扰候选中被唯一找出', () => {
    const r = rng(7);
    const gen = { width: 16 as const, direction: 'left' as const, poly: 0xc867 };
    const samples = Array.from({ length: 8 }, () => {
      const bytes = Uint8Array.from({ length: 6 + Math.floor(r() * 10) }, () => Math.floor(r() * 256));
      return { payloadHex: bytesToHex(bytes), observed: crcChecksum(bytes, gen, 0x1234, 0x6789) };
    });
    const candidates = Array.from({ length: 127 }, (_, i) => ({
      id: `X-${i}`,
      width: 16 as const,
      direction: (i % 2 ? 'left' : 'right') as 'left' | 'right',
      poly: (0x0001 + ((i * 2053) & 0xffff)) & 0xffff,
    }));
    candidates.push({ id: 'TRUE', width: 16, direction: 'left', poly: 0xc867 });
    const v = validateModel({ name: 'find', samples, candidates });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const report = runInversion(v.model);
    const t = report.results.find((x) => x.candidateId === 'TRUE')!;
    expect(t.verdict).toBe('unique');
    expect(t.witness).toEqual({ init: 0x1234, xorOut: 0x6789 });
    expect(t.matched.every(Boolean)).toBe(true);
  });
});
