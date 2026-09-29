#!/usr/bin/env node
// 何枚かの画像を 1 枚に並べる（見比べ用）。
//   node tools/sheet.cjs shots/sheet.png a.png b.png c.png --cols 2 --width 1600
// 画像の下にファイル名を添える。
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    return require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
  }
}

const args = process.argv.slice(2);
const opt = { cols: '2', width: '1600' };
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
  else pos.push(args[i]);
}
const [out, ...images] = pos;
const cols = Number(opt.cols);
const width = Number(opt.width);

const cells = images
  .map((f) => {
    const data = fs.readFileSync(f).toString('base64');
    return `<figure><img src="data:image/png;base64,${data}"><figcaption>${path.basename(f)}</figcaption></figure>`;
  })
  .join('');
const html = `<!doctype html><style>
  body { margin: 0; background: #111; width: ${width}px; }
  main { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 4px; padding: 4px; }
  figure { margin: 0; }
  img { width: 100%; display: block; }
  figcaption { color: #aaa; font: 12px monospace; padding: 2px 0 4px; }
</style><main>${cells}</main>`;

(async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 100 } });
  await page.setContent(html);
  await page.waitForLoadState('load');
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
  console.log(out);
})();
