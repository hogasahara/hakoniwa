// 区画の量：時刻から決まる。保存するものは何もない。
//
// 量（どれも 0〜1000 の整数）
//   P 棲むもの  …… 過去 30 日の「暮らしやすさ」の重み付き平均（数日〜数週間で増減）
//   S 建て広げた量 …… 過去 60 日の P の平均（棲むものに遅れて増減）
//   D 損傷      …… 過去 48 時間の嵐の打撃が、建て直しで減っていく残り（数時間で戻る）
//
// どの量も「直近の決まった長さの出来事」だけで決まる。そのため
//   ・どの時刻でも、窓の長さ分だけ計算すれば求まる（世界の年齢に関係なく速い）
//   ・入力が有限の範囲なので量も必ず範囲に収まる（何年経っても全部崩れる・覆い尽くすに行き着かない）
// 計算はすべて整数。分岐も整数の比較だけ（どの端末でも同じ歴史になる）。
import { hash, SEED } from './hash.js';

export const HOUR = 3600 * 1000;
// 創世の時刻（仮：最初に公開した日）。世界の時刻はここからの経過時間で数える
export const GENESIS = Date.UTC(2026, 8, 29);

export function worldHour(ms) {
  return Math.floor((ms - GENESIS) / HOUR);
}

const P_DAYS = 30;
const S_DAYS = 60;
const D_HOURS = 48;
const STORM_SLOT = 6; // 仮の嵐は 6 時間ごとの枠に 1 つまで

// 整数の値ノイズ（時間軸）。0〜1000
function timeNoise(seed, t, period) {
  const g = Math.floor(t / period);
  const f = t - g * period;
  const a = hash(seed, g) % 1001;
  const b = hash(seed, g + 1) % 1001;
  return a + Math.floor(((b - a) * f) / period);
}

// 世界全体の気候（日ごと）。晴れた時期と荒れた時期がゆっくり巡る。0〜1000
function climate(day) {
  return Math.floor((timeNoise(SEED.climate, day, 23) * 2 + timeNoise(SEED.climate + 1, day, 7)) / 3);
}

// ---- 仮の嵐（次の一歩で天候として作り直す） ----
// 枠 slot の嵐。無ければ null。中心と半径はメートル、強さは 0〜1000
function stormAt(slot) {
  const h = hash(SEED.storm, slot);
  if (h % 100 >= 35) return null;
  return {
    hour: slot * STORM_SLOT,
    x: (hash(SEED.storm + 1, slot) % 1201) - 600,
    z: (hash(SEED.storm + 2, slot) % 1201) - 600,
    r: 150 + (hash(SEED.storm + 3, slot) % 301),
    strength: 300 + (hash(SEED.storm + 4, slot) % 701),
  };
}

// 嵐が区画の中心に与える打撃。0〜1000
function impact(storm, x, z) {
  const dx = x - storm.x;
  const dz = z - storm.z;
  const d2 = dx * dx + dz * dz;
  const r2 = storm.r * storm.r;
  if (d2 >= r2) return 0;
  return Math.floor((storm.strength * (r2 - d2)) / r2);
}

// ---- 区画の量 ----
// 区画の中心 (x, z)（メートル、整数）と、場所ごとの住みやすさ habit（0〜1000）
export function chunkSite(cx, cz, size) {
  return {
    cx,
    cz,
    x: cx * size + size / 2,
    z: cz * size + size / 2,
    habit: 300 + (hash(SEED.habit, cx, cz) % 601),
  };
}

// その日の暮らしやすさ：気候 × 住みやすさ − その日の嵐の打撃。0〜1000
// （気候と住みやすさの平均がそれぞれ 500 と 600 なので、600 で割ると平均がおよそ 500）
function favor(site, day) {
  let v = Math.floor((climate(day) * site.habit) / 600);
  if (v > 1000) v = 1000;
  const first = Math.floor((day * 24) / STORM_SLOT);
  for (let s = first; s < first + 24 / STORM_SLOT; s++) {
    const storm = stormAt(s);
    if (storm) v -= Math.floor(impact(storm, site.x, site.z) / 3);
  }
  return v < 0 ? 0 : v;
}

// day の日の棲むもの。三角形の重み（最近ほど重い）
function population(site, day, cache) {
  let p = cache && cache.get(day);
  if (p !== undefined) return p;
  let sum = 0;
  let wsum = 0;
  for (let k = 0; k < P_DAYS; k++) {
    const w = P_DAYS - k;
    sum += favor(site, day - k) * w;
    wsum += w;
  }
  p = Math.floor(sum / wsum);
  if (cache) cache.set(day, p);
  return p;
}

// 時刻 hour（世界の時刻、時間単位の整数）での区画の量
export function chunkState(site, hour, cache = new Map()) {
  const day = Math.floor(hour / 24);
  const P = population(site, day, cache);

  let sum = 0;
  for (let k = 0; k < S_DAYS; k++) sum += population(site, day - k, cache);
  const S = Math.floor(sum / S_DAYS);

  // 損傷：嵐ごとの打撃が、建て直しの時間をかけて 0 に戻る。
  // 建て直しの時間は、嵐の日に棲むものが多いほど短い（6〜42 時間）
  let D = 0;
  const last = Math.floor(hour / STORM_SLOT);
  for (let s = Math.floor((hour - D_HOURS) / STORM_SLOT) + 1; s <= last; s++) {
    const storm = stormAt(s);
    if (!storm) continue;
    const hit = impact(storm, site.x, site.z);
    if (hit === 0) continue;
    const pAt = population(site, Math.floor(storm.hour / 24), cache);
    const repair = 6 + Math.floor(((1000 - pAt) * 36) / 1000);
    const age = hour - storm.hour;
    if (age < repair) D += Math.floor((hit * (repair - age)) / repair);
  }
  if (D > 1000) D = 1000;
  return { P, S, D };
}
