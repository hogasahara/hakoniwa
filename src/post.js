// 画の仕上げ：一度テクスチャに描いてから、トーンを整えて画面に出す。
//
// トーン（URL の tone=）：
//   real … 写実寄り。陰影と質感をそのまま
//   mid  … 中間。色を絞り（彩度を落とし）、差し色（渦、錆、灯り）だけ残す。細い輪郭線
//   ink  … 線画寄り。墨の濃淡と斜線、太い輪郭線。差し色はわずかに残す
//
// 輪郭線は奥行き（深度）だけから求める：
//   ・奥行きが跳ぶところ（物の縁）
//   ・奥行きの逆数の二階差分が 0 でないところ（面が折れる角）。平面では 1/z が画面上で一次なので 0 になる
// 遠くほど線を霧に溶かす（遠景は線ではなく塊として見せる）。
import * as THREE from 'three';

export const TONES = ['real', 'mid', 'ink'];

export class Post {
  constructor(renderer, tone = 'mid') {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture: new THREE.DepthTexture(size.x, size.y),
    });
    this.material = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        texel: { value: new THREE.Vector2(1 / size.x, 1 / size.y) },
        near: { value: 0.5 },
        far: { value: 14000 },
        tone: { value: TONES.indexOf(tone) },
        lineScale: { value: renderer.getPixelRatio() },
        fogDensity: { value: 0.0006 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor, tDepth;
        uniform vec2 texel;
        uniform float near, far, tone, lineScale, fogDensity;
        varying vec2 vUv;

        // 奥行きの逆数（1/z）。平面の上では画面座標について一次
        float invZ(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          float z = near * far / (far - d * (far - near));
          return 1.0 / z;
        }
        float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

        void main() {
          vec3 col = texture2D(tColor, vUv).rgb;
          vec2 o = texel * lineScale * (tone > 1.5 ? 1.5 : 1.0);
          float c = invZ(vUv);
          float l = invZ(vUv - vec2(o.x, 0.0)), r = invZ(vUv + vec2(o.x, 0.0));
          float d = invZ(vUv - vec2(0.0, o.y)), u = invZ(vUv + vec2(0.0, o.y));
          float z = 1.0 / c;
          // 縁：隣との奥行きの比
          float jump = max(max(abs(l - c), abs(r - c)), max(abs(d - c), abs(u - c))) / c;
          float edge = smoothstep(0.02, 0.06, jump);
          // 角：二階差分
          float bend = (abs(l + r - 2.0 * c) + abs(d + u - 2.0 * c)) / c;
          edge = max(edge, smoothstep(0.004, 0.012, bend));
          // 空（いちばん奥）では線を引かない。遠いほど霧に溶かす
          float sky = step(far * 0.9, z);
          float fog = 1.0 - exp(-pow(fogDensity * z * 1.6, 2.0));
          edge *= (1.0 - sky) * (1.0 - fog);

          float y = luma(col);
          float yp = pow(max(y, 0.0), 1.0 / 2.2); // 見た目の明るさ
          // 差し色：彩度がとくに高いところ（渦、灯り）。錆は控えめに残る
          float mx = max(max(col.r, col.g), col.b);
          float sat = (mx - min(min(col.r, col.g), col.b)) / max(mx, 1e-4);
          float accent = smoothstep(0.55, 0.9, sat) * smoothstep(0.01, 0.06, y);

          vec3 outc;
          if (tone < 0.5) {
            outc = col * (1.0 - 0.15 * edge);
          } else if (tone < 1.5) {
            vec3 gray = vec3(y) * vec3(1.0, 0.98, 0.95);
            outc = mix(gray, col, 0.15 + 0.75 * accent);
            outc *= 1.0 - 0.75 * edge;
          } else {
            // 墨：明るさを 5 段に分ける（紙、斜線、交差線、密な交差線、べた）。遠くは紙に溶ける
            float t = mix(yp * 1.6, 1.0, fog * 0.85 + sky);
            vec2 px = gl_FragCoord.xy / lineScale;
            float h1 = step(0.78, fract((px.x + px.y) / 5.0));
            float h2 = step(0.78, fract((px.x - px.y) / 5.0));
            float h3 = step(0.6, fract((px.x + px.y) / 3.0));
            float ink = t > 0.62 ? 0.0 : t > 0.46 ? h1 : t > 0.32 ? max(h1, h2) : t > 0.18 ? max(max(h1, h2), h3) : 1.0;
            vec3 paper = vec3(0.8, 0.78, 0.72);
            vec3 inkc = vec3(0.04, 0.04, 0.05);
            outc = mix(paper, inkc, ink);
            // 差し色は淡く重ねる（渦など）
            outc = mix(outc, col / max(mx, 1e-3) * 0.55, accent * 0.45);
            outc = mix(outc, inkc, edge);
          }
          gl_FragColor = vec4(outc, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target.setSize(size.x, size.y);
    this.material.uniforms.texel.value.set(1 / size.x, 1 / size.y);
  }

  render(scene, camera) {
    const U = this.material.uniforms;
    U.near.value = camera.near;
    U.far.value = camera.far;
    U.fogDensity.value = scene.fog ? scene.fog.density : 0;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }
}
