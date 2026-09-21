import { describe, expect, it } from 'vitest';
import { auditCandidate } from '../src/lib/solver';
import { crcChecksum } from '../src/lib/crc';
import type { CrcShape } from '../src/lib/crc';
import type { AuditSample } from '../src/lib/solver';

const ascii = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));

/** 暴力枚举全部 (init, xorOut)（仅用于 8 位情形：65536 组）作为审计器 oracle */
function bruteForce(cfg: CrcShape, samples: AuditSample[]) {
  const sols: Array<{ init: number; xorOut: number }> = [];
  for (let init = 0; init < 256; init++) {
    for (let xorOut = 0; xorOut < 256; xorOut++) {
      if (samples.every((s) => (crcChecksum(s.bytes, cfg, init, xorOut) & 0xff) === (s.observed & 0xff))) {
        sols.push({ init, xorOut });
      }
    }
  }
  // 字典序：init 高位优先即数值升序；同 init 下 xorOut 数值升序
  sols.sort((a, b) => a.init - b.init || a.xorOut - b.xorOut);
  return sols;
}

const mkSamples = (pairs: Array<[Uint8Array, number]>): AuditSample[] =>
  pairs.map(([bytes, observed]) => ({ bytes, observed }));

describe('GF(2) 审计器 — 与全枚举 oracle 交叉验证（8 位候选）', () => {
  // poly=0x07 左移存在 0xFD 结构歧义（见下方专项回归）；短样本/篡改类用例沿用之
  const cfg: CrcShape = { width: 8, direction: 'left', poly: 0x07 };

  it('唯一解：样本充分，解数=1，最小见证即真实参数（poly=0x1D 左移，转移映射可逆）', () => {
    // 真实参数 init=0x31 xorOut=0x5C
    const cfg: CrcShape = { width: 8, direction: 'left', poly: 0x1d };
    const truth = { init: 0x31, xorOut: 0x5c };
    const payloads = [
      ascii('123456789'),
      ascii('hello'),
      new Uint8Array([0, 1, 2, 3]),
      new Uint8Array([0xa5, 0x5a]),
      new Uint8Array([0x07]),
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    ];
    const samples = mkSamples(payloads.map((b) => [b, crcChecksum(b, cfg, truth.init, truth.xorOut)]));
    const r = auditCandidate(cfg, samples, 8);
    const sols = bruteForce(cfg, samples);
    expect(sols.length).toBe(1);
    expect(r.verdict).toBe('unique');
    expect(r.solutionCount).toBe('1');
    expect(r.nullity).toBe(0);
    expect(r.witness).toEqual(truth);
    expect(r.secondWitness).toBeNull();
  });

  it('结构歧义回归：poly=0x07 左移的 x^8−1 整除性使 (init,xorOut) 与各⊕0xFD 的参数对对任意载荷不可区分', () => {
    // 即便给出大量不同长度样本，解数恒为 2；两份见证都满足全部样本
    const cfg: CrcShape = { width: 8, direction: 'left', poly: 0x07 };
    const truth = { init: 0x31, xorOut: 0x5c };
    const payloads = [
      ascii('123456789'),
      ascii('hello world'),
      new Uint8Array(50),
      new Uint8Array([0xff]),
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    ];
    const samples = mkSamples(payloads.map((b) => [b, crcChecksum(b, cfg, truth.init, truth.xorOut)]));
    const r = auditCandidate(cfg, samples, 8);
    const sols = bruteForce(cfg, samples);
    expect(sols.length).toBe(2);
    expect(r.verdict).toBe('ambiguous');
    expect(r.solutionCount).toBe('2');
    expect(r.nullity).toBe(1);
    expect(r.witness).toEqual(sols[0]);
    expect(r.secondWitness).toEqual(sols[1]);
    // 两份见证的 init、xorOut 之差都是 0xFD
    expect(r.witness!.init ^ r.secondWitness!.init).toBe(0xfd);
    expect(r.witness!.xorOut ^ r.secondWitness!.xorOut).toBe(0xfd);
  });

  it('歧义：仅 3 条短样本，解数=2^d 与枚举一致，最小/次小见证逐一吻合', () => {
    const truth = { init: 0x00, xorOut: 0x00 };
    const payloads = [new Uint8Array([0x01]), new Uint8Array([0x02]), new Uint8Array([0x03])];
    const samples = mkSamples(payloads.map((b) => [b, crcChecksum(b, cfg, truth.init, truth.xorOut)]));
    const r = auditCandidate(cfg, samples, 8);
    const sols = bruteForce(cfg, samples);
    expect(r.verdict).toBe('ambiguous');
    expect(BigInt(r.solutionCount)).toBe(BigInt(sols.length));
    expect(2 ** r.nullity).toBe(sols.length);
    expect(r.witness).toEqual(sols[0]);
    expect(r.secondWitness).toEqual(sols[1]);
    // 次小见证必须不同于最小见证且同样满足全部样本
    expect(r.secondWitness).not.toEqual(r.witness);
    for (const s of samples) {
      expect(crcChecksum(s.bytes, cfg, r.secondWitness!.init, r.secondWitness!.xorOut)).toBe(s.observed);
    }
  });

  it('歧义：零载荷观测也成立（xorOut 直接可见的退化情形也要计数正确）', () => {
    const samples = mkSamples([
      [new Uint8Array([0x00]), 0x00],
      [new Uint8Array([0x00, 0x00]), 0x00],
      [new Uint8Array([0xff]), 0x00],
    ]);
    const r = auditCandidate(cfg, samples, 8);
    const sols = bruteForce(cfg, samples);
    expect(BigInt(r.solutionCount)).toBe(BigInt(sols.length));
    if (sols.length > 0) {
      expect(r.witness).toEqual(sols[0]);
      if (sols.length > 1) expect(r.secondWitness).toEqual(sols[1]);
    } else {
      expect(r.verdict).toBe('no-solution');
    }
  });

  it('无解：篡改一条观测值 => 0 组解', () => {
    const truth = { init: 0x31, xorOut: 0x5c };
    const payloads = [ascii('123456789'), ascii('hello'), new Uint8Array([0, 1, 2, 3])];
    const obs = payloads.map((b) => crcChecksum(b, cfg, truth.init, truth.xorOut));
    obs[1] ^= 0x01; // 任意翻转必使线性方程组矛盾
    const samples = mkSamples(payloads.map((b, i) => [b, obs[i]]));
    const r = auditCandidate(cfg, samples, 8);
    const sols = bruteForce(cfg, samples);
    expect(sols.length).toBe(0);
    expect(r.verdict).toBe('no-solution');
    expect(r.solutionCount).toBe('0');
    expect(r.witness).toBeNull();
    expect(r.secondWitness).toBeNull();
  });

  it('右移 8 位候选同样与枚举一致（poly=0xB8，0x1D 的反射多项式）', () => {
    const rcfg: CrcShape = { width: 8, direction: 'right', poly: 0xb8 };
    const truth = { init: 0x99, xorOut: 0x2a };
    const payloads = [ascii('ab'), new Uint8Array([0x00, 0xff]), ascii('CCCC9'), new Uint8Array([0x12, 0x34, 0x56])];
    const samples = mkSamples(payloads.map((b) => [b, crcChecksum(b, rcfg, truth.init, truth.xorOut)]));
    const r = auditCandidate(rcfg, samples, 8);
    const sols = bruteForce(rcfg, samples);
    expect(sols.length).toBe(1);
    expect(r.verdict).toBe('unique');
    expect(r.witness).toEqual(truth);
  });

  it('多随机用例：审计计数/最小见证恒等于枚举 oracle', () => {
    const cfgs: CrcShape[] = [
      { width: 8, direction: 'left', poly: 0x07 },
      { width: 8, direction: 'left', poly: 0x1d },
      { width: 8, direction: 'right', poly: 0xe0 },
      { width: 8, direction: 'right', poly: 0x8c },
    ];
    let seed = 1234567;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (const c of cfgs) {
      for (let trial = 0; trial < 6; trial++) {
        const n = 3 + Math.floor(rnd() * 4);
        const payloads = Array.from({ length: n }, () => {
          const len = 1 + Math.floor(rnd() * 4);
          return Uint8Array.from({ length: len }, () => Math.floor(rnd() * 256));
        });
        const truthInit = Math.floor(rnd() * 256);
        const truthXor = Math.floor(rnd() * 256);
        const corrupt = rnd() < 0.3;
        const samples = mkSamples(
          payloads.map((b, i) => {
            let v = crcChecksum(b, c, truthInit, truthXor);
            if (corrupt && i === 0) v ^= 1 << Math.floor(rnd() * 8);
            return [b, v];
          }),
        );
        const r = auditCandidate(c, samples, 8);
        const sols = bruteForce(c, samples);
        expect(BigInt(r.solutionCount), `${JSON.stringify({ c, trial, n })}`).toBe(BigInt(sols.length));
        if (sols.length > 0) expect(r.witness).toEqual(sols[0]);
        if (sols.length > 1) expect(r.secondWitness).toEqual(sols[1]);
        if (sols.length === 0) expect(r.verdict).toBe('no-solution');
        else if (sols.length === 1) expect(r.verdict).toBe('unique');
        else expect(r.verdict).toBe('ambiguous');
      }
    }
  });
});
