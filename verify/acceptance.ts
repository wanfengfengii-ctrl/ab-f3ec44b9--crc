/**
 * 一次性验收服务（verify）：
 *  - 数学层：独立目录 CRC 参考值 + 小规模 init/xorOut 暴力枚举，
 *    交叉核对反演器的无解/唯一/歧义判定、精确解数、字典序最小/次小见证。
 *    注意：暴力枚举仅存在于本验收夹具中，产品审计路径（src/lib/gf2.ts）绝不枚举。
 *  - 服务层（容器内，给出 BASE_URL 时）：静态站点与 /healthz 必须可访问。
 * 退出码 0 = 全部通过；非 0 = 存在失败项。
 */
import { runCrc } from '../src/lib/crc';
import { solveCandidate } from '../src/lib/gf2';
import { validateModel } from '../src/lib/validate';
import { parseModelJson } from '../src/lib/modelIO';
import { maskFor, parseHex, parsePayload } from '../src/lib/hex';
import type { CandidateConfig, CrcModel, Sample } from '../src/lib/types';

interface TestFailure {
  name: string;
  detail: string;
}

const failures: TestFailure[] = [];
let passed = 0;

function check(name: string, cond: boolean, detail = '') {
  if (cond) passed += 1;
  else failures.push({ name, detail });
}

function asciiBytes(s: string): Uint8Array {
  return Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
}

function makeSamples(
  cand: CandidateConfig,
  payloads: string[],
  init: bigint,
  xorOut: bigint,
): Sample[] {
  const poly = parseHex(cand.poly) & maskFor(cand.width);
  return payloads.map((p, i) => {
    const out = runCrc({
      width: cand.width,
      poly,
      direction: cand.direction,
      bytes: parsePayload(p),
      init,
      xorOut,
    });
    return {
      id: `S${i + 1}`,
      payload: p,
      observed: out.checksum.toString(16).toUpperCase().padStart(cand.width / 4, '0'),
    };
  });
}

/** 验收专用：小规模（8 位）暴力枚举全部 init/xorOut，作为独立对照。 */
function bruteForce(cand: CandidateConfig, samples: Sample[]): Array<[number, number]> {  const poly = parseHex(cand.poly) & maskFor(cand.width);
  const parsed = samples.map((s) => ({ bytes: parsePayload(s.payload), obs: parseHex(s.observed) }));
  const hits: Array<[number, number]> = [];
  for (let init = 0; init < 256; init++) {
    for (let xor = 0; xor < 256; xor++) {
      const ok = parsed.every(({ bytes, obs }) => {
        const r = runCrc({
          width: 8,
          poly,
          direction: cand.direction,
          bytes,
          init: BigInt(init),
          xorOut: BigInt(xor),
        });
        return r.checksum === obs;
      });
      if (ok) hits.push([init, xor]);
    }
  }
  return hits;
}

// ---------- 1. 逐位递推对照公开 CRC 目录的 check 值 ----------
{
  // CRC-8/SMBUS：poly=0x07，msb-first，init=00，xorOut=00，"123456789" → F4
  const c8 = runCrc({ width: 8, poly: 0x07n, direction: 'msb-first', bytes: asciiBytes('123456789'), init: 0n });
  check('参考值 CRC-8/0x07 check=F4', c8.checksum === 0xf4n, `got ${c8.checksum.toString(16)}`);

  // CRC-16/KERMIT 的反射实现：右移方向，多项式逐字取反转后的 0x8408，init=0 → 2189
  const c16 = runCrc({ width: 16, poly: 0x8408n, direction: 'lsb-first', bytes: asciiBytes('123456789'), init: 0n });
  check('参考值 CRC-16/KERMIT(reflected 0x8408) check=2189', c16.checksum === 0x2189n, `got ${c16.checksum.toString(16)}`);

  // 终态再 XOR xorOut 的语义
  const cX = runCrc({ width: 8, poly: 0x07n, direction: 'msb-first', bytes: asciiBytes('A'), init: 0n, xorOut: 0x5an });
  check('checksum = register XOR xorOut', cX.checksum === (cX.register ^ 0x5an));

  // trace 拍数 = 字节数*8，且 regAfter 与重放一致
  const cT = runCrc({ width: 8, poly: 0x07n, direction: 'msb-first', bytes: Uint8Array.from([0xa5]), init: 0x12n, trace: true });
  check('逐位 trace 共 8 拍', cT.steps.length === 8);
  check('trace 末拍寄存器等于终态', cT.steps[7].regAfter === cT.register);
}

