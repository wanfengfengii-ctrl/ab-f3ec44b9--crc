import { useMemo } from 'react';
import type { RunReport } from '../lib/types';
import type { ValidModel } from '../lib/validation';
import { ResultPanel, ResultSummary } from './ResultPanel';

export type VerdictFilter = 'all' | 'unique' | 'ambiguous' | 'no-solution';

interface Props {
  report: RunReport;
  validated: ValidModel;
  verdictFilter: VerdictFilter;
  onVerdictFilter: (f: VerdictFilter) => void;
  visibleCount: number;
  onShowMore: () => void;
}

const FILTERS: Array<{ key: VerdictFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'unique', label: '仅唯一' },
  { key: 'ambiguous', label: '仅歧义' },
  { key: 'no-solution', label: '仅无解' },
];

export function ResultSection({ report, validated, verdictFilter, onVerdictFilter, visibleCount, onShowMore }: Props) {
  const filtered = useMemo(
    () => (verdictFilter === 'all' ? report.results : report.results.filter((r) => r.verdict === verdictFilter)),
    [report.results, verdictFilter],
  );
  const shown = filtered.slice(0, visibleCount);

  return (
    <section>
      <div className="panel" style={{ padding: '12px 16px' }}>
        <h2 style={{ margin: 0, flexWrap: 'wrap' }}>
          ⑤ 结论
          <span style={{ marginLeft: 12 }}>
            <ResultSummary results={report.results} />
          </span>
        </h2>
        <div className="row" style={{ marginTop: 10 }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={verdictFilter === f.key ? 'primary tiny' : 'tiny'}
              onClick={() => onVerdictFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
          <span className="kv">
            当前显示 {shown.length}/{filtered.length}
          </span>
        </div>
      </div>
      {shown.map((r) => (
        <ResultPanel key={r.candidateId} result={r} model={validated} />
      ))}
      {visibleCount < filtered.length && (
        <div className="row" style={{ justifyContent: 'center', margin: '4px 0 16px' }}>
          <button onClick={onShowMore}>显示更多（剩余 {filtered.length - shown.length}）</button>
        </div>
      )}
      {filtered.length === 0 && <div className="alert info">当前筛选下没有候选。</div>}
    </section>
  );
}
