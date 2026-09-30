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
import { organicCover, organicKind } from './organic.js';
import {
  CELL, SUB, BASE, GRAY, RUST, MIN_FACTOR,
  column, effectiveColumns, expectedColor, scale,
} from './columns.js';

export { CELL, SUB, CHUNK, LEVELS, chunkColumns } from './columns.js';

// 箱と棒を頂点配列に書き込む。型付き配列に直接書き、足りなくなったら倍に広げる
// （小さな配列を毎回作らないので速い。区画を作る時間が段の切り替えの引っかかりになるため）
class BoxWriter {
  constructor() {
    this.cap = 1 << 16; // 頂点の数
    this.pos = new Float32Array(this.cap * 3);
    this.nor = new Float32Array(this.cap * 3);
    this.col = new Float32Array(this.cap * 3);
    this.v = 0; // 書いた頂点の数
    this.n = 0; // 書いた部品（箱と棒）の数
  }
  reserve(count) {
    if (this.v + count <= this.cap) return;
    while (this.v + count > this.cap) this.cap *= 2;
    for (const k of ['pos', 'nor', 'col']) {
      const a = new Float32Array(this.cap * 3);
      a.set(this[k]);
      this[k] = a;
    }
  }
  vert(x, y, z, nx, ny, nz, rgb) {
    const i = this.v * 3;
    this.pos[i] = x; this.pos[i + 1] = y; this.pos[i + 2] = z;
    this.nor[i] = nx; this.nor[i + 1] = ny; this.nor[i + 2] = nz;
    this.col[i] = rgb[0]; this.col[i + 1] = rgb[1]; this.col[i + 2] = rgb[2];
    this.v++;
  }
  // 四角形 (a, b, c, d) を三角形 2 つで
  quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz, rgb) {
    this.vert(ax, ay, az, nx, ny, nz, rgb);
    this.vert(bx, by, bz, nx, ny, nz, rgb);
    this.vert(cx, cy, cz, nx, ny, nz, rgb);
    this.vert(ax, ay, az, nx, ny, nz, rgb);
    this.vert(cx, cy, cz, nx, ny, nz, rgb);
    this.vert(dx, dy, dz, nx, ny, nz, rgb);
  }
  // 軸に沿った箱。底面は省く
  box(x0, y0, z0, x1, y1, z1, rgb) {
    this.reserve(30);
    this.n++;
    this.quad(x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1, 1, 0, 0, rgb);
    this.quad(x0, y0, z1, x0, y1, z1, x0, y1, z0, x0, y0, z0, -1, 0, 0, rgb);
    this.quad(x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0, 0, 1, 0, rgb);
    this.quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, rgb);
    this.quad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1, rgb);
  }
  // 2 点を結ぶ断面が正方形の細い棒（配管、ケーブル、蔓、根）。端の面は省く
  seg(ax, ay, az, bx, by, bz, width, rgb) {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-3) return;
    dx /= len; dy /= len; dz /= len;
    // 棒に直交する 2 方向 u, v（長さ width / 2）
    let ux, uy, uz;
    if (Math.abs(dy) < 0.9) { ux = dz; uy = 0; uz = -dx; } else { ux = 0; uy = -dz; uz = dy; }
    const h = width / 2;
    const ul = h / Math.sqrt(ux * ux + uy * uy + uz * uz);
    ux *= ul; uy *= ul; uz *= ul;
    const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
    this.reserve(24);
    this.n++;
    // 断面の 4 隅 (+u+v, -u+v, -u-v, +u-v) を順に回る
    const S = [1, -1, -1, 1], T = [1, 1, -1, -1];
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) & 3;
      const o0x = S[k] * ux + T[k] * vx, o0y = S[k] * uy + T[k] * vy, o0z = S[k] * uz + T[k] * vz;
      const o1x = S[k2] * ux + T[k2] * vx, o1y = S[k2] * uy + T[k2] * vy, o1z = S[k2] * uz + T[k2] * vz;
      // 面の法線：2 つの隅の向きの平均
      let nx = o0x + o1x, ny = o0y + o1y, nz = o0z + o1z;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= nl; ny /= nl; nz /= nl;
      // 外から見て反時計回り（表）になる順
      this.quad(
        ax + o0x, ay + o0y, az + o0z,
        ax + o1x, ay + o1y, az + o1z,
        bx + o1x, by + o1y, bz + o1z,
        bx + o0x, by + o0y, bz + o0z,
        nx, ny, nz, rgb,
      );
    }
  }
  get boxes() {
    return this.n;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.v * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.slice(0, this.v * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.v * 3), 3));
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

