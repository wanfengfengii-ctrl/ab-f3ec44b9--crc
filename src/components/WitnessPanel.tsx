import { useMemo, useState } from 'react';
import { runCrc } from '../lib/crc';
import { maskFor, parseHex, parsePayload, toHex } from '../lib/hex';
import type { CandidateResult, CrcModel } from '../lib/types';

interface Props {
  results: CandidateResult[];
  model: CrcModel;
}

type WitnessPick = 'first' | 'second';

export function WitnessPanel({ results, model }: Props) {
  const solvable = results.filter((r) => r.verdict.kind !== 'none');
  const [selectedId, setSelectedId] = useState<string | null>(solvable[0]?.candidate.id ?? null);
  const selected = results.find((r) => r.candidate.id === selectedId) ?? solvable[0];

  const counts = useMemo(() => {
    let none = 0;
    let unique = 0;
    let ambiguous = 0;
    for (const r of results) {
      if (r.verdict.kind === 'none') none++;
      else if (r.verdict.kind === 'unique') unique++;
      else ambiguous++;
    }
    return { none, unique, ambiguous };
  }, [results]);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>反演结论与参数见证</h2>
        <div className="summary">
          <span className="chip chip-none">无解 {counts.none}</span>
          <span className="chip chip-unique">唯一 {counts.unique}</span>
          <span className="chip chip-amb">歧义 {counts.ambiguous}</span>
        </div>
      </div>

      <div className="table-wrap">
        <table className="result-table">
          <thead>
            <tr>
              <th>编号</th>
              <th>宽度</th>
              <th>方向</th>
              <th>多项式</th>
              <th>判定</th>
              <th>解数（GF(2) 精确统计）</th>
              <th>init（字典序最小见证）</th>
              <th>xorOut</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const v = r.verdict;
              const isSel = selected?.candidate.id === r.candidate.id;
              return (
                <tr key={r.candidate.id} className={isSel ? 'row-sel' : ''}>
                  <td className="mono">{r.candidate.id}</td>
                  <td>{r.candidate.width}</td>
                  <td>{r.candidate.direction === 'msb-first' ? 'MSB→' : '←LSB'}</td>
                  <td className="mono">0x{r.candidate.poly.toUpperCase()}</td>
                  <td>
                    {v.kind === 'none' && <span className="tag tag-none">无解</span>}
                    {v.kind === 'unique' && <span className="tag tag-unique">唯一</span>}
                    {v.kind === 'ambiguous' && <span className="tag tag-amb">歧义</span>}
                    {r.note && <div className="cell-note">{r.note}</div>}
                  </td>
                  <td className="mono">
                    {v.kind === 'none' ? '0' : formatCount(v.solutionCount, v.nullity)}
                  </td>
                  <td className="mono">{v.kind === 'none' ? '—' : `0x${toHex(v.init, r.candidate.width)}`}</td>
                  <td className="mono">{v.kind === 'none' ? '—' : `0x${toHex(v.xorOut, r.candidate.width)}`}</td>
                  <td>
                    {v.kind !== 'none' && (
                      <button type="button" className="link" onClick={() => setSelectedId(r.candidate.id)}>
                        核对
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && selected.verdict.kind !== 'none' && (
        <TraceInspector key={selected.candidate.id} result={selected} model={model} />
      )}
    </section>
  );
}

function formatCount(count: bigint, nullity: number): string {
  if (nullity <= 10) return count.toString();
  return `2^${nullity}（=${count.toString()}）`;
}

function TraceInspector({ result, model }: { result: CandidateResult; model: CrcModel }) {
  const v = result.verdict;
  const ambiguous = v.kind === 'ambiguous';
  const [pick, setPick] = useState<WitnessPick>('first');
  const [sampleId, setSampleId] = useState(model.samples[0]?.id ?? '');
  const sample = model.samples.find((s) => s.id === sampleId) ?? model.samples[0];

  const witness = pick === 'first' || !ambiguous || !v.second
    ? { init: v.kind === 'none' ? 0n : v.init, xorOut: v.kind === 'none' ? 0n : v.xorOut }
    : v.second;

  const trace = useMemo(() => {
    if (!sample) return null;
    let bytes: Uint8Array;
    let obs: bigint;
    try {
      bytes = parsePayload(sample.payload);
      obs = parseHex(sample.observed);
    } catch {
      return null;
    }
    const out = runCrc({
      width: result.candidate.width,
      poly: parseHex(result.candidate.poly) & maskFor(result.candidate.width),
      direction: result.candidate.direction,
      bytes,
      init: witness.init,
      xorOut: witness.xorOut,
      trace: true,
    });
    return { ...out, obs, bytes };
  }, [sample, result, witness.init, witness.xorOut]);

  if (!sample || !trace) return <div className="banner error">样本数据非法，无法生成逐位见证。</div>;

  const match = trace.checksum === trace.obs;

  return (
    <div className="inspector">
      <div className="inspector-head">
        <h3>
          逐样本核对 · 候选 <span className="mono">{result.candidate.id}</span>
        </h3>
        <div className="btn-row">
          {ambiguous && (
            <div className="witness-switch" role="group">
              <button
                type="button"
                className={pick === 'first' ? 'seg seg-on' : 'seg'}
                onClick={() => setPick('first')}
              >
                最小见证
              </button>
              <button
                type="button"
                className={pick === 'second' ? 'seg seg-on' : 'seg'}
                onClick={() => setPick('second')}
              >
                第二见证
              </button>
            </div>
          )}
          <select value={sampleId} onChange={(e) => setSampleId(e.target.value)}>
            {model.samples.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="witness-box">
        <div>
          init = <b className="mono">0x{toHex(witness.init, result.candidate.width)}</b>
        </div>
        <div>
          xorOut = <b className="mono">0x{toHex(witness.xorOut, result.candidate.width)}</b>
        </div>
        {ambiguous && v.kind === 'ambiguous' && v.second && (
          <div className="hint">
            歧义：共 {formatCount(v.solutionCount, v.nullity)} 组 (init, xorOut)
            均满足全部样本。当前展示字典序{pick === 'first' ? '最小' : '第二小'}见证；
            第二见证 init=0x{toHex(v.second.init, result.candidate.width)}，
            xorOut=0x{toHex(v.second.xorOut, result.candidate.width)}。
          </div>
        )}
        {v.kind === 'unique' && <div className="hint">唯一解：该候选下不存在其它 (init, xorOut) 组合。</div>}
      </div>

      <div className={match ? 'banner ok' : 'banner error'}>
        最终校验值 <span className="mono">0x{toHex(trace.checksum, result.candidate.width)}</span>
        {' '}vs 观测值 <span className="mono">0x{toHex(trace.obs, result.candidate.width)}</span>
        ：{match ? '一致 ✓' : '不一致 ✗'}
        <span className="hint-inline">（寄存器终态 0x{toHex(trace.register, result.candidate.width)}
        {' '}XOR xorOut 0x{toHex(witness.xorOut, result.candidate.width)}）</span>
      </div>

      <details className="steps">
        <summary>逐位中间寄存器（{trace.steps.length} 拍，点击展开）</summary>
        <div className="table-wrap steps-wrap">
          <table className="step-table">
            <thead>
              <tr>
                <th>#</th>
                <th>字节</th>
                <th>位序</th>
                <th>移位前寄存器</th>
                <th>端位</th>
                <th>输入位</th>
                <th>混合位</th>
                <th>异或多项式</th>
                <th>移位后寄存器</th>
              </tr>
            </thead>
            <tbody>
              {trace.steps.map((st, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td className="mono">{trace.bytes[st.byteIndex].toString(16).toUpperCase().padStart(2, '0')}</td>
                  <td>{st.bitIndex}</td>
                  <td className="mono">{toHex(st.regBefore, result.candidate.width)}</td>
                  <td>{st.endBit}</td>
                  <td>{st.inputBit}</td>
                  <td className={st.xored ? 'mixed-1' : ''}>{st.endBit ^ st.inputBit}</td>
                  <td>{st.xored ? '是' : ''}</td>
                  <td className="mono">{toHex(st.regAfter, result.candidate.width)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