// ---------- 2. 唯一解（8 位 / 16 位、两方向） ----------
// 关键事实：逐位转移矩阵 T 与载荷内容无关，M=T^(8·字节数) 只取决于长度。
// 且 (init,xorOut) 可辨识还要求 I+T 满秩（多项式不含 x+1 因子，即系数重量为奇数）。
// 故选 poly=0x1D / 0x800D（均满足），并取不同长度的载荷使堆叠方程满秩。
{
  const cand8: CandidateConfig = { id: 'C8', width: 8, direction: 'msb-first', poly: '1D' };
  const samples = makeSamples(
    cand8,
    ['01 03 00 2A 00 02', 'DE AD BE EF', '48 65 6C 6C 6F', 'AA 55 0F F0 33 CC 66 99'],
    0x35n,
    0xc3n,
  );
  const { verdict } = solveCandidate(cand8, samples);
  check('8 位 msb-first 不同长度样本判定唯一', verdict.kind === 'unique');
  if (verdict.kind !== 'none') {
    check('唯一解 init 正确', verdict.init === 0x35n, `got ${verdict.init.toString(16)}`);
    check('唯一解 xorOut 正确', verdict.xorOut === 0xc3n, `got ${verdict.xorOut.toString(16)}`);
    check('唯一解解数为 1', verdict.solutionCount === 1n);
    check('唯一解逐样本复现观测', samples.every((s) =>
      runCrc({ width: 8, poly: 0x1dn, direction: 'msb-first', bytes: parsePayload(s.payload), init: 0x35n, xorOut: 0xc3n }).checksum === parseHex(s.observed)));
  }

  // 16 位：两条不同长度（I+T 满秩）样本即可给出 32 个独立方程；这里用四个长度。
  const cand16: CandidateConfig = { id: 'C16', width: 16, direction: 'lsb-first', poly: '800D' };
  const samples16 = makeSamples(
    cand16,
    ['01 03 00 2A 00 02', 'DE AD BE EF CA', '00 11 22 33', 'AA 55 0F F0 33 CC 66 99 BB DD'],
    0xABCDn,
    0x1234n,
  );
  const r16 = solveCandidate(cand16, samples16);
  check('16 位 lsb-first 不同长度样本判定唯一', r16.verdict.kind === 'unique');
  if (r16.verdict.kind !== 'none') {
    check('16 位唯一解 init 正确', r16.verdict.init === 0xABCDn);
    check('16 位唯一解 xorOut 正确', r16.verdict.xorOut === 0x1234n);
  }
}

// ---------- 2b. 偶然吻合不应被当成唯一协议 ----------
{
  // (a) 偶数重量多项式（0x07 含 x+1 因子）：任意样本下 (init,xorOut) 至少有两组解。
  const evenWeight: CandidateConfig = { id: 'C8E', width: 8, direction: 'msb-first', poly: '07' };
  const samplesA = makeSamples(
    evenWeight,
    ['01 03 00 2A 00 02', 'DE AD BE EF', '48 65 6C 6C 6F', 'AA 55 0F F0 33 CC 66 99'],
    0x35n,
    0xc3n,
  );
  const va = solveCandidate(evenWeight, samplesA).verdict;
  check('偶数重量多项式永不唯一（GF(2) 歧义）', va.kind === 'ambiguous' && va.solutionCount >= 2n);

  // (b) 同长度短样本：M 相同 → 堆叠后秩亏，也必须报歧义而非唯一。
  const oddWeight: CandidateConfig = { id: 'C8O', width: 8, direction: 'msb-first', poly: '1D' };
  const samplesB = makeSamples(oddWeight, ['01 03', 'DE AD', '48 65'], 0x35n, 0xc3n);
  const vb = solveCandidate(oddWeight, samplesB).verdict;
  const brute = bruteForce(oddWeight, samplesB);
  check('同长度短样本多解不被误判为唯一', vb.kind === 'ambiguous');
  if (vb.kind === 'ambiguous') {
    check('同长度短样本歧义解数与暴力枚举一致', vb.solutionCount === BigInt(brute.length),
      `gf2=${vb.solutionCount} brute=${brute.length}`);
  }
}