const MOSS = [0.07, 0.095, 0.04];
const FLESH = [0.16, 0.065, 0.05];
const PIPE = [0.2, 0.19, 0.18];

// 有機物の色：場所の種類（茂み／菌糸）と明るさの揺らぎ
function organicColor(x, y, z, hv, out) {
  const k = organicKind(x, y, z) < 0.52 ? MOSS : FLESH;
  const j = 0.6 + 0.8 * unit(hv);
  for (let i = 0; i < 3; i++) out[i] = k[i] * j;
  return out;
}

// 手すり付きの足場：床板の外側の縁に柱と横木
function railing(w, x0, z0, x1, z1, y, rgb) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 1.3));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    w.box(x - 0.05, y, z - 0.05, x + 0.05, y + 1.1, z + 0.05, rgb);
  }
  w.seg(x0, y + 1.1, z0, x1, y + 1.1, z1, 0.08, rgb);
}

// 垂れたケーブル：2 点を結び、たるませる
function cable(w, ax, ay, az, bx, by, bz, sag, width, rgb) {
  const N = 6;
  let px = ax, py = ay, pz = az;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    const y = ay + (by - ay) * t - sag * 4 * t * (1 - t);
    w.seg(px, py, pz, x, y, z, width, rgb);
    px = x; py = y; pz = z;
  }
}

