import type { DraftModel, SampleRow } from '../lib/draft';

interface Props {
  draft: DraftModel;
  onChange: (next: DraftModel) => void;
}

/** 样本编辑表：载荷十六进制 + 观测值（支持 0x） */
export function SampleTable({ draft, onChange }: Props) {
  const update = (i: number, patch: Partial<SampleRow>) => {
    const samples = draft.samples.map((row, idx) => (idx === i ? { ...row, ...patch } : row));
    onChange({ ...draft, samples });
  };
  const remove = (i: number) => onChange({ ...draft, samples: draft.samples.filter((_, idx) => idx !== i) });
  const add = () => onChange({ ...draft, samples: [...draft.samples, { payloadHex: '', observedText: '' }] });

  return (
    <div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>十六进制载荷（空格/冒号/0x 分隔均可）</th>
              <th style={{ width: 160 }}>观测校验值</th>
              <th style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {draft.samples.map((row, i) => (
              <tr key={i}>
                <td className="num">{i + 1}</td>
                <td>
                  <input
                    type="text"
                    spellCheck={false}
                    placeholder="如 01 03 00 00 00 0A"
                    value={row.payloadHex}
                    onChange={(e) => update(i, { payloadHex: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    spellCheck={false}
                    placeholder="0x.."
                    value={row.observedText}
                    onChange={(e) => update(i, { observedText: e.target.value })}
                  />
                </td>
                <td>
                  <button className="tiny" onClick={() => remove(i)} disabled={draft.samples.length <= 1}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="tiny" onClick={add} disabled={draft.samples.length >= 64}>
          + 添加样本（{draft.samples.length}/64，至少 3）
        </button>
      </div>
    </div>
  );
}
