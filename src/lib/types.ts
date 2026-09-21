// 领域模型：样本、候选配置族、反演结论
// 所有计算均在浏览器内完成，不存在任何业务后端调用。

/** CRC 移位方向：left = 左移（MSB-first，反射位 false），right = 右移（LSB-first） */
export type ShiftDirection = 'left' | 'right';

/** 候选配置：编号唯一；宽度 8 或 16；多项式为宽度内裸多项式（不含隐式 x^width 项） */
export interface CandidateConfig {
  /** 候选唯一编号（非空字符串） */
  id: string;
  /** 寄存器宽度，仅允许 8 或 16 */
  width: 8 | 16;
  /** 移位方向 */
  direction: ShiftDirection;
  /** 多项式（宽度位内的生成多项式，如 CRC-8 为 0x07，CRC-16/MODBUS 右移为 0xA001） */
  poly: number;
}

/** 单条观测样本：十六进制载荷 + 观测到的最终校验值 */
export interface Sample {
  /** 十六进制文本，允许空格/0x 前缀/冒号分隔，字节数不限 */
  payloadHex: string;
  /** 观测校验值（无符号整数，必须 < 2^width；不同候选宽度复用时按各自宽度截断校验） */
  observed: number;
}

/** 一份完整的反演任务 */
export interface Model {
  name: string;
  samples: Sample[];
  candidates: CandidateConfig[];
}

/** 单条样本的逐位寄存器轨迹（供工程师逐样本核对中间寄存器） */
export interface RegisterTrace {
  /** 初始寄存器（反演解出的 init） */
  init: number;
  /** 每个字节处理后的寄存器值 */
  afterByte: number[];
  /** 每一步：byteIndex/bitIndex 取值，inBit 输入位，mixed 参与异或的那一位，shifted 移位后值，xoredPoly 是否异或了多项式 */
  steps: TraceStep[];
  /** 异或 xorOut 之前的寄存器 */
  finalRegister: number;
  /** xorOut */
  xorOut: number;
  /** 最终校验值 = finalRegister XOR xorOut */
  checksum: number;
}

export interface TraceStep {
  byteIndex: number;
  bitIndex: number;
  inBit: 0 | 1;
  mixed: 0 | 1;
  shifted: number;
  appliedPoly: boolean;
  registerAfter: number;
}

/** 候选反演结论分类 */
export type Verdict = 'no-solution' | 'unique' | 'ambiguous';

/** 一组 (init, xorOut) 见证 */
export interface Witness {
  init: number;
  xorOut: number;
}

/** 单个候选的精确反演结果 */
export interface CandidateResult {
  candidateId: string;
  verdict: Verdict;
  /** GF(2) 精确解数 = 2^nullity（字符串形式，16 位 + 128 样本时可到 2^16） */
  solutionCount: string;
  /** 约束矩阵秩 */
  rank: number;
  /** 零化度（自由位个数） */
  nullity: number;
  /** 字典序最小见证（按 init 高位优先、再 xorOut 高位优先排序）；无解时为 null */
  witness: Witness | null;
  /** 歧义时字典序第二小见证；唯一/无解时为 null */
  secondWitness: Witness | null;
  /** 逐样本轨迹（字典序最小见证，有解时生成，用于核对中间寄存器与最终校验值） */
  traces: RegisterTrace[] | null;
  /** 歧义时字典序第二小见证的逐样本轨迹 */
  secondTraces: RegisterTrace[] | null;
  /** 每条样本观测值是否与最小见证的最终校验值一致（用于 UI 强校验展示） */
  matched: boolean[];
  /** 第二见证逐条样本一致性 */
  secondMatched: boolean[];
  /** 计算耗时（毫秒） */
  elapsedMs: number;
  /** 附注（如观测值超出候选宽度，直接判无解的原因） */
  note?: string;
}

/** 整次反演运行的汇总 */
export interface RunReport {
  modelName: string;
  startedAt: number;
  finishedAt: number;
  cancelled: boolean;
  results: CandidateResult[];
}
