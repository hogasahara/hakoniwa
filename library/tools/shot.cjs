#!/usr/bin/env node
// 雪籠りの図書館を、ヘッドレス Chromium（SwiftShader）で撮る。GPU の無い環境で画を確かめるためのもの。
//
//   node library/tools/shot.cjs out.png "view=4&t=30"
//   オプション：--size 1280x720  --frames 3  --timeout 240000
//
// three.js は本番では jsDelivr から読む。ここでは同梱の vendor/three を返す（ネットに頼らない）。
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function loadPlaywright() {
  try { return require('playwright'); } catch {
    return require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
  }
}

const args = process.argv.slice(2);
const opt = { size: '1280x720', frames: '3', timeout: '240000' };
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
  else pos.push(args[i]);
}
const out = pos[0] || 'shots/library.png';
const query = pos[1] || '';
const [width, height] = opt.size.split('x').map(Number);
const ROOT = path.resolve(__dirname, '..', '..');
const PAGE = path.join(ROOT, 'library', 'index.html');

(async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let failed = false;
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', (e) => { failed = true; console.log(`[pageerror] ${e.message}`); });
    await page.route('https://cdn.jsdelivr.net/npm/three@*/build/*', (route) => {
      const name = path.basename(new URL(route.request().url()).pathname);
      route.fulfill({ path: path.join(ROOT, 'vendor', 'three', name), contentType: 'text/javascript' });
    });
    await page.route('http://lib.local/**', (route) => route.fulfill({ path: PAGE, contentType: 'text/html; charset=utf-8' }));
    const t0 = Date.now();
    await page.goto(`http://lib.local/index.html${query ? '?' + query : ''}`);
    await page.waitForFunction((n) => window.__lib && window.__lib.frames >= n, Number(opt.frames), { timeout: Number(opt.timeout), polling: 500 });
    await page.waitForTimeout(700);
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    await page.screenshot({ path: out, timeout: Number(opt.timeout) });
    console.log(`${out} (${width}x${height}, ${Date.now() - t0} ms)`);
  } catch (e) {
    failed = true;
    console.log(`[error] ${e.message}`);
  } finally {
    await browser.close();
    process.exitCode = failed ? 1 : 0;
  }
})();