// 垂れ下がる蔓：揺らぎながら細くなる
function tendril(w, x, y, z, len, seed, rgb) {
  const N = 4;
  let px = x, py = y, pz = z;
  for (let i = 1; i <= N; i++) {
    const h = hash(seed, i);
    const nx = px + (unit(h) - 0.5) * 1.2;
    const nz = pz + (unit(hash(seed, i, 1)) - 0.5) * 1.2;
    const ny = py - len / N;
    w.seg(px, py, pz, nx, ny, nz, 0.35 - i * 0.06, rgb);
    px = nx; py = ny; pz = nz;
  }
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
    const top = y + ph;
    const cover = organicCover(ox + pw / 2, top, oz + pd / 2);
    if (chance(h4, 0.14)) {
      const len = 2 + (h4 & 3);
      const side = (h4 >>> 2) & 3;
      const t = 0.5;
      // 床板の外側の縁（手すりを立てる線）
      let e;
      if (side === 0) { w.box(ox + pw, top - t, oz, ox + pw + len, top, oz + pd, rgb); e = [ox + pw + len, oz, ox + pw + len, oz + pd]; }
      else if (side === 1) { w.box(ox - len, top - t, oz, ox, top, oz + pd, rgb); e = [ox - len, oz, ox - len, oz + pd]; }
      else if (side === 2) { w.box(ox, top - t, oz + pd, ox + pw, top, oz + pd + len, rgb); e = [ox, oz + pd + len, ox + pw, oz + pd + len]; }
      else { w.box(ox, top - t, oz - len, ox + pw, top, oz, rgb); e = [ox, oz - len, ox + pw, oz - len]; }
      if (cover < 0.5 && chance(hash(SEED.growth, gi, gj, k), 0.6)) railing(w, e[0], e[1], e[2], e[3], top, PIPE);
      // 有機物の多いところでは、床板の縁から蔓が垂れる
      if (cover > 0.3) {
        const org = [0, 0, 0];
        const n = 1 + Math.floor(cover * 2);
        for (let q = 0; q < n; q++) {
          const tq = unit(hash(SEED.growth + 1, gi, gj, k * 8 + q));
          const tx = e[0] + (e[2] - e[0]) * tq, tz = e[1] + (e[3] - e[1]) * tq;
          const len2 = 3 + unit(hash(SEED.growth + 2, gi, gj, k * 8 + q)) * 12 * cover;
          tendril(w, tx, top - t, tz, len2, hash(SEED.growth + 3, gi, gj, k * 8 + q), organicColor(tx, top, tz, hash(SEED.growth + 4, gi, gj, k * 8 + q), org));
        }
      }
    }
    // 有機物の塊：部品の上にこぶのように盛り上がる
    if (cover > 0.2 && chance(hash(SEED.growth + 5, gi, gj, k), cover * 0.25)) {
      const org = [0, 0, 0];
      const n = 2 + Math.floor(cover * 3);
      for (let q = 0; q < n; q++) {
        const hq = hash(SEED.growth + 6, gi, gj, k * 16 + q);
        const sz = 0.8 + unit(hq) * 2.2;
        const qx = ox + unit(hash(SEED.growth + 7, gi, gj, k * 16 + q)) * pw;
        const qz = oz + unit(hash(SEED.growth + 8, gi, gj, k * 16 + q)) * pd;
        const qy = top - sz * 0.3 + unit(hash(SEED.growth + 9, gi, gj, k * 16 + q)) * sz * 0.6;
        w.box(qx - sz / 2, qy - sz / 2, qz - sz / 2, qx + sz / 2, qy + sz / 2, qz + sz / 2, organicColor(qx, qy, qz, hq, org));
      }
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
    // 隣の柱へ垂れたケーブル（斜めの隣も）
    const h6 = hash(SEED.growth + 10, gi, gj, k);
    if (chance(h6, 0.06)) {
      const di = (h6 & 3) === 0 ? 1 : (h6 & 3) === 1 ? 0 : 1;
      const dj = (h6 & 3) === 0 ? 0 : 1;
      const n = column(gi + di, gj + dj);
      const cy = y + ph * 0.7;
      const ny = cy - 2 - unit(h6) * 6;
      if (n.h * MIN_FACTOR > ny + 2) {
        cable(w, x0 + 4, cy, z0 + 4, x0 + 4 + di * CELL, ny, z0 + 4 + dj * CELL, 1 + unit(hash(SEED.growth + 11, gi, gj, k)) * 3, 0.22, PIPE);
      }
    }
    y += ph * (0.8 + 0.2 * unit(h4));
  }

  // 配管の束：柱の一面を縦に走り、上で横へ折れる
  const hp = hash(SEED.parts + 5, gi, gj);
  if (chance(hp, 0.4)) {
    const face = (hp >>> 4) & 3;
    const count = 2 + ((hp >>> 8) & 3);
    const top = H * (0.3 + 0.7 * unit(hp));
    const start = 1 + unit(hash(SEED.parts + 6, gi, gj)) * (CELL - 2 - count * 0.8);
    for (let q = 0; q < count; q++) {
      const wq = 0.3 + unit(hash(SEED.growth + 12, gi, gj, q)) * 0.35;
      const tq = top - q * 0.9;
      const off = start + q * 0.8;
      let ax, az, bx, bz;
      if (face === 0) { ax = x0 + off; az = z0 - 0.6; bx = ax; bz = az - 2.5; }
      else if (face === 1) { ax = x0 + off; az = z0 + CELL + 0.6; bx = ax; bz = az + 2.5; }
      else if (face === 2) { ax = x0 - 0.6; az = z0 + off; bx = ax - 2.5; bz = az; }
      else { ax = x0 + CELL + 0.6; az = z0 + off; bx = ax + 2.5; bz = az; }
      w.seg(ax, BASE, az, ax, tq, az, wq, PIPE);
      w.seg(ax, tq, az, bx, tq + 0.5, bz, wq, PIPE);
    }
  }
  // 骨組みだけの格子：柱の上に伸びる、四隅の柱と横木と筋交い
  const topCover = organicCover(x0 + 4, H, z0 + 4);
  const ht = hash(SEED.growth + 13, gi, gj);
  if (H > 20 && chance(ht, 0.14)) {
    const tall = 6 + unit(hash(SEED.growth + 14, gi, gj)) * 16;
    const a0 = 1.2, a1 = CELL - 1.2;
    const col2 = scale(expectedColor(c, [0, 0, 0]), dark * 0.8);
    for (const [cxq, czq] of [[a0, a0], [a1, a0], [a1, a1], [a0, a1]]) {
      w.box(x0 + cxq - 0.18, H - 1, z0 + czq - 0.18, x0 + cxq + 0.18, H + tall, z0 + czq + 0.18, col2);
    }
    for (let yy = H + 2.5, q = 0; yy < H + tall; yy += 2.5, q++) {
      w.seg(x0 + a0, yy, z0 + a0, x0 + a1, yy, z0 + a0, 0.14, col2);
      w.seg(x0 + a1, yy, z0 + a0, x0 + a1, yy, z0 + a1, 0.14, col2);
      w.seg(x0 + a1, yy, z0 + a1, x0 + a0, yy, z0 + a1, 0.14, col2);
      w.seg(x0 + a0, yy, z0 + a1, x0 + a0, yy, z0 + a0, 0.14, col2);
      // 筋交い：段ごとに向きを変える
      if (q % 2 === 0) w.seg(x0 + a0, yy - 2.5, z0 + a0, x0 + a1, yy, z0 + a0, 0.12, col2);
      else w.seg(x0 + a1, yy - 2.5, z0 + a1, x0 + a0, yy, z0 + a1, 0.12, col2);
    }
    // 有機物の多いところでは、格子に蔓が絡んで垂れる
    if (topCover > 0.3) {
      const org = [0, 0, 0];
      for (let q = 0; q < 3; q++) {
        const hq = hash(SEED.growth + 15, gi, gj, q);
        tendril(w, x0 + a0 + unit(hq) * (a1 - a0), H + tall * (0.5 + 0.5 * unit(hq >>> 8)), z0 + a0, 4 + tall * 0.4, hq, organicColor(x0, H, z0, hq, org));
      }
    }
  }
  // 根：有機物の多い柱の壁を、斜めに這い下りる
  const midCover = organicCover(x0 + 4, H * 0.6, z0 + 4);
  if (midCover > 0.25) {
    const org = [0, 0, 0];
    const n = Math.floor(midCover * 5);
    for (let q = 0; q < n; q++) {
      const hq = hash(SEED.growth + 16, gi, gj, q);
      const face = hq & 3;
      let yy = H * (0.4 + 0.6 * unit(hash(SEED.growth + 17, gi, gj, q)));
      let t = unit(hash(SEED.growth + 18, gi, gj, q)) * CELL;
      const len = 8 + unit(hq >>> 4) * 30 * midCover;
      organicColor(x0, yy, z0, hq, org);
      const at = (tt) => face === 0 ? [x0 + tt, z0 - 0.7] : face === 1 ? [x0 + tt, z0 + CELL + 0.7] : face === 2 ? [x0 - 0.7, z0 + tt] : [x0 + CELL + 0.7, z0 + tt];
      for (let s2 = 0; s2 < 5 && yy > BASE; s2++) {
        const nt = Math.min(Math.max(t + (unit(hash(SEED.growth + 19, gi, gj, q * 8 + s2)) - 0.5) * 4, 0), CELL);
        const ny = yy - len / 5;
        const [ax, az] = at(t), [bx, bz] = at(nt);
        w.seg(ax, yy, az, bx, ny, bz, 0.5 - s2 * 0.07, org);
        t = nt; yy = ny;
      }
    }
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
