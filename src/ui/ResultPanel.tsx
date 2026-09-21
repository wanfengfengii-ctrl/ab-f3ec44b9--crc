import { Fragment, useState } from 'react';
import type { CandidateResult } from '../lib/types';
import type { ValidModel } from '../lib/validation';
import { toHex } from '../lib/hex';

const VERDICT_TEXT: Record<CandidateResult['verdict'], string> = {
  'no-solution': '无解',
  unique: '唯一',
  ambiguous: '歧义',
};

function WitnessBox({ title, w, width }: { title: string; w: { init: number; xorOut: number }; width: 8 | 16 }) {
  return (
    <div className="witness-box">
      <div className="wtitle">{title}</div>
      <div>
        <span className="kv">init = </span>
        <b>0x{toHex(w.init, width)}</b>
        <span className="kv" style={{ marginLeft: 16 }}>
          xorOut ={' '}
        </span>
        <b>0x{toHex(w.xorOut, width)}</b>
      </div>
    </div>
  );
}

function TraceViewer({ result, model }: { result: CandidateResult; model: ValidModel }) {
  const [which, setWhich] = useState<'first' | 'second'>('first');
  const traces = which === 'first' ? result.traces : result.secondTraces;
  const matched = which === 'first' ? result.matched : result.secondMatched;
  const candidate = model.candidates.find((c) => c.id === result.candidateId)!;
  const width = candidate.width;
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  if (!traces) return null;

  return (
    <div>
      {result.verdict === 'ambiguous' && (
        <div className="row" style={{ margin: '8px 0' }}>
          <button className={which === 'first' ? 'primary tiny' : 'tiny'} onClick={() => { setWhich('first'); setOpenIdx(null); }}>
            最小见证轨迹
          </button>
          <button className={which === 'second' ? 'primary tiny' : 'tiny'} onClick={() => { setWhich('second'); setOpenIdx(null); }}>
            第二见证轨迹
          </button>
        </div>
      )}
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>载荷</th>
              <th className="num">观测值</th>
              <th className="num">重算校验值</th>
              <th className="num" style={{ width: 70 }}>核对</th>
            </tr>
          </thead>
          <tbody>
            {model.samples.map((s, i) => {
              const t = traces[i];
              const ok = matched[i];
              return (
                <Fragment key={i}>
                  <tr>
                    <td className="num">{i + 1}</td>
                    <td className="mono">
                      {s.payloadHex.length > 48 ? s.payloadHex.slice(0, 48) + '…' : s.payloadHex}
                    </td>
                    <td className="num">0x{toHex(s.observed, width)}</td>
                    <td className="num">0x{toHex(t.checksum, width)}</td>
                    <td className="num">
                      <span className={ok ? 'match-ok' : 'match-bad'}>{ok ? '✓ 一致' : '✗ 不符'}</span>
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={5} style={{ padding: 0, borderBottom: openIdx === i ? '1px solid var(--border)' : 'none' }}>
                      <details
                        className="trace"
                        style={{ margin: 6, border: 'none', background: 'transparent' }}
                        open={openIdx === i}
                        onToggle={(e) => setOpenIdx((e.target as HTMLDetailsElement).open ? i : null)}
                      >
                        <summary>逐位寄存器轨迹（{candidate.direction === 'left' ? 'MSB→LSB 左移' : 'LSB→MSB 右移'}，poly=0x{toHex(candidate.poly, width)}）</summary>
                        {openIdx === i && (
                        <>
                        <div className="trace-grid">
                          <div>init = 0x{toHex(t.init, width)}</div>
                          <div>finalReg = 0x{toHex(t.finalRegister, width)}</div>
                          <div>xorOut = 0x{toHex(t.xorOut, width)}</div>
                          <div>checksum = 0x{toHex(t.checksum, width)}</div>
                        </div>
                        <div className="steps">
                          <table>
                            <thead>
                              <tr>
                                <th className="num">拍</th>
                                <th className="num">字节#</th>
                                <th className="num">输入位</th>
                                <th className="num">混合位</th>
                                <th className="num">移位后</th>
                                <th className="num">异或多项式</th>
                                <th className="num">寄存器</th>
                              </tr>
                            </thead>
                            <tbody>
                              {t.steps.map((st, k) => (
                                <tr key={k}>
                                  <td className="num">{k + 1}</td>
                                  <td className="num">{st.byteIndex}.{st.bitIndex}</td>
                                  <td className="num">{st.inBit}</td>
                                  <td className="num">{st.mixed}</td>
                                  <td className="num">0x{toHex(st.shifted, width)}</td>
                                  <td className="num">{st.appliedPoly ? '1 ⊕ poly' : '—'}</td>
                                  <td className="num">0x{toHex(st.registerAfter, width)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        </>
                        )}
                      </details>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ResultPanel({ result, model }: { result: CandidateResult; model: ValidModel }) {
  const candidate = model.candidates.find((c) => c.id === result.candidateId)!;
  return (
    <div className="panel">
      <h2>
        <span className={`badge ${result.verdict}`}>{VERDICT_TEXT[result.verdict]}</span>
        候选 {candidate.id}
        <span className="kv" style={{ fontWeight: 400, fontSize: 12 }}>
          width={candidate.width} · {candidate.direction} · poly=0x{toHex(candidate.poly, candidate.width)}
        </span>
      </h2>
      <div className="pill-group">
        <span className="count-pill">
          精确解数 <b>{result.solutionCount}</b>
          {result.verdict !== 'no-solution' && <>（=2^{result.nullity}）</>}
        </span>
        <span className="count-pill">
          秩 <b>{result.rank}</b>
        </span>
        {result.verdict !== 'no-solution' && (
          <span className="count-pill">
            零化度 <b>{result.nullity}</b>
          </span>
        )}
        <span className="count-pill">
          耗时 <b>{result.elapsedMs} ms</b>
        </span>
      </div>

      {result.verdict === 'no-solution' && (
        <div className="alert error" style={{ marginTop: 10 }}>
          {result.note ??
            'GF(2) 约束出现矛盾行：不存在任何 (init, xorOut) 能同时满足全部样本，该候选排除。'}
        </div>
      )}
      {result.witness && <WitnessBox title={result.verdict === 'ambiguous' ? '字典序最小见证' : '唯一见证'} w={result.witness} width={candidate.width} />}
      {result.secondWitness && <WitnessBox title="字典序第二小见证（用于辨别歧义）" w={result.secondWitness} width={candidate.width} />}
      {result.traces && <TraceViewer result={result} model={model} />}
    </div>
  );
}

export function ResultSummary({ results }: { results: CandidateResult[] }) {
  const u = results.filter((r) => r.verdict === 'unique').length;
  const a = results.filter((r) => r.verdict === 'ambiguous').length;
  const n = results.filter((r) => r.verdict === 'no-solution').length;
  return (
    <div className="pill-group">
      <span className="count-pill">唯一 <b>{u}</b></span>
      <span className="count-pill">歧义 <b>{a}</b></span>
      <span className="count-pill">无解 <b>{n}</b></span>
      <span className="count-pill">共 <b>{results.length}</b> 个候选</span>
    </div>
  );
}