// ---------- 3. 无解 ----------
{
  const cand: CandidateConfig = { id: 'C8', width: 8, direction: 'msb-first', poly: '07' };
  const samples = makeSamples(cand, ['01 02 03', 'DE AD BE', '48 65 6C'], 0x00n, 0x00n);
  // 篡改第二条观测值最低位
  const obs = parseHex(samples[1].observed) ^ 1n;
  samples[1] = { ...samples[1], observed: obs.toString(16).padStart(2, '0') };
  const { verdict } = solveCandidate(cand, samples);
  check('篡改观测值后无解', verdict.kind === 'none');

  // 错误多项式也应无解（偶然吻合的参数不被当成协议）
  const wrong: CandidateConfig = { ...cand, poly: '1D' };
  const original = makeSamples(cand, ['01 02 03', 'DE AD BE', '48 65 6C'], 0x00n, 0x00n);
  check('错误多项式无解', solveCandidate(wrong, original).verdict.kind === 'none');
}

// ---------- 4. 歧义：精确解数 + 字典序最小/次小见证（暴力交叉核对） ----------
{
  const cand: CandidateConfig = { id: 'C8', width: 8, direction: 'msb-first', poly: '07' };
  // 三条相同单字节样本：每样本仅 8 个方程堆叠后仍秩 8 → 零空间维数 8 → 256 组解
  const truthInit = 0x12n;
  const truthXor = 0x34n;
  const samples = makeSamples(cand, ['00', '00', '00'], truthInit, truthXor);
  const { verdict } = solveCandidate(cand, samples);
  check('秩亏约束判定歧义', verdict.kind === 'ambiguous');
  const brute = bruteForce(cand, samples);
  if (verdict.kind === 'ambiguous') {
    check('歧义精确解数 = 暴力枚举数（256）', verdict.solutionCount === BigInt(brute.length) && verdict.solutionCount === 256n,
      `gf2=${verdict.solutionCount} brute=${brute.length}`);
    brute.sort((a, b) => (a[0] << 8) + a[1] - ((b[0] << 8) + b[1]));
    const [minInit, minXor] = brute[0];
    const [nextInit, nextXor] = brute[1];
    check('字典序最小见证与暴力枚举一致', verdict.init === BigInt(minInit) && verdict.xorOut === BigInt(minXor),
      `gf2=(${verdict.init.toString(16)},${verdict.xorOut.toString(16)}) brute=(${minInit},${minXor})`);
    check('第二见证存在且与暴力枚举次小一致', !!verdict.second && verdict.second.init === BigInt(nextInit) && verdict.second.xorOut === BigInt(nextXor));
    // 两份见证都必须真实复现全部样本的观测值
    for (const w of [{ init: verdict.init, xorOut: verdict.xorOut }, verdict.second!]) {
      const ok = samples.every((s) =>
        runCrc({ width: 8, poly: 0x07n, direction: 'msb-first', bytes: parsePayload(s.payload), init: w.init, xorOut: w.xorOut }).checksum === parseHex(s.observed));
      check('见证逐样本复现观测值', ok);
    }
  }
}

// ---------- 5. lsb-first 方向的歧义交叉核对 ----------
{
  const cand: CandidateConfig = { id: 'C8R', width: 8, direction: 'lsb-first', poly: '31' };
  const samples = makeSamples(cand, ['7F', '7F', '7F'], 0x99n, 0x66n);
  const { verdict } = solveCandidate(cand, samples);
  const brute = bruteForce(cand, samples);
  check('lsb-first 歧义判定', verdict.kind === 'ambiguous');
  if (verdict.kind === 'ambiguous') {
    check('lsb-first 精确解数与暴力一致', verdict.solutionCount === BigInt(brute.length),
      `gf2=${verdict.solutionCount} brute=${brute.length}`);
    brute.sort((a, b) => (a[0] << 8) + a[1] - ((b[0] << 8) + b[1]));
    check('lsb-first 最小见证与暴力一致', verdict.init === BigInt(brute[0][0]) && verdict.xorOut === BigInt(brute[0][1]));
  }
}

// ---------- 6. 16 位歧义不枚举：零空间维数精确为 16 ----------
{
  const cand: CandidateConfig = { id: 'C16A', width: 16, direction: 'msb-first', poly: '1021' };
  // 三条相同单字节样本 → 16 个独立方程、32 未知量 → 恰 2^16 组解
  const samples = makeSamples(cand, ['00', '00', '00'], 0xBEEFn, 0x0102n);
  const { verdict } = solveCandidate(cand, samples);
  check('16 位秩亏判定歧义', verdict.kind === 'ambiguous');
  if (verdict.kind === 'ambiguous') {
    check('16 位歧义解数恰为 2^16', verdict.solutionCount === 1n << 16n && verdict.nullity === 16);
    const witnessOk = samples.every((s) =>
      runCrc({ width: 16, poly: 0x1021n, direction: 'msb-first', bytes: parsePayload(s.payload), init: verdict.init, xorOut: verdict.xorOut }).checksum === parseHex(s.observed));
    check('16 位最小见证复现全部观测', witnessOk);
    const secondOk = verdict.second && samples.every((s) =>
      runCrc({ width: 16, poly: 0x1021n, direction: 'msb-first', bytes: parsePayload(s.payload), init: verdict.second!.init, xorOut: verdict.second!.xorOut }).checksum === parseHex(s.observed));
    check('16 位第二见证复现全部观测', !!secondOk);
  }
}

