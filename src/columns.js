// 柱の一覧：座標と区画の量から、柱の高さ・性格・暗さを決める。three.js に依存しない
// （Node の確認用スクリプトからも読む）。
import { hash, unit, SEED } from './hash.js';
import { massHeight, rustiness } from './field.js';

export const CELL = 8; // 小区画の幅（メートル）
export const SUB = 8; // 区画一辺の小区画の数
export const CHUNK = CELL * SUB; // 区画の幅
export const LEVELS = 5;
export const BASE = -4; // 柱の根元（海面より下）

export const GRAY = [0.42, 0.43, 0.44];
export const RUST = [0.4, 0.24, 0.15];
const UNGROWN = 0.72; // 伸びきっていない柱の高さの割合
const BROKEN = 0.55; // 崩れた柱の高さの割合
const SCORCH = 0.6; // 崩れた柱の色の暗さ
// 隣の柱の高さの下限（量によらない）。梁を渡すかの判断に使う
export const MIN_FACTOR = UNGROWN * BROKEN;

// 小区画 (gi, gj)（世界全体での通し番号）の柱
export function column(gi, gj) {
  const x = (gi + 0.5) * CELL;
  const z = (gj + 0.5) * CELL;
  const m = massHeight(x, z);
  if (m < 3) return { h: 0, c: 0 };
  const h = m * (0.7 + 0.6 * unit(hash(SEED.column, gi, gj)));
  return { h, c: rustiness(x, z) };
}

export function scale(rgb, k) {
  for (let i = 0; i < 3; i++) rgb[i] *= k;
  return rgb;
}

// 性格 c の場所の部品の色の期待値
export function expectedColor(c, out) {
  for (let i = 0; i < 3; i++) out[i] = GRAY[i] + (RUST[i] - GRAY[i]) * c;
  return out;
}

// 区画の柱の一覧（キャッシュする。小さい）
const columnCache = new Map();
export function chunkColumns(cx, cz) {
  const key = cx + ',' + cz;
  let cols = columnCache.get(key);
  if (!cols) {
    cols = { h: new Float32Array(SUB * SUB), c: new Float32Array(SUB * SUB), max: 0 };
    for (let j = 0; j < SUB; j++) {
      for (let i = 0; i < SUB; i++) {
        const col = column(cx * SUB + i, cz * SUB + j);
        cols.h[j * SUB + i] = col.h;
        cols.c[j * SUB + i] = col.c;
        if (col.h > cols.max) cols.max = col.h;
      }
    }
    columnCache.set(key, cols);
  }
  return cols;
}

// 区画の量 state = { S, D } を柱に効かせた一覧
export function effectiveColumns(cx, cz, state) {
  const base = chunkColumns(cx, cz);
  const n = SUB * SUB;
  const out = { h: new Float32Array(n), c: base.c, dark: new Float32Array(n) };
  for (let j = 0; j < SUB; j++) {
    for (let i = 0; i < SUB; i++) {
      const k = j * SUB + i;
      const gi = cx * SUB + i;
      const gj = cz * SUB + j;
      let f = hash(SEED.grow, gi, gj) % 1000 < state.S ? 1 : UNGROWN;
      let dark = 1;
      if (hash(SEED.damage, gi, gj) % 1000 < state.D) {
        f *= BROKEN;
        dark = SCORCH;
      }
      out.h[k] = base.h[k] * f;
      out.dark[k] = dark;
    }
  }
  return out;
}
