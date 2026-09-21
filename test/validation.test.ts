import { describe, expect, it } from 'vitest';
import { validateModel } from '../src/lib/validation';
import { parseHexBytes, parseUint } from '../src/lib/hex';
import { parseModelText } from '../src/lib/io';
import { runInversion } from '../src/lib/engine';
import { crcChecksum } from '../src/lib/crc';
import type { Model } from '../src/lib/types';

const ascii = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));

describe('十六进制/数值解析', () => {
  it('接受空格/冒号/0x/换行分隔并按字节解析', () => {
    expect(Array.from(parseHexBytes('01 02:03-0x04'))).toEqual([1, 2, 3, 4]);
    expect(Array.from(parseHexBytes('AB CD'))).toEqual([0xab, 0xcd]);
  });
  it('拒绝空、奇数字符、非十六进制字符', () => {
    expect(() => parseHexBytes('')).toThrow();
    expect(() => parseHexBytes('abc')).toThrow();
    expect(() => parseHexBytes('zz')).toThrow();
  });
  it('parseUint 支持十进制与 0x，拒绝非法文本', () => {
    expect(parseUint('255')).toBe(255);
    expect(parseUint('0xFF')).toBe(255);
    expect(() => parseUint('')).toThrow();
    expect(() => parseUint('12x')).toThrow();
  });
});

describe('模型校验', () => {
  const base = (): Model => {
    const cfg = { id: 'A', width: 8 as const, direction: 'left' as const, poly: 0x1d };
    const payloads = [ascii('123456789'), ascii('hello!!'), new Uint8Array([1, 2, 3])];
    return {
      name: 'm',
      samples: payloads.map((b) => ({ payloadHex: '', observed: crcChecksum(b, cfg, 0x10, 0x20) })).map((s, i) => ({
        payloadHex: Array.from(payloads[i], (x) => x.toString(16).padStart(2, '0')).join(' '),
        observed: s.observed,
      })),
      candidates: [cfg],
    };
  };

  it('合法模型通过', () => {
    const r = validateModel(base());
    expect(r.ok).toBe(true);
  });

  it('样本少于 3 / 多于 64 被拒绝', () => {
    const m = base();
    m.samples = m.samples.slice(0, 2);
    expect(validateModel(m).ok).toBe(false);
    const m2 = base();
    m2.samples = Array.from({ length: 65 }, () => ({ payloadHex: '00', observed: 0 }));
    expect(validateModel(m2).ok).toBe(false);
  });

  it('候选超过 128 / 为空 / 编号重复 / 宽度非法 / 多项式越界 均被拒绝', () => {
    let m = base();
    m.candidates = [];
    expect(validateModel(m).ok).toBe(false);

    m = base();
    m.candidates = Array.from({ length: 129 }, (_, i) => ({ id: `C${i}`, width: 8 as const, direction: 'left' as const, poly: 7 }));
    expect(validateModel(m).ok).toBe(false);

    m = base();
    m.candidates = [
      { id: 'X', width: 8, direction: 'left', poly: 7 },
      { id: 'X', width: 8, direction: 'left', poly: 7 },
    ];
    expect(validateModel(m).ok).toBe(false);

    m = base();
    m.candidates = [{ id: 'X', width: 32 as unknown as 8, direction: 'left', poly: 7 }];
    expect(validateModel(m).ok).toBe(false);

    m = base();
    m.candidates = [{ id: 'X', width: 8, direction: 'left', poly: 0x100 }];
    expect(validateModel(m).ok).toBe(false);

    m = base();
    m.candidates = [{ id: 'X', width: 8, direction: 'sideways' as unknown as 'left', poly: 7 }];
    expect(validateModel(m).ok).toBe(false);
  });

  it('观测值超出全部候选最大宽度被拒绝；仅超出窄候选时模型合法（该候选由引擎判无解）', () => {
    // 仅有一个 8 位候选，观测 0x100 超出所有候选 → 拒绝
    const m = base();
    m.samples[0].observed = 0x100;
    expect(validateModel(m).ok).toBe(false);

    // 加入 16 位候选后模型合法；8 位候选运行时判无解
    const m2 = base();
    m2.samples[0].observed = 0x100;
    m2.candidates.push({ id: 'W16', width: 16, direction: 'left', poly: 0xc867 });
    const v = validateModel(m2);
    expect(v.ok).toBe(true);
    if (v.ok) {
      const report = runInversion(v.model);
      const narrow = report.results.find((r) => r.candidateId === 'A')!;
      expect(narrow.verdict).toBe('no-solution');
      expect(narrow.note).toContain('超出宽度');
    }
  });

  it('非法载荷十六进制被定位到样本', () => {
    const m = base();
    m.samples[1].payloadHex = 'zz';
    const r = validateModel(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.scope === 'sample' && i.index === 1)).toBe(true);
  });
});

describe('模型 JSON 导入', () => {
  it('observed 为 0x 字符串时归一化为数字', () => {
    const m = parseModelText(JSON.stringify({
      name: 'x',
      samples: [
        { payloadHex: '01', observed: '0xFF' },
        { payloadHex: '02', observed: 10 },
        { payloadHex: '03', observed: 0 },
      ],
      candidates: [{ id: 'c', width: 8, direction: 'left', poly: '0x07' }],
    }));
    expect(m.samples[0].observed).toBe(255);
    expect(m.candidates[0].poly).toBe(7);
  });
  it('字段缺失给出明确错误', () => {
    expect(() => parseModelText('{}')).toThrow();
    expect(() => parseModelText('not json')).toThrow();
  });
});

describe('反演编排与取消', () => {
  const cfg = { id: 'A', width: 8 as const, direction: 'left' as const, poly: 0x1d };
  const mkModel = () => {
    const payloads = [ascii('123456789'), ascii('hello!!'), new Uint8Array([1, 2, 3]), new Uint8Array([9, 9, 9])];
    const m: Model = {
      name: 'm',
      samples: payloads.map((b) => ({
        payloadHex: Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' '),
        observed: crcChecksum(b, cfg, 0x42, 0x77),
      })),
      candidates: [cfg, { ...cfg, id: 'B', poly: 0x9b }, { ...cfg, id: 'C', poly: 0x31 }],
    };
    const v = validateModel(m);
    if (!v.ok) throw new Error('bad fixture');
    return v.model;
  };

  it('正常运行：每个候选都有结论，唯一见证重算全部命中', () => {
    const report = runInversion(mkModel());
    expect(report.cancelled).toBe(false);
    expect(report.results).toHaveLength(3);
    for (const r of report.results) {
      expect(r.matched.every(Boolean)).toBe(true);
      if (r.witness) {
        for (const t of r.traces!) expect(t.checksum).toBeDefined();
      }
    }
  });

  it('取消信号在首个候选前生效时：cancelled=true 且不保留任何结果', () => {
    const signal = { cancelled: true };
    const report = runInversion(mkModel(), { signal });
    expect(report.cancelled).toBe(true);
    expect(report.results).toHaveLength(0);
  });

  it('进度回调被调用', () => {
    const seen: number[] = [];
    runInversion(mkModel(), { onProgress: (d) => seen.push(d) });
    expect(seen[seen.length - 1]).toBe(3);
  });
});
