// 十六进制与数值解析：严格校验，非法输入给出明确错误，绝不静默写默认值。

/** 去除 0x 前缀、空白、冒号、连字符后的纯十六进制串解析为字节数组 */
export function parseHexBytes(text: string): Uint8Array {
  if (typeof text !== 'string') throw new Error('载荷必须是文本');
  const cleaned = text
    .replace(/0x/gi, '')
    .replace(/[\s:.-]/g, '');
  if (cleaned.length === 0) throw new Error('载荷为空');
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    throw new Error('载荷含非十六进制字符（仅允许 0-9 a-f，及空格/冒号/0x 分隔）');
  }
  if (cleaned.length % 2 !== 0) {
    throw new Error('载荷十六进制字符数必须为偶数（完整字节）');
  }
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(cleaned.substr(i * 2, 2), 16);
  }
  return out;
}

/** 无符号整数解析：支持 0x 十六进制与十进制 */
export function parseUint(text: string): number {
  const t = String(text ?? '').trim();
  if (t === '') throw new Error('数值为空');
  let v: number;
  if (/^0x[0-9a-fA-F]+$/.test(t)) {
    v = parseInt(t.slice(2), 16);
  } else if (/^[0-9]+$/.test(t)) {
    v = Number(t);
  } else {
    throw new Error(`非法数值: ${t}（允许十进制或 0x 十六进制）`);
  }
  if (!Number.isSafeInteger(v) || v < 0) throw new Error(`非法数值: ${t}`);
  return v;
}

/** 宽度对应掩码 */
export function widthMask(width: 8 | 16): number {
  return width === 8 ? 0xff : 0xffff;
}

/** 转定宽十六进制（大写，不带前缀），如 toHex(7,8) => "07" */
export function toHex(v: number, width: 8 | 16): string {
  const digits = width === 8 ? 2 : 4;
  return (v >>> 0).toString(16).toUpperCase().padStart(digits, '0');
}

/** 字节数组转美观十六进制（空格分隔） */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}
