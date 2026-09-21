import type { CrcModel, CandidateConfig, Sample, ShiftDirection } from './types';

/** 容错解析导入的模型 JSON；失败时抛出含原因的 Error。 */
export function parseModelJson(text: string): CrcModel {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON 语法错误：${(e as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('根节点必须是对象');
  const obj = raw as Record<string, unknown>;

  const name = typeof obj.name === 'string' ? obj.name : '导入的模型';
  if (!Array.isArray(obj.samples)) throw new Error('缺少 samples 数组');
  if (!Array.isArray(obj.candidates)) throw new Error('缺少 candidates 数组');

  const samples: Sample[] = obj.samples.map((sRaw, i) => {
    if (typeof sRaw !== 'object' || sRaw === null) throw new Error(`samples[${i}] 不是对象`);
    const s = sRaw as Record<string, unknown>;
    const id = stringField(s.id, `samples[${i}].id`) ?? `S${i + 1}`;
    const payload = stringField(s.payload, `samples[${i}].payload`);
    const observed = stringField(s.observed, `samples[${i}].observed`);
    if (payload === undefined) throw new Error(`samples[${i}] 缺少 payload（十六进制字符串）`);
    if (observed === undefined) throw new Error(`samples[${i}] 缺少 observed（十六进制字符串）`);
    return { id, payload, observed };
  });

  const candidates: CandidateConfig[] = obj.candidates.map((cRaw, i) => {
    if (typeof cRaw !== 'object' || cRaw === null) throw new Error(`candidates[${i}] 不是对象`);
    const c = cRaw as Record<string, unknown>;
    const id = stringField(c.id, `candidates[${i}].id`) ?? `C${i + 1}`;
    const widthNum = c.width;
    if (widthNum !== 8 && widthNum !== 16 && widthNum !== '8' && widthNum !== '16') {
      throw new Error(`candidates[${i}].width 必须为 8 或 16`);
    }
    const width = Number(widthNum) as 8 | 16;
    const directionRaw = stringField(c.direction, `candidates[${i}].direction`);
    let direction: ShiftDirection;
    if (directionRaw === 'msb-first' || directionRaw === 'msb' || directionRaw === 'left') {
      direction = 'msb-first';
    } else if (directionRaw === 'lsb-first' || directionRaw === 'lsb' || directionRaw === 'right' || directionRaw === 'reflected') {
      direction = 'lsb-first';
    } else {
      throw new Error(`candidates[${i}].direction 必须为 msb-first 或 lsb-first`);
    }
    const poly = stringField(c.poly, `candidates[${i}].poly`);
    if (poly === undefined) throw new Error(`candidates[${i}] 缺少 poly（十六进制）`);
    return { id, width, direction, poly };
  });

  return { name, samples, candidates };
}

function stringField(v: unknown, where: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number') return v.toString(16);
  if (typeof v === 'string') return v;
  throw new Error(`${where} 必须是字符串`);
}

export function modelToJson(model: CrcModel): string {
  return JSON.stringify(
    {
      name: model.name,
      samples: model.samples.map((s) => ({ id: s.id, payload: s.payload, observed: s.observed })),
      candidates: model.candidates.map((c) => ({
        id: c.id,
        width: c.width,
        direction: c.direction,
        poly: c.poly,
      })),
    },
    null,
    2,
  );
}
