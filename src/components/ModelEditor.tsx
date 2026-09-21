import { useRef } from 'react';
import type { CrcModel, CandidateConfig, Sample, ShiftDirection } from '../lib/types';
import { modelToJson, parseModelJson } from '../lib/modelIO';

interface Props {
  model: CrcModel;
  onChange: (next: CrcModel) => void;
  onImportError: (msg: string | null) => void;
  importError: string | null;
  disabled?: boolean;
}

export function ModelEditor({ model, onChange, onImportError, importError, disabled }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const patch = (p: Partial<CrcModel>) => onChange({ ...model, ...p });

  const updateSample = (i: number, p: Partial<Sample>) => {
    const samples = model.samples.slice();
    samples[i] = { ...samples[i], ...p };
    patch({ samples });
  };
  const updateCandidate = (i: number, p: Partial<CandidateConfig>) => {
    const candidates = model.candidates.slice();
    candidates[i] = { ...candidates[i], ...p };
    patch({ candidates });
  };

  const removeSample = (i: number) => patch({ samples: model.samples.filter((_, j) => j !== i) });
  const removeCandidate = (i: number) =>
    patch({ candidates: model.candidates.filter((_, j) => j !== i) });

  const addSample = () => {
    if (model.samples.length >= 64) return;
    patch({
      samples: [
        ...model.samples,
        { id: nextId(model.samples.map((s) => s.id), 'S'), payload: '', observed: '' },
      ],
    });
  };
  const addCandidate = () => {
    if (model.candidates.length >= 128) return;
    patch({
      candidates: [
        ...model.candidates,
        {
          id: nextId(model.candidates.map((c) => c.id), 'C'),
          width: 8,
          direction: 'msb-first',
          poly: '07',
        },
      ],
    });
  };

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseModelJson(text);
      onChange(parsed);
      onImportError(null);
    } catch (e) {
      onImportError(`导入失败：${(e as Error).message}`);
    }
  };

  const exportJson = () => {
    const blob = new Blob([modelToJson(model)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${model.name.trim() || 'crc-model'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>模型编辑</h2>
        <div className="btn-row">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={disabled}>
            导入 JSON
          </button>
          <button type="button" onClick={exportJson} disabled={disabled}>
            导出 JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      {importError && <div className="banner error">{importError}</div>}

      <label className="field">
        <span>模型名称</span>
        <input
          value={model.name}
          onChange={(e) => patch({ name: e.target.value })}
          disabled={disabled}
        />
      </label>

      <h3 className="table-title">
        载荷与观测值
        <span className="count">
          {model.samples.length}/64（要求 3～64 条）
        </span>
      </h3>
      <div className="table-wrap">
        <table className="edit-table">
          <thead>
            <tr>
              <th style={{ width: '7rem' }}>编号</th>
              <th>十六进制载荷</th>
              <th style={{ width: '8rem' }}>观测校验值</th>
              <th style={{ width: '3rem' }} />
            </tr>
          </thead>
          <tbody>
            {model.samples.map((s, i) => (
              <tr key={i}>
                <td>
                  <input
                    value={s.id}
                    onChange={(e) => updateSample(i, { id: e.target.value })}
                    disabled={disabled}
                  />
                </td>
                <td>
                  <input
                    className="mono"
                    placeholder="01 03 00 2A …"
                    value={s.payload}
                    onChange={(e) => updateSample(i, { payload: e.target.value })}
                    disabled={disabled}
                  />
                </td>
                <td>
                  <input
                    className="mono"
                    value={s.observed}
                    onChange={(e) => updateSample(i, { observed: e.target.value })}
                    disabled={disabled}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="link-danger"
                    onClick={() => removeSample(i)}
                    disabled={disabled}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="add-btn" onClick={addSample} disabled={disabled || model.samples.length >= 64}>
        + 添加样本
      </button>

      <h3 className="table-title">
        候选配置族
        <span className="count">{model.candidates.length}/128（init / xorOut 未知，由反演确定）</span>
      </h3>
      <div className="table-wrap">
        <table className="edit-table">
          <thead>
            <tr>
              <th style={{ width: '7rem' }}>编号</th>
              <th style={{ width: '7rem' }}>宽度</th>
              <th style={{ width: '12rem' }}>移位方向</th>
              <th>多项式（hex）</th>
              <th style={{ width: '3rem' }} />
            </tr>
          </thead>
          <tbody>
            {model.candidates.map((c, i) => (
              <tr key={i}>
                <td>
                  <input
                    value={c.id}
                    onChange={(e) => updateCandidate(i, { id: e.target.value })}
                    disabled={disabled}
                  />
                </td>
                <td>
                  <select
                    value={c.width}
                    onChange={(e) => updateCandidate(i, { width: Number(e.target.value) as 8 | 16 })}
                    disabled={disabled}
                  >
                    <option value={8}>8 位</option>
                    <option value={16}>16 位</option>
                  </select>
                </td>
                <td>
                  <select
                    value={c.direction}
                    onChange={(e) => updateCandidate(i, { direction: e.target.value as ShiftDirection })}
                    disabled={disabled}
                  >
                    <option value="msb-first">左移 · MSB-first</option>
                    <option value="lsb-first">右移 · LSB-first（反射）</option>
                  </select>
                </td>
                <td>
                  <input
                    className="mono"
                    value={c.poly}
                    onChange={(e) => updateCandidate(i, { poly: e.target.value })}
                    disabled={disabled}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="link-danger"
                    onClick={() => removeCandidate(i)}
                    disabled={disabled}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="add-btn" onClick={addCandidate} disabled={disabled || model.candidates.length >= 128}>
        + 添加候选
      </button>
    </section>
  );
}

function nextId(ids: string[], prefix: string): string {
  const used = new Set(ids);
  for (let n = 1; n < 1000; n++) {
    const id = `${prefix}${n}`;
    if (!used.has(id)) return id;
  }
  return `${prefix}-${Date.now()}`;
}
