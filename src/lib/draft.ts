// 编辑态草稿：观测值/多项式在表格中以文本保留（支持 0x）；
// 启动反演时才严格解析，任何非法项都会阻止计算并清空旧结论。

import { parseUint, toHex } from './hex';
import type { Model } from './types';
import type { ValidationIssue } from './validation';

export interface SampleRow {
  payloadHex: string;
  observedText: string;
}

export interface CandidateRow {
  id: string;
  width: 8 | 16;
  direction: 'left' | 'right';
  polyText: string;
}

export interface DraftModel {
  name: string;
  samples: SampleRow[];
  candidates: CandidateRow[];
}

export function draftFromModel(model: Model): DraftModel {
  // 观测值按各候选宽度不一，编辑器统一以原值十六进制展示，宽度校验交给 validate
  return {
    name: model.name,
    samples: model.samples.map((s) => ({
      payloadHex: s.payloadHex,
      observedText: '0x' + s.observed.toString(16).toUpperCase(),
    })),
    candidates: model.candidates.map((c) => ({
      id: c.id,
      width: c.width,
      direction: c.direction,
      polyText: '0x' + toHex(c.poly, c.width),
    })),
  };
}

/** 严格解析草稿；返回问题列表（空数组即通过） */
export function draftToModel(draft: DraftModel): { ok: true; model: Model } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const samples = draft.samples.map((row, i) => {
    try {
      const observed = parseUint(row.observedText);
      return { payloadHex: row.payloadHex, observed };
    } catch (e) {
      issues.push({ scope: 'sample', index: i, message: `观测值非法：${(e as Error).message}` });
      return { payloadHex: row.payloadHex, observed: NaN };
    }
  });
  const candidates = draft.candidates.map((row, i) => {
    try {
      const poly = parseUint(row.polyText);
      return { id: row.id, width: row.width, direction: row.direction, poly };
    } catch (e) {
      issues.push({ scope: 'candidate', index: i, message: `多项式非法：${(e as Error).message}` });
      return { id: row.id, width: row.width, direction: row.direction, poly: NaN };
    }
  });
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, model: { name: draft.name, samples, candidates } };
}

export function emptyDraft(): DraftModel {
  return {
    name: '未命名模型',
    samples: [
      { payloadHex: '', observedText: '' },
      { payloadHex: '', observedText: '' },
      { payloadHex: '', observedText: '' },
    ],
    candidates: [{ id: 'C1', width: 8, direction: 'left', polyText: '0x07' }],
  };
}
