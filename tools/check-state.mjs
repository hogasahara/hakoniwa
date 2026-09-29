#!/usr/bin/env node
// 区画の量（src/state.js）の確認：速さ、長期の安定、区画ごとのばらつき。
//   node tools/check-state.mjs [年数]
import { chunkSite, chunkState, GENESIS, HOUR } from '../src/state.js';
import { chunkColumns, CHUNK } from '../src/columns.js';

const years = Number(process.argv[2] || 20);

// 塊のある区画（view.js と同じ範囲）
const sites = [];
for (let cz = -9; cz < 9; cz++) for (let cx = -9; cx < 9; cx++) if (chunkColumns(cx, cz).max > 0) sites.push(chunkSite(cx, cz, CHUNK));
console.log(`区画 ${sites.length}`);

// 速さ：キャッシュ無し（開いた直後）と、1 時間後（キャッシュあり）
const hour0 = 24 * 365 * 3 + 13;
let t0 = performance.now();
const caches = sites.map(() => new Map());
sites.forEach((s, i) => chunkState(s, hour0, caches[i]));
const cold = performance.now() - t0;
t0 = performance.now();
sites.forEach((s, i) => chunkState(s, hour0 + 1, caches[i]));
const warm = performance.now() - t0;
console.log(`全区画の量：開いた直後 ${cold.toFixed(1)} ms、1 時間後 ${warm.toFixed(1)} ms`);

// 窓より前の日がどう計算されても結果が変わらないこと（キャッシュの有無で一致）
const a = chunkState(sites[5], hour0 + 100, new Map());
const b = chunkState(sites[5], hour0 + 100, caches[5]);
console.log(`キャッシュの有無で一致：${JSON.stringify(a) === JSON.stringify(b)}`);

// 長期：年ごとに、正午の値の全区画平均の最小・平均・最大、損傷のある区画の割合
console.log('\n年  P(最小/平均/最大)   S(最小/平均/最大)   D の平均  損傷のある区画%  P の区画間の幅');
for (let y = 0; y < years; y++) {
  const st = { P: [1e9, 0, 0], S: [1e9, 0, 0], D: 0, damaged: 0, spread: 0 };
  const cs = sites.map(() => new Map());
  for (let d = 0; d < 365; d++) {
    const hour = (y * 365 + d) * 24 + 12;
    let P = 0, S = 0, D = 0, dm = 0, pmin = 1e9, pmax = 0;
    sites.forEach((s, i) => {
      const v = chunkState(s, hour, cs[i]);
      P += v.P; S += v.S; D += v.D;
      if (v.D > 0) dm++;
      pmin = Math.min(pmin, v.P); pmax = Math.max(pmax, v.P);
    });
    P /= sites.length; S /= sites.length; D /= sites.length;
    st.P[0] = Math.min(st.P[0], P); st.P[1] += P / 365; st.P[2] = Math.max(st.P[2], P);
    st.S[0] = Math.min(st.S[0], S); st.S[1] += S / 365; st.S[2] = Math.max(st.S[2], S);
    st.D += D / 365; st.damaged += (dm / sites.length) * 100 / 365; st.spread += (pmax - pmin) / 365;
    for (const c of cs) for (const k of c.keys()) if (k < y * 365 + d - 120) c.delete(k);
  }
  const f = (v) => v.map((x) => Math.round(x).toString().padStart(4)).join('/');
  console.log(`${String(y).padStart(2)}  ${f(st.P)}     ${f(st.S)}     ${Math.round(st.D).toString().padStart(4)}      ${st.damaged.toFixed(0).padStart(3)}            ${Math.round(st.spread)}`);
}

// 1 つの区画の 60 日の推移（P と S は日ごと、D は 6 時間ごとの最大）
const s = sites[Math.floor(sites.length / 2)];
console.log(`\n区画 (${s.cx}, ${s.cz}) の 60 日：日 P S D(その日の最大)`);
const c = new Map();
for (let d = 400; d < 460; d++) {
  let dmax = 0;
  for (let h = 0; h < 24; h++) dmax = Math.max(dmax, chunkState(s, d * 24 + h, c).D);
  const v = chunkState(s, d * 24 + 12, c);
  console.log(`${d} ${String(v.P).padStart(4)} ${String(v.S).padStart(4)} ${String(dmax).padStart(4)} ${'#'.repeat(Math.round(v.P / 25))}`);
}
console.log(`\n創世 ${new Date(GENESIS).toISOString()}、1 時間 = ${HOUR} ms`);
