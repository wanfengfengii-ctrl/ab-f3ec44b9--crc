import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkerRequest, WorkerResponse } from '../worker/inversion.worker';
import type { CrcModel, InversionReport } from '../lib/types';

export type RunStatus = 'idle' | 'running' | 'done' | 'invalid' | 'cancelled';

export interface InversionState {
  status: RunStatus;
  report: InversionReport | null;
  errors: string[];
  progress: { done: number; total: number } | null;
}

/**
 * 反演任务编排：
 * - 启动前在主线程先做一次合法性校验，非法输入立即清空旧结论；
 * - 取消后同样清空旧结论，页面只显示“已取消”。
 */
export function useInversion() {
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);
  const [state, setState] = useState<InversionState>({
    status: 'idle',
    report: null,
    errors: [],
    progress: null,
  });

  useEffect(() => {
    const worker = new Worker(new URL('../worker/inversion.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.jobId !== jobRef.current) return;
      if (msg.type === 'progress') {
        setState((s) => ({ ...s, progress: { done: msg.done, total: msg.total } }));
      } else if (msg.type === 'invalid') {
        setState({ status: 'invalid', report: null, errors: msg.errors, progress: null });
      } else if (msg.type === 'cancelled') {
        setState({ status: 'cancelled', report: null, errors: [], progress: null });
      } else if (msg.type === 'done') {
        setState({ status: 'done', report: msg.report, errors: [], progress: null });
      }
    };
    return () => worker.terminate();
  }, []);

  const run = useCallback((model: CrcModel, precheckErrors: string[]) => {
    jobRef.current += 1;
    const jobId = jobRef.current;
    if (precheckErrors.length > 0) {
      // 非法输入：绝不保留旧结论
      setState({ status: 'invalid', report: null, errors: precheckErrors, progress: null });
      workerRef.current?.postMessage({ type: 'cancel', jobId: jobId - 1 } satisfies WorkerRequest);
      return;
    }
    setState({ status: 'running', report: null, errors: [], progress: { done: 0, total: model.candidates.length } });
    workerRef.current?.postMessage({ type: 'run', model, jobId } satisfies WorkerRequest);
  }, []);

  const cancel = useCallback(() => {
    const jobId = jobRef.current;
    // 取消：旧结论立即作废
    setState({ status: 'cancelled', report: null, errors: [], progress: null });
    workerRef.current?.postMessage({ type: 'cancel', jobId } satisfies WorkerRequest);
  }, []);

  /** 模型被编辑后作废任何既有结论，避免展示陈旧见证。 */
  const discard = useCallback(() => {
    const oldJob = jobRef.current;
    jobRef.current += 1;
    workerRef.current?.postMessage({ type: 'cancel', jobId: oldJob } satisfies WorkerRequest);
    setState({ status: 'idle', report: null, errors: [], progress: null });
  }, []);

  return { state, run, cancel, discard };
}
