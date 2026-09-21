import { useMemo, useState } from 'react';
import { ModelEditor } from './components/ModelEditor';
import { WitnessPanel } from './components/WitnessPanel';
import { useInversion } from './hooks/useInversion';
import { validateModel } from './lib/validate';
import { buildSampleModel, buildAmbiguousModel } from './lib/sampleModel';
import type { CrcModel } from './lib/types';

export default function App() {
  const [model, setModel] = useState<CrcModel>(() => buildSampleModel());
  const [importError, setImportError] = useState<string | null>(null);
  const { state, run, cancel, discard } = useInversion();

  const validationErrors = useMemo(() => validateModel(model), [model]);
  const running = state.status === 'running';

  const handleModelChange = (next: CrcModel) => {
    // 任何编辑都使旧结论失效（非法输入/陈旧结论不保留）
    discard();
    setImportError(null);
    setModel(next);
  };

  const handleRun = () => run(model, validationErrors);

  return (
    <div className="app">
      <header className="app-header">
        <h1>CRC 参数反演复核台</h1>
        <p className="subtitle">
          纯前端运行 · 候选配置族（宽度/移位方向/多项式）已知，init 与 xorOut 未知 ·
          GF(2) 约束精确统计全部解，不枚举 init/xorOut
        </p>
      </header>

      <div className="toolbar panel">
        <button type="button" className="primary" onClick={handleRun} disabled={running || validationErrors.length > 0}>
          {running ? '反演进行中…' : '启动反演'}
        </button>
        {running && (
          <button type="button" className="danger" onClick={cancel}>
            取消计算
          </button>
        )}
        <button
          type="button"
          onClick={() => handleModelChange(buildAmbiguousModel())}
          disabled={running}
          title="载入秩亏样本示例：相容候选将有 256 组解，用于查看歧义与第二见证"
        >
          载入歧义示例
        </button>
        <button
          type="button"
          onClick={() => handleModelChange(buildSampleModel())}
          disabled={running}
        >
          重置为唯一示例
        </button>
        {running && state.progress && (
          <span className="progress">
            已完成 {state.progress.done}/{state.progress.total} 个候选
          </span>
        )}
        {state.status === 'cancelled' && <span className="banner error inline">计算已取消，旧结论已作废</span>}
        {validationErrors.length > 0 && !running && (
          <span className="banner error inline">存在 {validationErrors.length} 项非法输入，修复后才能反演</span>
        )}
      </div>

      {state.status === 'invalid' && state.errors.length > 0 && (
        <div className="panel">
          <div className="banner error">
            <strong>非法输入，未执行反演（不保留旧结论）：</strong>
            <ul>
              {state.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <ModelEditor
        model={model}
        onChange={handleModelChange}
        onImportError={setImportError}
        importError={importError}
        disabled={running}
      />

      {validationErrors.length > 0 && (
        <div className="panel">
          <h2>输入问题</h2>
          <ul className="error-list">
            {validationErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {state.status === 'done' && state.report && (
        <WitnessPanel results={state.report.results} model={model} />
      )}

      <footer className="app-footer">
        本页面不调用任何业务后端；所有载荷、观测值与反演计算均停留在本机浏览器内。
      </footer>
    </div>
  );
}
