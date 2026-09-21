// 模型导入/导出：仅处理本地 JSON，不发起任何网络请求。
// 支持单模型 { name, samples:[{payloadHex, observed}], candidates:[{id,width,direction,poly}] }
// observed 允许写成数字或字符串（"0x.."），导入时统一归一化。

import { parseUint } from './hex';
import type { Model, Sample } from './types';

export function serializeModel(model: Model): string {
  return JSON.stringify(model, null, 2);
}

export function parseModelText(text: string): Model {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON 解析失败: ${(e as Error).message}`);
  }
  if (typeof data !== 'object' || data === null) throw new Error('模型必须是 JSON 对象');
  const obj = data as Record<string, unknown>;
  if (typeof obj.name !== 'string') throw new Error('缺少 name（字符串）');
  if (!Array.isArray(obj.samples)) throw new Error('缺少 samples（数组）');
  if (!Array.isArray(obj.candidates)) throw new Error('缺少 candidates（数组）');

  const samples: Sample[] = (obj.samples as unknown[]).map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) throw new Error(`样本 #${i + 1} 不是对象`);
    const r = raw as Record<string, unknown>;
    if (typeof r.payloadHex !== 'string') throw new Error(`样本 #${i + 1} 缺少 payloadHex（字符串）`);
    let observed: number;
    if (typeof r.observed === 'number') observed = r.observed;
    else if (typeof r.observed === 'string') {
      try {
        observed = parseUint(r.observed);
      } catch (e) {
        throw new Error(`样本 #${i + 1} 观测值非法: ${(e as Error).message}`);
      }
    } else {
      throw new Error(`样本 #${i + 1} 缺少 observed（数字或 0x 字符串）`);
    }
    return { payloadHex: r.payloadHex, observed };
  });

  const candidates = (obj.candidates as unknown[]).map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) throw new Error(`候选 #${i + 1} 不是对象`);
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string') throw new Error(`候选 #${i + 1} 缺少 id`);
    const width = Number(r.width);
    const poly = typeof r.poly === 'string' ? parseUint(r.poly) : Number(r.poly);
    const direction = String(r.direction);
    return { id: r.id, width: width as 8 | 16, direction: direction as 'left' | 'right', poly };
  });

  return { name: obj.name, samples, candidates };
}
