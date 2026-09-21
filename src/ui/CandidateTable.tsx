import type { CandidateRow, DraftModel } from '../lib/draft';

interface Props {
  draft: DraftModel;
  onChange: (next: DraftModel) => void;
}

/** 候选配置表：唯一编号、宽度 8/16、移位方向、多项式（支持 0x） */
export function CandidateTable({ draft, onChange }: Props) {
  const update = (i: number, patch: Partial<CandidateRow>) => {
    const candidates = draft.candidates.map((row, idx) => (idx === i ? { ...row, ...patch } : row));
    onChange({ ...draft, candidates });
  };
  const remove = (i: number) => onChange({ ...draft, candidates: draft.candidates.filter((_, idx) => idx !== i) });
  const add = () =>
    onChange({
      ...draft,
      candidates: [
        ...draft.candidates,
        { id: `C${draft.candidates.length + 1}`, width: 8, direction: 'left', polyText: '0x07' },
      ],
    });

  return (
    <div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th style={{ width: 180 }}>唯一编号</th>
              <th style={{ width: 110 }}>宽度</th>
              <th style={{ width: 150 }}>移位方向</th>
              <th style={{ width: 180 }}>多项式（裸多项式）</th>
              <th style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {draft.candidates.map((row, i) => (
              <tr key={i}>
                <td className="num">{i + 1}</td>
                <td>
                  <input type="text" spellCheck={false} value={row.id} onChange={(e) => update(i, { id: e.target.value })} />
                </td>
                <td>
                  <select value={row.width} onChange={(e) => update(i, { width: Number(e.target.value) as 8 | 16 })}>
                    <option value={8}>8 位</option>
                    <option value={16}>16 位</option>
                  </select>
                </td>
                <td>
                  <select value={row.direction} onChange={(e) => update(i, { direction: e.target.value as 'left' | 'right' })}>
                    <option value="left">left 左移</option>
                    <option value="right">right 右移</option>
                  </select>
                </td>
                <td>
                  <input type="text" spellCheck={false} value={row.polyText} onChange={(e) => update(i, { polyText: e.target.value })} />
                </td>
                <td>
                  <button className="tiny" onClick={() => remove(i)} disabled={draft.candidates.length <= 1}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="tiny" onClick={add} disabled={draft.candidates.length >= 128}>
          + 添加候选（{draft.candidates.length}/128）
        </button>
      </div>
    </div>
  );
}
