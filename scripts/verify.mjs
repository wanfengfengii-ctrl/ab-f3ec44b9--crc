#!/usr/bin/env node
// 一次性验收脚本：类型检查 → 单元/性质测试 → 生产构建 → 静态站点健康与资源探活。
// 全部通过则退出码 0；任一步失败退出码 1，并打印失败步骤。
//
// 若设置 WEB_BASE_URL（Compose 中指向 web 服务），则探活该静态站点；
// 否则本地启动一个零依赖静态服务器托管 dist 后探活。
//
// 该脚本不联系任何业务后端，仅校验浏览器内运行的纯前端产物。

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIST = join(root, 'dist');
const TIMEOUT_MS = 30_000;

const results = [];
async function step(name, fn) {
  process.stdout.write(`→ ${name} ... `);
  try {
    await fn();
    results.push([name, true]);
    console.log('PASS');
  } catch (e) {
    results.push([name, false, e]);
    console.log(`FAIL\n   ${e?.message || e}`);
  }
}

function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', rej);
    p.on('close', (code) => (code === 0 ? res() : rej(new Error(`${cmd} ${args.join(' ')} 退出码 ${code}\n${err || out}`))));
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
};

function startStaticServer(dir) {
  return new Promise((res) => {
    const server = createServer(async (req, res) => {
      try {
        let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (urlPath === '/healthz') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('ok');
          return;
        }
        if (urlPath === '/') urlPath = '/index.html';
        const filePath = join(dir, urlPath);
        const s = await stat(filePath);
        if (s.isDirectory()) {
          res.writeHead(302, { Location: '/index.html' });
          res.end();
          return;
        }
        const body = await readFile(filePath);
        res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }));
  });
}

async function waitFor(url, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`探活超时 ${url}: ${lastErr?.message || lastErr}`);
}

async function checkStaticSite(baseUrl) {
  const health = await waitFor(`${baseUrl}/healthz`);
  if ((await health.text()).trim() !== 'ok') throw new Error('/healthz 内容不是 ok');

  const indexRes = await fetch(`${baseUrl}/`);
  if (!indexRes.ok) throw new Error('首页返回非 200');
  const html = await indexRes.text();
  if (!html.includes('<div id="root">')) throw new Error('首页缺少根挂载点');
  const scriptMatch = html.match(/src="(\.\/assets\/[^"]+\.js)"/);
  if (!scriptMatch) throw new Error('首页未引用构建产物 JS');
  const cssMatch = html.match(/href="(\.\/assets\/[^"]+\.css)"/);
  if (!cssMatch) throw new Error('首页未引用构建产物 CSS');

  const jsRes = await fetch(`${baseUrl}/${scriptMatch[1].replace(/^\.\//, '')}`);
  if (!jsRes.ok) throw new Error('JS 产物不可达');
  const cssRes = await fetch(`${baseUrl}/${cssMatch[1].replace(/^\.\//, '')}`);
  if (!cssRes.ok) throw new Error('CSS 产物不可达');

  // Worker 独立分块必须真实存在且可加载（反演在 worker 中可取消运行）
  const jsText = await jsRes.text();
  const workerMatch = jsText.match(/inversion\.worker-[A-Za-z0-9_-]+\.js/);
  if (!workerMatch) throw new Error('主产物未引用 inversion.worker 分块');
  const workerRes = await fetch(`${baseUrl}/assets/${workerMatch[0]}`);
  if (!workerRes.ok) throw new Error(`Worker 分块不可达: ${workerMatch[0]}`);
}

await step('TypeScript 类型检查', () => run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json']));
await step('Vitest 性质测试（GF(2) 审计/标准 CRC 向量/校验/取消）', () => run('npx', ['vitest', 'run']));

let localServer = null;
if (!process.env.WEB_BASE_URL) {
  await step('Vite 生产构建', () => run('npx', ['vite', 'build']));
  await step('启动本地静态服务器', async () => {
    localServer = await startStaticServer(DIST);
  });
}

const baseUrl = process.env.WEB_BASE_URL || (localServer ? `http://127.0.0.1:${localServer.port}` : '');
await step(`静态站点健康检查（${baseUrl || process.env.WEB_BASE_URL}）`, () => checkStaticSite(baseUrl || process.env.WEB_BASE_URL));

if (localServer) await new Promise((r) => localServer.server.close(r));

const failed = results.filter(([, ok]) => !ok);
console.log('\n================ 验收汇总 ================');
for (const [name, ok] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
console.log('==========================================');

if (failed.length > 0) {
  console.error(`\n验收失败：${failed.length}/${results.length} 项未通过`);
  process.exit(1);
}
console.log(`\n验收通过：${results.length}/${results.length} 项全部通过`);
process.exit(0);
