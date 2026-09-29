#!/usr/bin/env node
// ヘッドレス Chromium（ソフトウェア描画の SwiftShader）で画面を撮る。
// GPU の無い環境で、実機に出す前に画を確かめるためのもの。
//
//   node tools/shot.cjs                       → shots/shot.png
//   node tools/shot.cjs shots/far.png "t=120" → ?t=120 を付けて撮る
//   オプション：--size 1280x720  --frames 3  --timeout 60000
//
// playwright はリポジトリの依存にしていない。見つからなければ npm の
// グローバル領域から探す。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const root = execSync('npm root -g').toString().trim();
    return require(path.join(root, 'playwright'));
  }
}

const args = process.argv.slice(2);
const opt = { size: '1280x720', frames: '3', timeout: '60000' };
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
  else pos.push(args[i]);
}
const out = pos[0] || 'shots/shot.png';
const query = pos[1] || '';
const [width, height] = opt.size.split('x').map(Number);

const ROOT = path.resolve(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(0, '127.0.0.1', async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  let failed = false;
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => {
      failed = true;
      console.log(`[pageerror] ${e.message}`);
    });
    const url = `http://127.0.0.1:${server.address().port}/${query ? '?' + query : ''}`;
    const t0 = Date.now();
    await page.goto(url);
    await page.waitForFunction(
      (n) => window.__hakoniwa && window.__hakoniwa.frames >= n,
      Number(opt.frames),
      { timeout: Number(opt.timeout) },
    );
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    await page.screenshot({ path: out });
    console.log(`${out} (${width}x${height}, ${Date.now() - t0} ms)`);
  } catch (e) {
    failed = true;
    console.log(`[error] ${e.message}`);
  } finally {
    await browser.close();
    server.close();
    process.exitCode = failed ? 1 : 0;
  }
});
