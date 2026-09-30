// 有機物の分布：構造のどこを有機物（茂み・菌糸）が覆っているか。
// 同じ計算を JavaScript（形を生やす場所）と GLSL（表面の色）の両方に持つ。
// 整数ハッシュ（hash.js と同じ）で組むので、両者は同じ場所で同じ値になる。
// 遠い段でも近い段でも同じ分布なので、遠くで苔色に見える斜面は、寄ると茂みが生えている。
import { hash, SEED } from './hash.js';

// 3 つの傾いた値ノイズの重ね合わせ。高さ方向にも斑が流れる
const LAYERS = [
  // [種の足し, 格子間隔, x に足す y の係数, z に足す y の係数, 重み]
  [0, 70, 0.5, -0.3, 0.55],
  [1, 30, -0.4, 0.6, 0.3],
  [2, 12, 0.0, 1.0, 0.15],
];
const KIND = [3, 110, 0.0, 0.5];

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function vnoise(seed, x, z, s) {
  const gx = Math.floor(x / s);
  const gz = Math.floor(z / s);
  const fx = smooth(x / s - gx);
  const fz = smooth(z / s - gz);
  const a = hash(seed, gx, gz) / 4294967296;
  const b = hash(seed, gx + 1, gz) / 4294967296;
  const c = hash(seed, gx, gz + 1) / 4294967296;
  const d = hash(seed, gx + 1, gz + 1) / 4294967296;
  const top = a + (b - a) * fx;
  return top + (c + (d - c) * fx - top) * fz;
}

// 覆われ具合の元の値（0〜1 付近）。低いところほど少し多い
export function organicField(x, y, z) {
  let v = 0;
  for (const [k, s, ax, az, w] of LAYERS) v += w * vnoise(SEED.organic + k, x + ax * y, z + az * y, s);
  return v + 0.08 * (1 - Math.min(Math.max(y / 200, 0), 1));
}

// 覆われている度合い 0〜1
export const ORGANIC_LO = 0.5;
export const ORGANIC_HI = 0.6;
export function organicCover(x, y, z) {
  const t = Math.min(Math.max((organicField(x, y, z) - ORGANIC_LO) / (ORGANIC_HI - ORGANIC_LO), 0), 1);
  return smooth(t);
}

// 0 = 茂み（くすんだ緑）、1 = 肉質の菌糸（赤褐色）
export function organicKind(x, y, z) {
  const [k, s, ax, az] = KIND;
  return vnoise(SEED.organic + k, x + ax * y, z + az * y, s);
}

// 同じ計算の GLSL 版（WebGL2 の uint を使う）
const u = (n) => `${n >>> 0}u`;
export const ORGANIC_GLSL = /* glsl */ `
uint oMix(uint h) {
  h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; h *= 0x846ca68bu; h ^= h >> 16u;
  return h;
}
uint oHash(uint seed, int a, int b) {
  uint h = oMix(seed);
  h = oMix(h ^ (uint(a) * 0x9e3779b1u));
  h = oMix(h ^ (uint(b) * 0x85ebca77u));
  h = oMix(h);
  h = oMix(h);
  return h;
}
float oNoise(uint seed, float x, float z, float s) {
  float fxs = floor(x / s), fzs = floor(z / s);
  int gx = int(fxs), gz = int(fzs);
  float fx = x / s - fxs, fz = z / s - fzs;
  fx = fx * fx * (3.0 - 2.0 * fx);
  fz = fz * fz * (3.0 - 2.0 * fz);
  float a = float(oHash(seed, gx, gz)) / 4294967296.0;
  float b = float(oHash(seed, gx + 1, gz)) / 4294967296.0;
  float c = float(oHash(seed, gx, gz + 1)) / 4294967296.0;
  float d = float(oHash(seed, gx + 1, gz + 1)) / 4294967296.0;
  float top = a + (b - a) * fx;
  return top + (c + (d - c) * fx - top) * fz;
}
float organicField(vec3 p) {
  float v = 0.0;
${LAYERS.map(([k, s, ax, az, w]) => `  v += ${w.toFixed(4)} * oNoise(${u(SEED.organic + k)}, p.x + ${ax.toFixed(4)} * p.y, p.z + ${az.toFixed(4)} * p.y, ${s.toFixed(1)});`).join('\n')}
  return v + 0.08 * (1.0 - clamp(p.y / 200.0, 0.0, 1.0));
}
float organicCover(vec3 p) {
  return smoothstep(${ORGANIC_LO.toFixed(4)}, ${ORGANIC_HI.toFixed(4)}, organicField(p));
}
float organicKind(vec3 p) {
  return oNoise(${u(SEED.organic + KIND[0])}, p.x + ${KIND[2].toFixed(4)} * p.y, p.z + ${KIND[3].toFixed(4)} * p.y, ${KIND[1].toFixed(1)});
}
`;
