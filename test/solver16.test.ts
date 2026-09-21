import { describe, expect, it } from 'vitest';
import { auditCandidate } from '../src/lib/solver';
import { crcChecksum, crcFinalRegister } from '../src/lib/crc';
import type { CrcShape } from '../src/lib/crc';
import type { AuditSample } from '../src/lib/solver';

const ascii = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));
const mk = (pairs: Array<[Uint8Array, number]>): AuditSample[] =>
  pairs.map(([bytes, observed]) => ({ bytes, observed }));

/**
 * 16 位独立 oracle：枚举全部 2^16 个 init；
 * 每条样本的 xorOut 由首条样本唯一解出，再核对其余样本。完全绕开 GF(2) 消元。
 */
function oracle16(cfg: CrcShape, samples: AuditSample[]) {
  const sols: Array<{ init: number; xorOut: number }> = [];
  const s0 = samples[0];
  for (let init = 0; init < 65536; init++) {
    const xorOut = (s0.observed ^ crcFinalRegister(s0.bytes, cfg, init)) & 0xffff;
    if (samples.every((s) => ((crcFinalRegister(s.bytes, cfg, init) ^ xorOut) & 0xffff) === (s.observed & 0xffff))) {
      sols.push({ init, xorOut });
    }
  }
  sols.sort((a, b) => a.init - b.init || a.xorOut - b.xorOut);
  return sols;
}

