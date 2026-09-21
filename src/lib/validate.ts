import { maskFor, parseHex, parsePayload } from './hex';
import type { CrcModel } from './types';

/** 模型级合法性校验。返回全部错误；空数组表示可反演。 */
export function validateModel(model: CrcModel): string[] {
  const errors: string[] = [];

  if (!model.name.trim()) errors.push('模型名称为空');

  if (model.samples.length < 3) {
    errors.push(`载荷数量为 ${model.samples.length}，要求 3～64 条`);
  }
  if (model.samples.length > 64) {
    errors.push(`载荷数量为 ${model.samples.length}，要求 3～64 条`);
  }
  if (model.candidates.length === 0) {
    errors.push('候选配置为空（至多 128 项）');
  }
  if (model.candidates.length > 128) {
    errors.push(`候选配置为 ${model.candidates.length} 项，超过 128 项上限`);
  }

  const sampleIds = new Set<string>();
  for (const [i, s] of model.samples.entries()) {
    const where = `样本 #${i + 1}${s.id ? `（${s.id}）` : ''}`;
    if (!s.id.trim()) errors.push(`${where} 缺少唯一编号`);
    else if (sampleIds.has(s.id)) errors.push(`${where} 编号重复`);
    sampleIds.add(s.id);
    try {
      parsePayload(s.payload);
    } catch (e) {
      errors.push(`${where} 载荷非法：${(e as Error).message}`);
    }
    try {
      parseHex(s.observed);
    } catch (e) {
      errors.push(`${where} 观测值非法：${(e as Error).message}`);
    }
  }

  const candidateIds = new Set<string>();
  for (const [i, c] of model.candidates.entries()) {
    const where = `候选 #${i + 1}${c.id ? `（${c.id}）` : ''}`;
    if (!c.id.trim()) errors.push(`${where} 缺少唯一编号`);
    else if (candidateIds.has(c.id)) errors.push(`${where} 编号重复`);
    candidateIds.add(c.id);

    if (c.width !== 8 && c.width !== 16) {
      errors.push(`${where} 宽度必须为 8 或 16`);
      continue;
    }
    if (c.direction !== 'msb-first' && c.direction !== 'lsb-first') {
      errors.push(`${where} 移位方向必须为 msb-first 或 lsb-first`);
    }
    let poly: bigint;
    try {
      poly = parseHex(c.poly);
    } catch (e) {
      errors.push(`${where} 多项式非法：${(e as Error).message}`);
      continue;
    }
    if (poly > maskFor(c.width)) {
      errors.push(`${where} 多项式超出 ${c.width} 位宽度`);
    }
  }

  // 观测值宽度需与所属候选一致：模型允许多宽度候选并存，
  // 这里仅检查观测值不超过 16 位上界；按候选的超宽检查在求解时逐候选给出。
  for (const [i, s] of model.samples.entries()) {
    try {
      const obs = parseHex(s.observed);
      if (obs > 0xffffn) {
        errors.push(`样本 #${i + 1}（${s.id}）观测值超过 16 位上界`);
      }
    } catch {
      /* 已在前面记录 */
    }
  }

  return errors;
}
