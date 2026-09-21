/** 数据模型：样本与候选配置族。全部解析/校验均在浏览器本地完成。 */

export type ShiftDirection = 'msb-first' | 'lsb-first';

/** 单个候选 CRC 配置（编号、宽度、移位方向、多项式）；init/xorOut 待反演。 */
export interface CandidateConfig {
  /** 候选在本模型内的唯一编号 */
  id: string;
  /** 寄存器宽度：8 或 16 位 */
  width: 8 | 16;
  /** 移位方向：msb-first（左移/常规）或 lsb-first（右移/反射） */
  direction: ShiftDirection;
  /**
   * 多项式的规整十六进制写法（宽度位，最高位隐含约定按宽度对齐）。
   * 例如 CRC-8：0x07；CRC-16/MODBUS：0x8005（反射方向内部自动取位序）。
   */
  poly: string;
}

/** 一份采集样本：十六进制载荷 + 观测到的校验值。 */
export interface Sample {
  id: string;
  /** 十六进制载荷，允许空白/0x 前缀，长度不限 */
  payload: string;
  /** 观测校验值（十六进制），按宽度位对齐解释 */
  observed: string;
}

/** 一份待复核模型（可由 JSON 导入或在页面编辑）。 */
export interface CrcModel {
  name: string;
  samples: Sample[];
  candidates: CandidateConfig[];
}

/** 逐位中间寄存器见证（用于逐样本核对）。 */
export interface StepTrace {
  /** 当前处理到的字节下标（0 起） */
  byteIndex: number;
  /** 当前处理到的位下标（0..7） */
  bitIndex: number;
  /** 该位移位、条件异或之前的寄存器值 */
  regBefore: bigint;
  /** 本拍参与异或的输入位（0/1） */
  inputBit: 0 | 1;
  /** 取出的寄存器端位（MSB 或 LSB，取决于方向） */
  endBit: 0 | 1;
  /** 本拍是否异或了多项式 */
  xored: boolean;
  /** 该拍结束后的寄存器值 */
  regAfter: bigint;
}

export interface SampleTrace {
  sampleId: string;
  init: bigint;
  steps: StepTrace[];
  /** 全部字节处理完、尚未异或 xorOut 的寄存器值 */
  register: bigint;
  xorOut: bigint;
  /** 最终校验值 = register ^ xorOut */
  checksum: bigint;
}

/** 单个候选的反演结论。 */
export type CandidateVerdict =
  | { kind: 'none' }
  | {
      kind: 'unique' | 'ambiguous';
      init: bigint;
      xorOut: bigint;
      /** 解空间维数 d；解的总数为 2^d（精确统计，不枚举 init/xorOut） */
      nullity: number;
      solutionCount: bigint;
      /** 字典序最小见证；歧义时附第二份见证 */
      second?: { init: bigint; xorOut: bigint };
    };

export interface CandidateResult {
  candidate: CandidateConfig;
  verdict: CandidateVerdict;
  /** 反演耗时（毫秒，便于审计） */
  elapsedMs: number;
  /** 未参与求解的原因（如观测值宽度与候选不匹配） */
  note?: string;
}

export interface InversionReport {
  modelName: string;
  startedAt: number;
  finishedAt: number;
  results: CandidateResult[];
  cancelled: boolean;
}
