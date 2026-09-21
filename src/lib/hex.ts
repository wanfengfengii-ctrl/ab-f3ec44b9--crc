/** 十六进制解析与宽度位掩码工具（不丢失前导位语义）。 */

export function parseHex(raw: string): bigint {
  const cleaned = raw.replace(/0x/gi, '').replace(/[\s_]/g, '');
  if (cleaned.length === 0) throw new Error('空的十六进制串');
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    throw new Error(`非法十六进制字符：${raw}`);
  }
  return BigInt('0x' + cleaned);
}

/** 载荷解析为字节序列；不足整字节（奇数个 hex 位）视为非法。 */
export function parsePayload(raw: string): Uint8Array {
  const cleaned = raw.replace(/0x/gi, '').replace(/[\s_-]/g, '');
  if (cleaned.length === 0) throw new Error('空载荷');
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    throw new Error(`载荷含非法十六进制字符：${raw}`);
  }
  if (cleaned.length % 2 !== 0) {
    throw new Error(`载荷字节未对齐（奇数个十六进制位）：${raw}`);
  }
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleaned.substr(i * 2, 2), 16);
  }
  return bytes;
}

export function maskFor(width: 8 | 16): bigint {
  return (1n << BigInt(width)) - 1n;
}

export function toHex(value: bigint, width: 8 | 16): string {
  const digits = width / 4;
  const mask = maskFor(width);
  return ((value & mask).toString(16).toUpperCase().padStart(digits, '0'));
}
