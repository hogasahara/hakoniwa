// 整数ハッシュ。座標と種から、生成の順番に関係なく同じ値を返す。
// 分岐の判断（そこに建つか、など）はこの整数と四則演算だけで決める。
// Math.sin などはブラウザで最後の桁が違うことがあるので使わない。

function mix(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

// 種と最大 4 つの整数から 32 ビットの符号なし整数
export function hash(seed, a = 0, b = 0, c = 0, d = 0) {
  let h = mix(seed >>> 0);
  h = mix(h ^ Math.imul(a | 0, 0x9e3779b1));
  h = mix(h ^ Math.imul(b | 0, 0x85ebca77));
  h = mix(h ^ Math.imul(c | 0, 0xc2b2ae3d));
  h = mix(h ^ Math.imul(d | 0, 0x27d4eb2f));
  return h;
}

// ハッシュを [0, 1) に
export function unit(h) {
  return h / 4294967296;
}

// 確率 p で真。p は [0, 1]
export function chance(h, p) {
  return h < p * 4294967296;
}

// 用途ごとの種。値を変えると世界が変わる
export const SEED = {
  shape: 0x5a17c0de,
  shapeFine: 0x1c3b9e21,
  character: 0x7e11a5b3,
  column: 0x2d8f6a4c,
  parts: 0x6b0f3e97,
  grow: 0x3f6c2a81,
  damage: 0x5e9d0b43,
  climate: 0x19a7f5c2,
  storm: 0x4c2e8b1d,
  habit: 0x71d3a96e,
};
