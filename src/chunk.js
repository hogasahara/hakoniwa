// 区画（チャンク）の中身。区画は 8×8 の小区画（柱）に分かれる。
//
// 段（レベル）：
//   0 … 柱が部品の積み重ねに分かれる（寄ったとき）
//   1 … 小区画ごとに 1 本の柱
//   2〜4 … 柱を 2×2、4×4、8×8 ずつまとめた要約（遠いとき）
// どの段も「座標から中身を決める関数」なので、他の区画や生成の順番に左右されない。
// 遠い段は細かい段の要約から作る（高さと色の平均）。
//
// 区画の量（state.js の S と D）が柱に効く：
//   S 建て広げた量 …… 柱ごとに「S が閾値を超えたら伸びきる、でなければ低い」
//   D 損傷 …… 柱ごとに「D が閾値を超えたら上が崩れて黒ずむ」
// 閾値は柱ごとのハッシュ。判断は整数の比較だけ。
import * as THREE from 'three';
import { hash, unit, chance, SEED } from './hash.js';
import {
  CELL, SUB, BASE, GRAY, RUST, MIN_FACTOR,
  column, effectiveColumns, expectedColor, scale,
} from './columns.js';

export { CELL, SUB, CHUNK, LEVELS, chunkColumns } from './columns.js';

