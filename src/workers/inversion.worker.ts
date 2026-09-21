// 反演 Web Worker：避免阻塞 UI；支持取消（取消后主线程清空旧结论）。
import { runInversion } from '../lib/engine';
import type { ValidModel } from '../lib/validation';
import type { RunReport } from '../lib/types';

export type WorkerRequest =
  | { type: 'start'; runId: number; model: ValidModel }
  | { type: 'cancel'; runId: number };

export type WorkerResponse =
  | { type: 'progress'; runId: number; done: number; total: number }
  | { type: 'done'; runId: number; report: RunReport };

let currentRunId = -1;
let cancelled = false;

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'cancel') {
    if (msg.runId === currentRunId) cancelled = true;
    return;
  }
  if (msg.type === 'start') {
    currentRunId = msg.runId;
    cancelled = false;
    const report = runInversion(msg.model, {
      signal: { get cancelled() { return cancelled; } },
      onProgress: (done, total) => {
        const reply: WorkerResponse = { type: 'progress', runId: currentRunId, done, total };
        (self as unknown as Worker).postMessage(reply);
      },
    });
    const reply: WorkerResponse = { type: 'done', runId: currentRunId, report };
    (self as unknown as Worker).postMessage(reply);
  }
};