describe('GF(2) 审计器 — 16 位与独立 init 枚举 oracle', () => {
  it('CRC-16 左移 0xC867（无 x+1 因子）：丰富样本下唯一反演出 init/xorOut', () => {
    const cfg: CrcShape = { width: 16, direction: 'left', poly: 0xc867 };
    const truth = { init: 0x2b3c, xorOut: 0x1234 };
    const payloads = [
      ascii('123456789'),
      ascii('industrial-bus-01'),
      new Uint8Array([0, 1, 2, 3, 4, 5]),
      new Uint8Array(64).fill(0x5a),
      new Uint8Array([0xff]),
    ];
    const samples = mk(payloads.map((b) => [b, crcChecksum(b, cfg, truth.init, truth.xorOut)]));
    const r = auditCandidate(cfg, samples, 16);
    const sols = oracle16(cfg, samples);
    expect(sols.length).toBe(1);
    expect(r.verdict).toBe('unique');
    expect(r.solutionCount).toBe('1');
    expect(r.witness).toEqual(truth);
    expect(r.secondWitness).toBeNull();
  });

  it('CRC-16 右移 0xE613（0xC867 的反射，无 x+1 因子）：丰富样本下唯一', () => {
    const cfg: CrcShape = { width: 16, direction: 'right', poly: 0xe613 };
    const truth = { init: 0x7abc, xorOut: 0x4455 };
    const payloads = [
      ascii('123456789'),
      new Uint8Array([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a]),
      new Uint8Array(7).fill(0xff),
      ascii('XYZ'),
      new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]),
    ];
    const samples = mk(payloads.map((b) => [b, crcChecksum(b, cfg, truth.init, truth.xorOut)]));
    const r = auditCandidate(cfg, samples, 16);
    const sols = oracle16(cfg, samples);
    expect(sols.length).toBe(1);
    expect(r.verdict).toBe('unique');
    expect(r.witness).toEqual(truth);
  });

  it('结构歧义回归（16 位）：CCITT 0x1021 含 x+1 因子，丰富样本下仍恰有 2 组不可区分参数', () => {
    const cfg: CrcShape = { width: 16, direction: 'left', poly: 0x1021 };
    const truth = { init: 0xffff, xorOut: 0x1234 };
    const payloads = [
      ascii('123456789'),
      ascii('industrial-bus-01'),
      new Uint8Array([0, 1, 2, 3, 4, 5]),
      new Uint8Array(64).fill(0x5a),
      new Uint8Array([0xff]),
    ];
    const samples = mk(payloads.map((b) => [b, crcChecksum(b, cfg, truth.init, truth.xorOut)]));
    const r = auditCandidate(cfg, samples, 16);
    const sols = oracle16(cfg, samples);
    expect(sols.length).toBe(2);
    expect(r.verdict).toBe('ambiguous');
    expect(r.solutionCount).toBe('2');
    expect(r.witness).toEqual(sols[0]);
    expect(r.secondWitness).toEqual(sols[1]);
    // init 与 xorOut 的差是同一个非零 d
    const d = r.witness!.init ^ r.secondWitness!.init;
    expect(d).not.toBe(0);
    expect(d).toBe(r.witness!.xorOut ^ r.secondWitness!.xorOut);
  });

  it('结构歧义回归（16 位）：MODBUS 0xA001 右移同样恒有 2 组解', () => {
    const cfg: CrcShape = { width: 16, direction: 'right', poly: 0xa001 };
    const truth = { init: 0x1234, xorOut: 0x0000 };
    const payloads = [
      ascii('123456789'),
      new Uint8Array([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a]),
      new Uint8Array(7).fill(0xff),
      ascii('XYZ'),
      new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]),
    ];
    const samples = mk(payloads.map((b) => [b, crcChecksum(b, cfg, truth.init, truth.xorOut)]));
    const r = auditCandidate(cfg, samples, 16);
    const sols = oracle16(cfg, samples);
    expect(sols.length).toBe(2);
    expect(r.verdict).toBe('ambiguous');
    const d = r.witness!.init ^ r.secondWitness!.init;
    expect(d).not.toBe(0);
    expect(d).toBe(r.witness!.xorOut ^ r.secondWitness!.xorOut);
  });

  it('歧义：3 条单字节样本约束不足，计数与最小/次小见证和枚举 oracle 一致', () => {
    const cfg: CrcShape = { width: 16, direction: 'right', poly: 0xa001 };
    const truth = { init: 0xffff, xorOut: 0x0000 };
    const payloads = [new Uint8Array([0x01]), new Uint8Array([0x02]), new Uint8Array([0x03])];
    const samples = mk(payloads.map((b) => [b, crcChecksum(b, cfg, truth.init, truth.xorOut)]));
    const r = auditCandidate(cfg, samples, 16);
    const sols = oracle16(cfg, samples);
    expect(sols.length).toBeGreaterThan(2);
    expect(BigInt(r.solutionCount)).toBe(BigInt(sols.length));
    expect(r.verdict).toBe('ambiguous');
    expect(r.nullity).toBe(Math.log2(sols.length));
    expect(r.witness).toEqual(sols[0]);
    expect(r.secondWitness).toEqual(sols[1]);
    // 两份见证都必须真实满足全部样本
    for (const w of [r.witness!, r.secondWitness!]) {
      for (const s of samples) {
        expect(crcChecksum(s.bytes, cfg, w.init, w.xorOut)).toBe(s.observed);
      }
    }
    // 字典序：最小 < 次小
    const key = (w: { init: number; xorOut: number }) => w.init * 65536 + w.xorOut;
    expect(key(r.witness!)).toBeLessThan(key(r.secondWitness!));
  });

  it('无解：翻转一个观测位 => 矛盾系统，0 组解', () => {
    const cfg: CrcShape = { width: 16, direction: 'left', poly: 0x1021 };
    const truth = { init: 0xffff, xorOut: 0x0000 };
    const payloads = [ascii('123456789'), new Uint8Array([1, 2, 3]), new Uint8Array([0xab, 0xcd])];
    const obs = payloads.map((b) => crcChecksum(b, cfg, truth.init, truth.xorOut));
    obs[2] ^= 0x8000;
    const samples = mk(payloads.map((b, i) => [b, obs[i]]));
    const r = auditCandidate(cfg, samples, 16);
    const sols = oracle16(cfg, samples);
    expect(sols.length).toBe(0);
    expect(r.verdict).toBe('no-solution');
    expect(r.solutionCount).toBe('0');
    expect(r.witness).toBeNull();
  });

  it('多组 16 位随机实例：审计结论恒等于独立枚举 oracle', () => {
    let seed = 987654321;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const cfgs: CrcShape[] = [
      { width: 16, direction: 'left', poly: 0x1021 },
      { width: 16, direction: 'right', poly: 0xa001 },
      { width: 16, direction: 'left', poly: 0x8005 },
      { width: 16, direction: 'right', poly: 0x8408 },
    ];
    for (const cfg of cfgs) {
      for (let trial = 0; trial < 3; trial++) {
        const n = 3 + Math.floor(rnd() * 3);
        const rich = rnd() < 0.5;
        const payloads = Array.from({ length: n }, () =>
          Uint8Array.from({ length: rich ? 2 + Math.floor(rnd() * 12) : 1 }, () => Math.floor(rnd() * 256)),
        );
        const truthInit = Math.floor(rnd() * 65536);
        const truthXor = Math.floor(rnd() * 65536);
        const corrupt = rnd() < 0.25;
        const samples = mk(
          payloads.map((b, i) => {
            let v = crcChecksum(b, cfg, truthInit, truthXor);
            if (corrupt && i === 0) v ^= 1 << Math.floor(rnd() * 16);
            return [b, v];
          }),
        );
        const r = auditCandidate(cfg, samples, 16);
        const sols = oracle16(cfg, samples);
        expect(BigInt(r.solutionCount), `${JSON.stringify(cfg)} ${trial}`).toBe(BigInt(sols.length));
        if (sols.length === 0) {
          expect(r.verdict).toBe('no-solution');
        } else {
          expect(r.witness).toEqual(sols[0]);
          if (sols.length > 1) expect(r.secondWitness).toEqual(sols[1]);
          else expect(r.secondWitness).toBeNull();
        }
      }
    }
  });
});
