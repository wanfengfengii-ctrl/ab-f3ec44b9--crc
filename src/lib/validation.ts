// 模型校验：所有非法输入在此被拒绝，并给出定位信息。
// 规则：样本 3..64 条；候选 1..128 个；候选编号非空且全局唯一；
// 宽度仅 8/16；多项式在宽度位内；观测值在宽度位内（按每个候选宽度检查）。

import { parseHexBytes, parseUint, widthMask } from './hex';
import type { CandidateConfig, Model, Sample } from './types';

export interface ValidationIssue {
  scope: 'model' | 'sample' | 'candidate';
  index?: number;
  message: string;
}

export interface ValidSample extends Sample {
  bytes: Uint8Array;
}

export interface ValidModel {
  name: string;
  samples: ValidSample[];
  candidates: CandidateConfig[];
}

const DIRECTIONS = new Set(['left', 'right']);

/** 校验并归一化整个模型；不抛异常，返回全部问题（便于 UI 一次展示） */
export function validateModel(model: Model): { ok: true; model: ValidModel } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const name = (model.name ?? '').trim();
  if (name === '') issues.push({ scope: 'model', message: '模型名称不能为空' });

  // ---- 样本 ----
  const samples: ValidSample[] = [];
  if (!Array.isArray(model.samples)) {
    issues.push({ scope: 'model', message: '样本列表缺失或格式错误' });
  } else {
    if (model.samples.length < 3) issues.push({ scope: 'model', message: `至少需要 3 条样本（当前 ${model.samples.length} 条）` });
    if (model.samples.length > 64) issues.push({ scope: 'model', message: `样本至多 64 条（当前 ${model.samples.length} 条）` });
    model.samples.forEach((s, i) => {
      try {
        if (!s || typeof s.payloadHex !== 'string' || typeof s.observed !== 'number') {
          // 允许 observed 在编辑态为字符串？这里要求导入模型已是数字；UI 编辑态另有校验
          if (!s || typeof s.payloadHex !== 'string') throw new Error('样本格式错误');
          if (typeof (s as Sample).observed !== 'number') throw new Error('观测值必须是数字');
        }
        const bytes = parseHexBytes(s.payloadHex);
        const obs = (s.observed ?? NaN) as number;
        if (!Number.isInteger(obs) || obs < 0) throw new Error('观测值必须是非负整数');
        samples.push({ payloadHex: s.payloadHex, observed: obs, bytes });
      } catch (e) {
        issues.push({ scope: 'sample', index: i, message: (e as Error).message });
      }
    });
  }

  // ---- 候选 ----
  const candidates: CandidateConfig[] = [];
  if (!Array.isArray(model.candidates)) {
    issues.push({ scope: 'model', message: '候选配置列表缺失或格式错误' });
  } else {
    if (model.candidates.length === 0) issues.push({ scope: 'model', message: '至少需要 1 个候选配置' });
    if (model.candidates.length > 128) issues.push({ scope: 'model', message: `候选至多 128 个（当前 ${model.candidates.length} 个）` });
    const seenIds = new Set<string>();
    model.candidates.forEach((c, i) => {
      try {
        if (!c) throw new Error('候选格式错误');
        const id = String(c.id ?? '').trim();
        if (id === '') throw new Error('候选编号不能为空');
        if (seenIds.has(id)) throw new Error(`候选编号重复: ${id}`);
        seenIds.add(id);
        if (c.width !== 8 && c.width !== 16) throw new Error(`宽度仅允许 8 或 16（收到 ${String(c.width)}）`);
        if (!DIRECTIONS.has(c.direction)) throw new Error(`移位方向仅允许 left 或 right（收到 ${String(c.direction)}）`);
        const poly = Number(c.poly);
        if (!Number.isInteger(poly) || poly < 0 || poly > widthMask(c.width)) {
          throw new Error(`多项式必须是 0..${widthMask(c.width)} 内的整数（收到 ${String(c.poly)}）`);
        }
        candidates.push({ id, width: c.width, direction: c.direction, poly });
      } catch (e) {
        issues.push({ scope: 'candidate', index: i, message: (e as Error).message });
      }
    });
  }

  // 观测值范围不做跨候选硬性拒绝：混合宽度模型合法；观测值超出某候选宽度时，
  // 该候选在引擎中直接判「无解」并注明原因（见 engine.ts）。
  if (issues.length === 0) {
    const maxAny = Math.max(...candidates.map((c) => widthMask(c.width)));
    samples.forEach((s, si) => {
      if (s.observed > maxAny) {
        issues.push({
          scope: 'sample',
          index: si,
          message: `观测值 0x${s.observed.toString(16).toUpperCase()} 超出全部候选的最大宽度范围（<= 0x${maxAny
            .toString(16)
            .toUpperCase()}）`,
        });
      }
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, model: { name, samples, candidates } };
}

/** 从编辑表格的文本态观测值解析数字（UI 专用，宽松支持 0x） */
export function parseObservedInput(text: string): number {
  return parseUint(text);
}
