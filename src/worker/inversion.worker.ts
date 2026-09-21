import { solveCandidate } from '../lib/gf2';
import { validateModel } from '../lib/validate';
import type { CrcModel, CandidateResult, InversionReport } from '../lib/types';

/**
 * 反演 Worker：所有 GF(2) 统计在此线程进行，避免阻塞 UI。
 * 支持在候选之间响应取消；取消后不产出任何结论（旧结论由主线程清空）。
 */

export type WorkerRequest =
  | { type: 'run'; model: CrcModel; jobId: number }
  | { type: 'cancel'; jobId: number };

export type WorkerResponse =
  | { type: 'progress'; jobId: number; done: number; total: number }
  | { type: 'invalid'; jobId: number; errors: string[] }
  | { type: 'cancelled'; jobId: number }
  | { type: 'done'; jobId: number; report: InversionReport };

let currentJob = -1;
/** 已请求取消的任务号（防止 cancel 早于 run 到达时竞态失效）。 */
const cancelledJobs = new Set<number>();

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'cancel') {
    cancelledJobs.add(msg.jobId);
    if (msg.jobId === currentJob) currentJob = -1;
    return;
  }

  if (msg.type === 'run') {
    if (cancelledJobs.has(msg.jobId)) {
      cancelledJobs.delete(msg.jobId);
      return; // 任务在开跑前已被取消：不产出任何结论
    }
    currentJob = msg.jobId;
    const jobId = msg.jobId;
    const model = msg.model;

    const errors = validateModel(model);
    if (errors.length > 0) {
      if (currentJob === jobId) {
        (self as unknown as Worker).postMessage({ type: 'invalid', jobId, errors } satisfies WorkerResponse);
        currentJob = -1;
      }
      return;
    }

    const startedAt = Date.now();
    const results: CandidateResult[] = [];
    let cancelled = false;

    for (let i = 0; i < model.candidates.length; i++) {
      if (currentJob !== jobId) {
        cancelled = true;
        break;
      }
      const candidate = model.candidates[i];
      const t0 = Date.now();
      const { verdict, note } = solveCandidate(candidate, model.samples);
      results.push({ candidate, verdict, elapsedMs: Date.now() - t0, note });

      (self as unknown as Worker).postMessage({
        type: 'progress',
        jobId,
        done: i + 1,
        total: model.candidates.length,
      } satisfies WorkerResponse);
    }

    if (cancelled || currentJob !== jobId) {
      (self as unknown as Worker).postMessage({ type: 'cancelled', jobId } satisfies WorkerResponse);
      currentJob = -1;
      return;
    }

    currentJob = -1;
    cancelledJobs.delete(jobId);
    const report: InversionReport = {
      modelName: model.name,
      startedAt,
      finishedAt: Date.now(),
      results,
      cancelled: false,
    };
    (self as unknown as Worker).postMessage({ type: 'done', jobId, report } satisfies WorkerResponse);
  }
};