// ---------- 7. 非法输入拦截 ----------
{
  const good: CrcModel = {
    name: 't',
    samples: [
      { id: 'A', payload: '01 02', observed: '00' },
      { id: 'B', payload: '03 04', observed: '00' },
      { id: 'C', payload: '05 06', observed: '00' },
    ],
    candidates: [{ id: 'X', width: 8, direction: 'msb-first', poly: '07' }],
  };
  check('合法模型无校验错误', validateModel(good).length === 0);

  const tooFew = { ...good, samples: good.samples.slice(0, 2) };
  check('少于 3 条样本被拒', validateModel(tooFew).some((e) => e.includes('3～64')));

  const tooManySamples = { ...good, samples: Array.from({ length: 65 }, (_, i) => ({ id: `S${i}`, payload: '00', observed: '00' })) };
  check('超过 64 条样本被拒', validateModel(tooManySamples).length > 0);

  const tooManyCands = { ...good, candidates: Array.from({ length: 129 }, (_, i) => ({ id: `C${i}`, width: 8 as const, direction: 'msb-first' as const, poly: '07' })) };
  check('超过 128 个候选被拒', validateModel(tooManyCands).length > 0);

  const dup = { ...good, samples: good.samples.map((s) => ({ ...s, id: 'A' })) };
  check('样本编号重复被拒', validateModel(dup).some((e) => e.includes('重复')));

  const badHex = { ...good, samples: good.samples.map((s, i) => (i === 0 ? { ...s, payload: 'ZZ 02' } : s)) };
  check('非法十六进制被拒', validateModel(badHex).some((e) => e.includes('非法')));

  const odd = { ...good, samples: good.samples.map((s, i) => (i === 0 ? { ...s, payload: 'A' } : s)) };
  check('奇数个 hex 位（字节未对齐）被拒', validateModel(odd).some((e) => e.includes('未对齐')));

  const badPoly = { ...good, candidates: [{ ...good.candidates[0], poly: 'XYZ' }] };
  check('非法多项式被拒', validateModel(badPoly).length > 0);

  const widePoly = { ...good, candidates: [{ ...good.candidates[0], poly: '107' }] };
  check('多项式超宽被拒', validateModel(widePoly).some((e) => e.includes('超出')));

  // 观测值与候选宽度不匹配：反演返回无解
  const mismatchSamples = good.samples.map((s) => ({ ...s, observed: '1FF' }));
  check('观测值超 8 位宽度反演为无解', solveCandidate(good.candidates[0], mismatchSamples).verdict.kind === 'none');

  let threw = false;
  try { parseModelJson('{ not json'); } catch { threw = true; }
  check('导入非法 JSON 抛错', threw);
}

// ---------- 8. 服务层（容器内） ----------
async function checkHttp(): Promise<void> {
  const base = process.env.BASE_URL;
  if (!base) {
    console.log('  (未设置 BASE_URL，跳过 HTTP 验收)');
    return;
  }
  const root = await fetch(`${base}/`);
  const html = await root.text();
  check('站点根路径返回 200', root.status === 200);
  check('根页面为复核台 HTML', html.includes('CRC 参数反演复核台'));

  const health = await fetch(`${base}/healthz`);
  check('健康检查端点 /healthz 返回 200', health.status === 200, `status=${health.status}`);

  const assetMatch = html.match(/src="([^"]+\.js)"/);
  if (assetMatch) {
    const asset = await fetch(`${base}${assetMatch[1].replace(/^\./, '')}`);
    check('主脚本资源可访问', asset.status === 200, assetMatch[1]);
  } else {
    check('HTML 中找到打包脚本', false);
  }
}

await checkHttp();

console.log(`\n验收结果：通过 ${passed} 项，失败 ${failures.length} 项`);
if (failures.length > 0) {
  for (const f of failures) console.error(`✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exit(1);
}
console.log('全部验收通过。');
process.exit(0);
