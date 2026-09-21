// 反演编排：逐个候选审计，候选之间检查取消信号。
// 计算完全在本地线程（经 Web Worker 调用），不访问任何后端。

import { asShape } from './crc';
import { auditCandidate, buildTraces } from './solver';
import type { ValidModel } from './validation';
import type { CandidateResult, RunReport } from './types';

export interface RunOptions {
  signal?: { cancelled: boolean };
  onProgress?: (done: number, total: number) => void;
}

export function runInversion(model: ValidModel, opts: RunOptions = {}): RunReport {
  const startedAt = Date.now();
  const results: CandidateResult[] = [];
  let cancelled = false;

  for (let i = 0; i < model.candidates.length; i++) {
    if (opts.signal?.cancelled) {
      cancelled = true;
      break;
    }
    const candidate = model.candidates[i];
    const shape = asShape(candidate);
    const t0 = performance.now();

    // 观测值超出该候选宽度：不可能有解，直接判无解（不做掩码截断，避免伪造出偶然吻合）
    const rangeMax = candidate.width === 8 ? 0xff : 0xffff;
    const overflowIdx = model.samples.findIndex((s) => s.observed > rangeMax);
    if (overflowIdx >= 0) {
      const elapsedMs0 = Math.round((performance.now() - t0) * 100) / 100;
      results.push({
        candidateId: candidate.id,
        verdict: 'no-solution',
        solutionCount: '0',
        rank: 0,
        nullity: 0,
        witness: null,
        secondWitness: null,
        traces: null,
        secondTraces: null,
        matched: [],
        secondMatched: [],
        elapsedMs: elapsedMs0,
        note: `样本 #${overflowIdx + 1} 观测值 0x${model.samples[overflowIdx].observed
          .toString(16)
          .toUpperCase()} 超出宽度 ${candidate.width} 范围（≤ 0x${rangeMax.toString(16).toUpperCase()}），该候选不可能成立`,
      });
      opts.onProgress?.(i + 1, model.candidates.length);
      continue;
    }

    const audit = auditCandidate(shape, model.samples, candidate.width);
    const elapsedMs = Math.round((performance.now() - t0) * 100) / 100;

    let traces = null;
    let matched: boolean[] = [];
    let secondTraces = null;
    let secondMatched: boolean[] = [];
    if (audit.witness) {
      const built = buildTraces(shape, model.samples, audit.witness, candidate.width);
      traces = built.traces;
      matched = built.matched;
    }
    if (audit.secondWitness) {
      const built2 = buildTraces(shape, model.samples, audit.secondWitness, candidate.width);
      secondTraces = built2.traces;
      secondMatched = built2.matched;
    }

    results.push({
      candidateId: candidate.id,
      verdict: audit.verdict,
      solutionCount: audit.solutionCount,
      rank: audit.rank,
      nullity: audit.nullity,
      witness: audit.witness,
      secondWitness: audit.secondWitness,
      traces,
      secondTraces,
      matched,
      secondMatched,
      elapsedMs,
    });
    opts.onProgress?.(i + 1, model.candidates.length);
  }

  // 取消即丢弃全部部分结果：调用方不得拿到（也不得展示）任何旧结论
  if (cancelled) results.length = 0;

  return {
    modelName: model.name,
    startedAt,
    finishedAt: Date.now(),
    cancelled,
    results,
  };
}