// 箱を頂点配列に書き込む。底面は省く
class BoxWriter {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
  }
  box(x0, y0, z0, x1, y1, z1, rgb) {
    const P = this.pos, N = this.nor, C = this.col;
    const quad = (a, b, c, d, nx, ny, nz) => {
      for (const v of [a, b, c, a, c, d]) {
        P.push(v[0], v[1], v[2]);
        N.push(nx, ny, nz);
        C.push(rgb[0], rgb[1], rgb[2]);
      }
    };
    quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], 1, 0, 0);
    quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], -1, 0, 0);
    quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], 0, 1, 0);
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0, 0, -1);
  }
  get boxes() {
    return this.pos.length / 90;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// 部品 1 つの色：性格 c の確率で錆、明るさを揺らす（平均は期待値に一致）
function partColor(gi, gj, k, c, dark, out) {
  const h = hash(SEED.parts + 7, gi, gj, k);
  const base = chance(h, c) ? RUST : GRAY;
  const j = 0.8 + 0.4 * unit(hash(SEED.parts + 8, gi, gj, k));
  for (let i = 0; i < 3; i++) out[i] = base[i] * j * dark;
  return out;
}

// 段 0：柱 1 本を部品の積み重ねに分ける
function writeParts(w, gi, gj, H, c, dark) {
  const x0 = gi * CELL;
  const z0 = gj * CELL;
  const rgb = [0, 0, 0];

  // 芯：部品の隙間から向こうが抜けて見えないように
  w.box(x0 + 2, BASE, z0 + 2, x0 + 6, H * 0.92, z0 + 6, expectedColor(c, rgb).map((v) => v * 0.6 * dark));

  let y = BASE;
  for (let k = 0; y < H - 1 && k < 160; k++) {
    const h1 = hash(SEED.parts, gi, gj, k);
    const h2 = hash(SEED.parts + 1, gi, gj, k);
    const h3 = hash(SEED.parts + 2, gi, gj, k);
    let ph = 2.5 + unit(h1) * 9;
    if (y + ph > H) ph = H - y + (h1 & 3);
    const pw = 3 + (((h1 >>> 8) & 0xff) / 255) * 5.5;
    const pd = 3 + (((h1 >>> 16) & 0xff) / 255) * 5.5;
    const ox = x0 - 1 + unit(h2) * (CELL + 2 - pw);
    const oz = z0 - 1 + unit(h3) * (CELL + 2 - pd);
    partColor(gi, gj, k, c, dark, rgb);
    w.box(ox, y, oz, ox + pw, y + ph, oz + pd, rgb);

    const h4 = hash(SEED.parts + 3, gi, gj, k);
    // 張り出した床板
    if (chance(h4, 0.12)) {
      const len = 2 + (h4 & 3);
      const side = (h4 >>> 2) & 3;
      const t = 0.5;
      const top = y + ph;
      if (side === 0) w.box(ox + pw, top - t, oz, ox + pw + len, top, oz + pd, rgb);
      else if (side === 1) w.box(ox - len, top - t, oz, ox, top, oz + pd, rgb);
      else if (side === 2) w.box(ox, top - t, oz + pd, ox + pw, top, oz + pd + len, rgb);
      else w.box(ox, top - t, oz - len, ox + pw, top, oz, rgb);
    }
    // 隣の柱へ渡す梁
    const h5 = hash(SEED.parts + 4, gi, gj, k);
    if (chance(h5, 0.05)) {
      const east = (h5 & 1) === 0;
      const n = east ? column(gi + 1, gj) : column(gi, gj + 1);
      const by = y + ph * 0.5;
      if (n.h * MIN_FACTOR > by + 2) {
        const s = 0.6 + (h5 >>> 8 & 3) * 0.3;
        if (east) w.box(x0 + 4, by, z0 + 4 - s, x0 + 4 + CELL, by + s, z0 + 4 + s, rgb);
        else w.box(x0 + 4 - s, by, z0 + 4, x0 + 4 + s, by + s, z0 + 4 + CELL, rgb);
      }
    }
    y += ph * (0.8 + 0.2 * unit(h4));
  }

  // 配管：柱の脇を縦に走る
  const hp = hash(SEED.parts + 5, gi, gj);
  if (chance(hp, 0.3)) {
    const px = x0 + unit(hash(SEED.parts + 6, gi, gj)) * (CELL - 0.6);
    const top = H * (0.3 + 0.7 * unit(hp));
    w.box(px, BASE, z0 - 0.4, px + 0.6, top, z0 + 0.2, scale(expectedColor(c, rgb), dark));
  }
  // 先端の柱（アンテナのようなもの）
  const hm = hash(SEED.parts + 9, gi, gj);
  if (H > 40 && chance(hm, 0.15)) {
    const len = 8 + unit(hash(SEED.parts + 10, gi, gj)) * 20;
    w.box(x0 + 3.8, H - 2, z0 + 3.8, x0 + 4.2, H + len, z0 + 4.2, scale(expectedColor(c, rgb), dark));
  }
}

// 段 level の区画の形を作る。state は区画の量 { S, D }
export function buildChunk(cx, cz, level, state) {
  const cols = effectiveColumns(cx, cz, state);
  const w = new BoxWriter();
  const rgb = [0, 0, 0];
  if (level === 0) {
    for (let j = 0; j < SUB; j++) {
      for (let i = 0; i < SUB; i++) {
        const H = cols.h[j * SUB + i];
        if (H > 0) writeParts(w, cx * SUB + i, cz * SUB + j, H, cols.c[j * SUB + i], cols.dark[j * SUB + i]);
      }
    }
  } else {
    // 柱を g×g ずつまとめる。平均の高さの台と、いちばん高い柱の位置に立つ細い尖塔の 2 つ
    // （遠くの輪郭は高いものが決めるので、平均だけだと峰が沈む）。
    // 色は高さで重み付けした期待値
    const g = 1 << (level - 1);
    const tmp = [0, 0, 0];
    for (let bj = 0; bj < SUB; bj += g) {
      for (let bi = 0; bi < SUB; bi += g) {
        let sum = 0, max = 0, mi = bi, mj = bj;
        rgb[0] = rgb[1] = rgb[2] = 0;
        for (let j = bj; j < bj + g; j++) {
          for (let i = bi; i < bi + g; i++) {
            const H = cols.h[j * SUB + i];
            sum += H;
            if (H > max) {
              max = H;
              mi = i;
              mj = j;
            }
            scale(expectedColor(cols.c[j * SUB + i], tmp), cols.dark[j * SUB + i]);
            for (let q = 0; q < 3; q++) rgb[q] += tmp[q] * H;
          }
        }
        if (max <= 0) continue;
        for (let q = 0; q < 3; q++) rgb[q] /= sum;
        const x0 = (cx * SUB + bi) * CELL;
        const z0 = (cz * SUB + bj) * CELL;
        const mean = sum / (g * g);
        w.box(x0, BASE, z0, x0 + g * CELL, mean, z0 + g * CELL, rgb);
        if (g > 1) {
          // 尖塔の幅は区画の半分（最小で柱 1 本分）。まとめた範囲からははみ出さない
          const sw = Math.max(CELL, (g * CELL) / 2);
          const clamp = (v, lo) => Math.min(Math.max(v, lo), lo + g * CELL - sw);
          const sx = clamp((cx * SUB + mi + 0.5) * CELL - sw / 2, x0);
          const sz = clamp((cz * SUB + mj + 0.5) * CELL - sw / 2, z0);
          w.box(sx, BASE, sz, sx + sw, max, sz + sw, rgb);
        }
      }
    }
  }
  return { geometry: w.boxes ? w.geometry() : null, boxes: w.boxes };
}
