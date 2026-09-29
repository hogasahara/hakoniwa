// 世界の大きな形と性格。座標 (x, z)（メートル）だけの関数。
// 四則演算・floor・sqrt だけで組む（どのブラウザでも同じ結果になる演算）。
import { hash, unit, SEED } from './hash.js';

// 有限の箱庭の半径。無限の世界へ移すときは、ここの減衰を外す
export const WORLD_RADIUS = 520;

function smooth(t) {
  return t * t * (3 - 2 * t);
}

// 格子間隔 s の値ノイズ。[0, 1)
function valueNoise(seed, x, z, s) {
  const gx = Math.floor(x / s);
  const gz = Math.floor(z / s);
  const fx = smooth(x / s - gx);
  const fz = smooth(z / s - gz);
  const a = unit(hash(seed, gx, gz));
  const b = unit(hash(seed, gx + 1, gz));
  const c = unit(hash(seed, gx, gz + 1));
  const d = unit(hash(seed, gx + 1, gz + 1));
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fz;
}

// 塊の高さ（メートル）。0 以下は何も建たない
export function massHeight(x, z) {
  const n =
    0.45 * valueNoise(SEED.shape, x, z, 420) +
    0.3 * valueNoise(SEED.shape + 1, x, z, 190) +
    0.15 * valueNoise(SEED.shapeFine, x, z, 80) +
    0.1 * valueNoise(SEED.shapeFine + 1, x, z, 36);
  const r = Math.sqrt(x * x + z * z) / WORLD_RADIUS;
  const falloff = r >= 1 ? 0 : 1 - r * r;
  const h = (n * 1.25 - 0.3) * falloff;
  return h <= 0 ? 0 : h * h * 900;
}

// 性格：0 = 灰色の構造、1 = 錆びた構造。[0, 1]
export function rustiness(x, z) {
  const v = valueNoise(SEED.character, x, z, 260) * 0.75 + valueNoise(SEED.character + 1, x, z, 70) * 0.25;
  const c = (v - 0.4) * 3;
  return c < 0 ? 0 : c > 1 ? 1 : c;
}
