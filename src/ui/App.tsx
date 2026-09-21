import { useEffect, useMemo, useRef, useState } from 'react';
import type { Model, RunReport } from '../lib/types';
import type { ValidModel, ValidationIssue } from '../lib/validation';
import { validateModel } from '../lib/validation';
import { draftFromModel, draftToModel, type DraftModel } from '../lib/draft';
import { parseModelText, serializeModel } from '../lib/io';
import { buildAmbiguousExampleModel, buildExampleModel } from '../lib/examples';
import { runInversion } from '../lib/engine';
import { SampleTable } from './SampleTable';
import { CandidateTable } from './CandidateTable';
import { ResultSection } from './ResultSection';
import type { WorkerRequest, WorkerResponse } from '../workers/inversion.worker';

type RunState =
  | { status: 'idle' }
  | { status: 'running'; runId: number; done: number; total: number }
  | { status: 'done'; report: RunReport; validated: ValidModel }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export function App() {
  const [draft, setDraft] = useState<DraftModel>(() => draftFromModel(buildExampleModel()));
  const [run, setRun] = useState<RunState>({ status: 'idle' });
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [ioMessage, setIoMessage] = useState<string>('');
  const [verdictFilter, setVerdictFilter] = useState<'all' | 'unique' | 'ambiguous' | 'no-solution'>('all');
  const [visibleCount, setVisibleCount] = useState(20);
  const fileRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);

  // 卸载时终结 worker
  useEffect(() => {
    return () => workerRef.current?.terminate();
  }, []);

  // 任何编辑都使旧结论失效：非法输入或取消都不得保留旧结论，输入变更同样不展示过期结论；
  // 同时作废在途计算（终止 worker 并推进 runId），防止迟到结果回填
  const touchDraft = (next: DraftModel) => {
    runIdRef.current++;
    workerRef.current?.terminate();
    workerRef.current = null;
    setDraft(next);
    setRun({ status: 'idle' });
    setIssues([]);
  };

  const prepareModel = (): { model: Model; validated: ValidModel } | null => {
    const parsed = draftToModel(draft);
    if (!parsed.ok) {
      setIssues(parsed.issues);
      setRun({ status: 'idle' });
      return null;
    }
    const v = validateModel(parsed.model);
    if (!v.ok) {
      setIssues(v.issues);
      setRun({ status: 'idle' });
      return null;
    }
    return { model: parsed.model, validated: v.model };
  };

  const start = () => {
    setIoMessage('');
    const prepared = prepareModel();
    if (!prepared) return;
    setIssues([]);

    const runId = ++runIdRef.current;
    setRun({ status: 'running', runId, done: 0, total: prepared.validated.candidates.length });

    // 优先走 Web Worker；不支持时回退主线程（仍带取消检查点）
    if (typeof Worker !== 'undefined') {
      workerRef.current?.terminate();
      const worker = new Worker(new URL('../workers/inversion.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data;
        if (msg.runId !== runIdRef.current) return;
        if (msg.type === 'progress') {
          setRun((cur) => (cur.status === 'running' ? { ...cur, done: msg.done, total: msg.total } : cur));
        } else if (msg.type === 'done') {
          if (msg.report.cancelled) {
            setRun({ status: 'cancelled' });
          } else {
            setRun({ status: 'done', report: msg.report, validated: prepared.validated });
          }
          worker.terminate();
          workerRef.current = null;
        }
      };
      const req: WorkerRequest = { type: 'start', runId, model: prepared.validated };
      worker.postMessage(req);
    } else {
      const report = runInversion(prepared.validated, {
        signal: { get cancelled() { return runIdRef.current !== runId; } },
        onProgress: (done, total) => setRun({ status: 'running', runId, done, total }),
      });
      if (report.cancelled) setRun({ status: 'cancelled' });
      else setRun({ status: 'done', report, validated: prepared.validated });
    }
  };

  const cancel = () => {
    const id = run.status === 'running' ? run.runId : null;
    if (id === null) return;
    runIdRef.current++; // 让迟到的结果失效
    // 直接终止 worker：取消即丢弃全部部分结果，不等待候选边界
    workerRef.current?.terminate();
    workerRef.current = null;
    setRun({ status: 'cancelled' });
  };

  const loadExample = () => {
    touchDraft(draftFromModel(buildExampleModel()));
    setIoMessage('已载入示例 1（唯一解 + 无解对照）');
  };
  const loadAmbiguousExample = () => {
    touchDraft(draftFromModel(buildAmbiguousExampleModel()));
    setIoMessage('已载入示例 2（CRC-16 三短样本，约束不足 → 歧义，并给出第二见证）');
  };

  const onImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const model = parseModelText(String(reader.result));
        touchDraft(draftFromModel(model));
        setIoMessage(`已导入：${file.name}`);
      } catch (e) {
        setIssues([{ scope: 'model', message: `导入失败：${(e as Error).message}` }]);
      }
    };
    reader.onerror = () => setIssues([{ scope: 'model', message: '文件读取失败' }]);
    reader.readAsText(file);
  };

  const onExport = () => {
    const parsed = draftToModel(draft);
    if (!parsed.ok) {
      setIssues(parsed.issues);
      return;
    }
    const blob = new Blob([serializeModel(parsed.model)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${draft.name.trim() || 'model'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onPasteJson = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const model = parseModelText(text);
      touchDraft(draftFromModel(model));
      setIoMessage('已从剪贴板导入 JSON');
    } catch (e) {
      setIssues([{ scope: 'model', message: `剪贴板导入失败：${(e as Error).message}` }]);
    }
  };

  const issueList = useMemo(
    () =>
      issues.map((iss, i) => (
        <li key={i}>
          {iss.scope === 'sample' && iss.index !== undefined ? `样本 #${iss.index + 1}：` : ''}
          {iss.scope === 'candidate' && iss.index !== undefined ? `候选 #${iss.index + 1}：` : ''}
          {iss.message}
        </li>
      )),
    [issues],
  );

  const running = run.status === 'running';
  const progress = run.status === 'running' ? run.done / Math.max(1, run.total) : 0;

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>CRC 参数反演复核台</h1>
          <div className="sub">
            纯浏览器本地计算 · GF(2) 约束精确审计（高斯-若尔当消元，不枚举 init/xorOut）· init 与 xorOut 为未知量
          </div>
        </div>
        <div className="row">
          <button onClick={loadExample}>示例1 唯一/无解</button>
          <button onClick={loadAmbiguousExample}>示例2 歧义</button>
        </div>
      </header>

      <section className="panel">
        <h2>① 模型</h2>
        <div className="row">
          <span className="kv">模型名称</span>
          <input type="text" style={{ width: 280 }} value={draft.name} onChange={(e) => touchDraft({ ...draft, name: e.target.value })} />
        </div>
        <div className="row">
          <button onClick={() => fileRef.current?.click()}>导入 JSON 文件</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImportFile(f);
              e.target.value = '';
            }}
          />
          <button onClick={onPasteJson}>从剪贴板导入</button>
          <button onClick={onExport}>导出 JSON</button>
          {ioMessage && <span className="kv">{ioMessage}</span>}
        </div>
      </section>

      {issues.length > 0 && (
        <div className="alert error">
          输入存在 {issues.length} 个问题，已阻止计算（不保留任何结论）：
          <ul>{issueList}</ul>
        </div>
      )}

      <section className="panel">
        <h2>② 样本（{draft.samples.length}，要求 3–64 条，十六进制载荷 + 观测值）</h2>
        <SampleTable draft={draft} onChange={touchDraft} />
      </section>

      <section className="panel">
        <h2>③ 候选配置族（{draft.candidates.length}，至多 128 个；init/xorOut 未知）</h2>
        <CandidateTable draft={draft} onChange={touchDraft} />
      </section>

      <section className="panel">
        <h2>④ 反演</h2>
        <div className="row">
          <button className="primary" onClick={start} disabled={running}>
            {running ? '反演进行中…' : '启动反演'}
          </button>
          <button className="danger" onClick={cancel} disabled={!running}>
            取消计算
          </button>
          {running && <span className="kv">候选 {run.done}/{run.total}</span>}
        </div>
        {running && (
          <div className="progressbar">
            <div style={{ width: `${(progress * 100).toFixed(1)}%` }} />
          </div>
        )}
        {run.status === 'cancelled' && (
          <div className="alert info" style={{ marginTop: 10 }}>
            计算已取消，旧结论已清空，未保留任何部分结果。
        </div>
        )}
      </section>

      {run.status === 'done' && (
        <ResultSection
          report={run.report}
          validated={run.validated}
          verdictFilter={verdictFilter}
          onVerdictFilter={(f) => {
            setVerdictFilter(f);
            setVisibleCount(20);
          }}
          visibleCount={visibleCount}
          onShowMore={() => setVisibleCount((c) => c + 20)}
        />
      )}

      <div className="footer-note">
        所有载荷、观测值与反演计算均在本机浏览器内完成，页面不调用任何业务后端。
        解数 = 2^零化度 由 GF(2) 秩精确给出；见证为字典序最小解，歧义时附第二小见证。
      </div>
    </div>
  );
}
