// 天候：空に常にある巨大な渦と、そこからちぎれて流れてくる嵐。
//
// 嵐の出現・通り道・打撃は時刻だけから決まり、計算は整数だけ（どの端末でも同じ歴史）。
// 画面の動き（嵐の今の位置、渦の回転）は浮動小数でよい（分岐に使わないので）。
//
// 時間の尺度（仮）：
//   渦の方角 …… 13 時間ごとに 1/32 周ずれ、約 17 日で空を一周する
//   嵐 ………… 4 時間ごとの枠に 45% の確率で 1 つ。渦の方角から 5 km 先で生まれ、
//               分速 30〜90 m で箱庭へ向かう（見えてから届くまで 1〜3 時間、通過は十数分〜数十分）
import { hash, SEED } from './hash.js';

// 32 方位の単位ベクトル（×1000 の整数）。三角関数の結果は端末で最後の桁が違うことがあるので、表にしておく
const DIR = [
  [1000, 0], [981, 195], [924, 383], [831, 556], [707, 707], [556, 831], [383, 924], [195, 981],
  [0, 1000], [-195, 981], [-383, 924], [-556, 831], [-707, 707], [-831, 556], [-924, 383], [-981, 195],
  [-1000, 0], [-981, -195], [-924, -383], [-831, -556], [-707, -707], [-556, -831], [-383, -924], [-195, -981],
  [0, -1000], [195, -981], [383, -924], [556, -831], [707, -707], [831, -556], [924, -383], [981, -195],
];

export const VORTEX_STEP_HOURS = 13; // 渦の方角が 1/32 周ずれる時間
export const STORM_SLOT_MIN = 240; // 嵐の枠（分）
const STORM_CHANCE = 45; // %
const STORM_START = 5000; // 生まれる距離（m）
const STORM_MAX_SPEED = 90;
const STORM_MIN_SPEED = 30;
// 生まれてから箱庭の反対側へ抜けるまでの最長の時間（分）
export const STORM_LIFE_MIN = Math.ceil((STORM_START * 2) / STORM_MIN_SPEED);

// 渦の方角（32 方位の番号）。時間単位の整数から
export function vortexDir(hour) {
  return (((Math.floor(hour / VORTEX_STEP_HOURS)) % 32) + 32) % 32;
}

// 枠 slot の嵐。無ければ null。時刻は創世からの分（整数）
const stormCache = new Map();
export function storm(slot) {
  if (stormCache.has(slot)) return stormCache.get(slot);
  let s = null;
  if (hash(SEED.storm, slot) % 100 < STORM_CHANCE) {
    const born = slot * STORM_SLOT_MIN + (hash(SEED.storm + 1, slot) % STORM_SLOT_MIN);
    // 渦の方角から少しぶれた方角で生まれ、箱庭の中心へ向かって進む
    const d = (vortexDir(Math.floor(born / 60)) + (hash(SEED.storm + 2, slot) % 5) - 2 + 32) % 32;
    const [ux, uz] = DIR[d];
    s = {
      slot,
      born,
      dir: d,
      ux, // 生まれる方角（×1000）。進む向きはその逆
      uz,
      offset: (hash(SEED.storm + 3, slot) % 2601) - 1300, // 通り道の中心からのずれ（m）。半分ほどは箱庭をかすめるか外れる
      r: 180 + (hash(SEED.storm + 4, slot) % 301), // 半径（m）
      strength: 300 + (hash(SEED.storm + 5, slot) % 701), // 0〜1000
      speed: STORM_MIN_SPEED + (hash(SEED.storm + 6, slot) % (STORM_MAX_SPEED - STORM_MIN_SPEED + 1)), // m/分
    };
  }
  stormCache.set(slot, s);
  if (stormCache.size > 4000) stormCache.delete(stormCache.keys().next().value);
  return s;
}

// 分の範囲 [from, to) に生まれた嵐
export function stormsBornIn(from, to) {
  const out = [];
  for (let slot = Math.floor(from / STORM_SLOT_MIN); slot * STORM_SLOT_MIN < to; slot++) {
    const s = storm(slot);
    if (s && s.born >= from && s.born < to) out.push(s);
  }
  return out;
}

// 嵐が地点 (x, z)（m、整数）のそばを通るときの打撃（0〜1000）と、いちばん近づく時刻（分）。
// 当たらなければ null
export function stormPass(s, x, z) {
  // 生まれた地点
  const sx = Math.floor((s.ux * STORM_START - s.uz * s.offset) / 1000);
  const sz = Math.floor((s.uz * STORM_START + s.ux * s.offset) / 1000);
  const dx = x - sx;
  const dz = z - sz;
  // 進む向き (-ux, -uz) に沿った距離と、通り道からの距離
  const along = Math.floor(-(dx * s.ux + dz * s.uz) / 1000);
  const side = Math.floor((dx * s.uz - dz * s.ux) / 1000);
  if (along < 0) return null;
  const r2 = s.r * s.r;
  const d2 = side * side;
  if (d2 >= r2) return null;
  return {
    hit: Math.floor((s.strength * (r2 - d2)) / r2),
    minute: s.born + Math.floor(along / s.speed),
  };
}

// ---- 画面用（浮動小数） ----

// 分 m（小数可）での嵐の中心の位置
export function stormPosition(s, m) {
  const t = (m - s.born) * s.speed;
  const ux = s.ux / 1000;
  const uz = s.uz / 1000;
  return {
    x: ux * STORM_START - uz * s.offset - ux * t,
    z: uz * STORM_START + ux * s.offset - uz * t,
  };
}

// 分 m に空にある嵐（生まれてから遠くへ抜けるまで）
export function stormsAlive(m) {
  return stormsBornIn(Math.floor(m) - STORM_LIFE_MIN, Math.floor(m) + 1).filter(
    (s) => (m - s.born) * s.speed < STORM_START * 2,
  );
}

// 渦の方角（ラジアン、連続）。整数の vortexDir と同じ向きを滑らかにしたもの
export function vortexAngle(hourFloat) {
  return (hourFloat / VORTEX_STEP_HOURS) * ((2 * Math.PI) / 32);
}
