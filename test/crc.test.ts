import { describe, expect, it } from 'vitest';
import { crcChecksum, crcFinalRegister, crcWithTrace } from '../src/lib/crc';
import type { CrcShape } from '../src/lib/crc';

const ascii = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));

describe('逐位 CRC 递推 — 标准校验值对照', () => {
  it('CRC-8/SMBUS 左移 poly=0x07 init=0 xorOut=0: "123456789" => F4', () => {
    const cfg: CrcShape = { width: 8, direction: 'left', poly: 0x07 };
    expect(crcChecksum(ascii('123456789'), cfg, 0x00, 0x00)).toBe(0xf4);
  });

  it('CRC-8/CCITT 参考向量（左移 0x07, init=0, 已知 F4）的末态寄存器与校验一致', () => {
    const cfg: CrcShape = { width: 8, direction: 'left', poly: 0x07 };
    expect(crcFinalRegister(ascii('123456789'), cfg, 0)).toBe(0xf4);
  });

  it('CRC-16/MODBUS 右移 poly=0xA001 init=FFFF xorOut=0: "123456789" => 4B37', () => {
    const cfg: CrcShape = { width: 16, direction: 'right', poly: 0xa001 };
    expect(crcChecksum(ascii('123456789'), cfg, 0xffff, 0x0000)).toBe(0x4b37);
  });

  it('CRC-16/CCITT-FALSE 左移 poly=0x1021 init=FFFF: "123456789" => 29B1', () => {
    const cfg: CrcShape = { width: 16, direction: 'left', poly: 0x1021 };
    expect(crcChecksum(ascii('123456789'), cfg, 0xffff, 0x0000)).toBe(0x29b1);
  });

  it('CRC-16/KERMIT 右移 poly=0x8408 init=0: "123456789" => 0x2189', () => {
    const cfg: CrcShape = { width: 16, direction: 'right', poly: 0x8408 };
    expect(crcChecksum(ascii('123456789'), cfg, 0x0000, 0x0000)).toBe(0x2189);
  });

  it('CRC-16/XMODEM 左移 poly=0x1021 init=0: "123456789" => 0x31C3', () => {
    const cfg: CrcShape = { width: 16, direction: 'left', poly: 0x1021 };
    expect(crcChecksum(ascii('123456789'), cfg, 0x0000, 0x0000)).toBe(0x31c3);
  });

  it('非零 init/xorOut 左移 8 位：轨迹末值 = checksum XOR xorOut', () => {
    const cfg: CrcShape = { width: 8, direction: 'left', poly: 0x1d };
    const t = crcWithTrace(ascii('ABC'), cfg, 0x6a, 0x33);
    expect(t.finalRegister ^ t.xorOut).toBe(t.checksum);
    // 轨迹首尾寄存器与纯函数一致
    expect(t.init).toBe(0x6a);
    expect(t.finalRegister).toBe(crcFinalRegister(ascii('ABC'), cfg, 0x6a));
    // 每拍都是合法 8 位值，且字节数 ×8 拍
    expect(t.steps.length).toBe(3 * 8);
    for (const st of t.steps) expect(st.registerAfter).toBeGreaterThanOrEqual(0);
    for (const st of t.steps) expect(st.registerAfter).toBeLessThanOrEqual(0xff);
  });

  it('右移轨迹：混合位取最低位，移位后为无符号右移', () => {
    const cfg: CrcShape = { width: 8, direction: 'right', poly: 0xe0 };
    const t = crcWithTrace(new Uint8Array([0x00]), cfg, 0x01, 0x00);
    // init=1 右移：第一拍 inBit=0, mixed=1, shifted=0, poly 生效
    expect(t.steps[0].mixed).toBe(1);
    expect(t.steps[0].shifted).toBe(0);
    expect(t.steps[0].appliedPoly).toBe(true);
    expect(t.steps[0].registerAfter).toBe(0xe0);
  });

  it('左移轨迹：混合位取最高位', () => {
    const cfg: CrcShape = { width: 8, direction: 'left', poly: 0x07 };
    const t = crcWithTrace(new Uint8Array([0x00]), cfg, 0x80, 0x00);
    // init=0x80：第一拍 inBit=0(MSB of 0), mixed=1, shifted=0, poly 生效
    expect(t.steps[0].mixed).toBe(1);
    expect(t.steps[0].shifted).toBe(0);
    expect(t.steps[0].registerAfter).toBe(0x07);
  });
});
