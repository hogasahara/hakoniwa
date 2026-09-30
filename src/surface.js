// 構造物の表面：パネルの継ぎ目、垂れた汚れ、構造を覆う有機物（苔・灌木のような茂みと、肉質の菌糸）。
// 模様は世界座標から決めるので、遠い段（要約の箱）でも近い段（部品）でも同じ場所に同じ模様が出る
// （スケールをまたぐ辻褄）。画素より細かい模様は平均の色に溶かして、遠くでちらつかないようにする。
// 見た目だけなので浮動小数でよい。
import * as THREE from 'three';

const NOISE = /* glsl */ `
float sHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float sNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sHash(i), sHash(i + vec3(1,0,0)), f.x), mix(sHash(i + vec3(0,1,0)), sHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(sHash(i + vec3(0,0,1)), sHash(i + vec3(1,0,1)), f.x), mix(sHash(i + vec3(0,1,1)), sHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float sFbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * sNoise(p); p = p * 2.07 + 11.3; a *= 0.5; }
  return v;
}
// 継ぎ目の線：周期 period、太さ w（半幅）。線の上で 1。画素より細かくなると平均の濃さに溶ける
float seam(float x, float period, float w) {
  float fw = fwidth(x);
  float d = abs(fract(x / period + 0.5) - 0.5) * period;
  float line = 1.0 - smoothstep(w - fw, w + fw, d);
  float fade = smoothstep(period * 0.35, period * 0.08, fw);
  return mix(w * 2.0 / period, line, fade);
}
`;

export function makeStructureMaterial() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNor;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNor = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNor;\n' + NOISE)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        {
          vec3 p = vWPos;
          vec3 n = normalize(vWNor);
          // 面の向きで 2 次元の座標を選ぶ（上面は xz、側面は横と高さ）
          vec2 uv = abs(n.y) > 0.5 ? p.xz : (abs(n.x) > 0.5 ? vec2(p.z, p.y) : vec2(p.x, p.y));
          bool side = abs(n.y) <= 0.5;

          // パネルの継ぎ目
          float s = max(seam(uv.x, 2.7, 0.07), side ? seam(uv.y, 3.4, 0.07) : seam(uv.y, 2.7, 0.07));
          diffuseColor.rgb *= 1.0 - 0.35 * s;

          // パネルごとの明るさのばらつき
          vec2 cell = floor(uv / vec2(2.7, side ? 3.4 : 2.7));
          float pv = sHash(vec3(cell, floor(p.y / 40.0)));
          diffuseColor.rgb *= 0.85 + 0.3 * pv;

          // 側面の垂れた汚れ（上から下へ筋になる）
          if (side) {
            float streak = sNoise(vec3(uv.x * 1.3, p.y * 0.04, 0.0));
            float drip = smoothstep(0.45, 0.9, streak) * (0.6 + 0.4 * sNoise(vec3(uv.x * 7.0, p.y * 0.3, 3.0)));
            diffuseColor.rgb *= 1.0 - 0.35 * drip;
          }

          // 有機物：大きな斑（数十 m）で構造を覆う。低いところにやや多い
          float big = sFbm(vec3(p.x / 60.0, p.y / 45.0, p.z / 60.0));
          float cover = big + n.y * 0.04 + (1.0 - smoothstep(0.0, 160.0, p.y)) * 0.06;
          float grain = sFbm(p * 0.9);
          float organic = smoothstep(0.6, 0.68, cover + (grain - 0.5) * 0.16);
          if (organic > 0.0) {
            // 茂み（くすんだ緑）と肉質の菌糸（くすんだ赤褐色）が場所で入れ替わる
            float kind = sFbm(vec3(p.x / 90.0 + 7.0, p.y / 70.0, p.z / 90.0));
            vec3 moss = vec3(0.075, 0.1, 0.045) * (0.6 + 0.8 * grain);
            vec3 flesh = vec3(0.16, 0.07, 0.055) * (0.6 + 0.8 * sFbm(p * 2.3 + 5.0));
            vec3 org = mix(moss, flesh, smoothstep(0.42, 0.62, kind));
            diffuseColor.rgb = mix(diffuseColor.rgb, org, organic);
          }
        }`,
      );
  };
  return material;
}
