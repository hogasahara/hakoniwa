// 空と大気の見た目：昼夜（自転 21 時間）、空の一角の巨大な渦、近づいてくる嵐、硫酸の雨。
// ここは見た目だけで、世界の歴史（区画の量）には関わらない。浮動小数と三角関数を使ってよい。
import * as THREE from 'three';
import { stormsAlive, stormPosition, vortexAngle } from './weather.js';

export const ROTATION_HOURS = 21; // 一日の長さ（仮）。現実の一日と割り切れず、毎日 3 時間ずつずれる
const VORTEX_SPIN_HOURS = 7; // 渦が一回転する時間（見た目）
const VORTEX_ELEVATION = 0.3; // 渦の中心の高さ（ラジアン、約 17°）

const NOISE_GLSL = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x),
             mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}`;

// ---- 空 ----
function makeSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3() },
      sunColor: { value: new THREE.Color() },
      vortexDir: { value: new THREE.Vector3() },
      spin: { value: 0 },
      daylight: { value: 1 },
      gloom: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w; // いちばん奥に置く
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith, horizon, sunDir, sunColor, vortexDir;
      uniform float spin, daylight, gloom;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float up = max(d.y, 0.0);
        vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.75, up));

        // 太陽：霞んだ円盤と光の滲み（嵐のときは隠れる）
        float s = max(dot(d, sunDir), 0.0);
        float veil = 1.0 - gloom;
        col += sunColor * (pow(s, 900.0) * 1.2 + pow(s, 12.0) * 0.18) * veil;

        // 渦：楕円に潰した渦巻き。中心ほど強くねじれる
        vec3 c = vortexDir;
        float facing = dot(d, c);
        if (facing > 0.2) {
          vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), c));
          vec3 upv = cross(c, right);
          vec2 p = vec2(dot(d, right), dot(d, upv)) / facing;
          p /= vec2(0.62, 0.3);
          float r = length(p);
          float twist = spin + 5.0 * exp(-r * 1.6);
          float cs = cos(twist), sn = sin(twist);
          vec2 q = mat2(cs, -sn, sn, cs) * p;
          float bands = fbm(q * 2.6 + vec2(0.0, r * 3.0));
          float streak = fbm(vec2(atan(q.y, q.x) * 2.0, r * 7.0 - spin * 2.0));
          float mask = smoothstep(1.25, 0.55, r);
          vec3 rust = mix(vec3(0.095, 0.033, 0.017), vec3(0.35, 0.15, 0.064), bands); // 色は線形の値
          rust = mix(rust, vec3(0.033, 0.013, 0.01), smoothstep(0.35, 0.0, r) * 0.7); // 暗い目
          rust *= 0.55 + 0.6 * streak;
          // 昼は日に照らされ、夜は沈むが、うっすら見える
          rust *= mix(0.1, 1.0, daylight) * (1.0 - 0.5 * gloom);
          // 地平線に近いほど霞む
          float haze = smoothstep(0.0, 0.25, d.y);
          col = mix(col, rust, mask * 0.9 * haze);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), material);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}

// ---- 嵐の見た目：雨の幕の筒と、上にかぶさる暗い雲 ----
function makeStormVisual() {
  const uniforms = {
    time: { value: 0 },
    intensity: { value: 0 },
    tint: { value: new THREE.Color() },
    fogColor: { value: new THREE.Color() },
    fogDensity: { value: 0 },
  };
  const curtain = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1, 48, 1, true).translate(0, 0.5, 0),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying float vDist;
        varying float vY;
        varying float vFace;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vY = w.y;
          vec4 v = viewMatrix * w;
          vDist = -v.z;
          // 正面を向く面ほど雨の層が厚く見え、輪郭の面ほど薄い
          vec3 n = normalize(mat3(modelMatrix) * normal);
          vFace = abs(dot(n, normalize(cameraPosition - w.xyz)));
          gl_Position = projectionMatrix * v;
        }`,
      fragmentShader: /* glsl */ `
        uniform float time, intensity, fogDensity;
        uniform vec3 tint, fogColor;
        varying vec2 vUv;
        varying float vDist;
        varying float vY;
        varying float vFace;
        ${NOISE_GLSL}
        void main() {
          float streak = vnoise(vec2(vUv.x * 260.0, vUv.y * 5.0 + time * 1.6));
          streak = smoothstep(0.45, 1.0, streak);
          float body = fbm(vec2(vUv.x * 12.0, vUv.y * 2.0 - time * 0.05));
          // 雲の底から降りて、地表に届く前に消えていく（硫酸の雨の蒸発）。下端は筋ごとに不揃い
          float evap = smoothstep(20.0 + 200.0 * body, 300.0 + 150.0 * body, vY);
          float edge = smoothstep(0.0, 0.7, vFace);
          float a = intensity * evap * edge * (0.2 + 0.5 * body + 0.35 * streak);
          float fog = 1.0 - exp(-pow(fogDensity * vDist, 2.0));
          vec3 col = mix(tint, fogColor, fog);
          gl_FragColor = vec4(col, a * (1.0 - fog * 0.7));
          #include <colorspace_fragment>
        }`,
    }),
  );
  const cloud = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64).rotateX(Math.PI / 2),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vP;
        varying float vDist;
        void main() {
          vP = position.xz;
          vec4 v = viewMatrix * modelMatrix * vec4(position, 1.0);
          vDist = -v.z;
          gl_Position = projectionMatrix * v;
        }`,
      fragmentShader: /* glsl */ `
        uniform float time, intensity, fogDensity;
        uniform vec3 tint, fogColor;
        varying vec2 vP;
        varying float vDist;
        ${NOISE_GLSL}
        void main() {
          float r = length(vP);
          float t = time * 0.02 + 3.0 * (1.0 - r);
          float cs = cos(t), sn = sin(t);
          vec2 q = mat2(cs, -sn, sn, cs) * vP;
          float n = fbm(q * 3.0 + 5.0);
          float a = intensity * smoothstep(1.0, 0.3, r) * smoothstep(0.25, 0.65, n) * 0.9;
          float fog = 1.0 - exp(-pow(fogDensity * vDist, 2.0));
          vec3 col = mix(tint * (0.35 + 0.5 * n), fogColor, fog);
          gl_FragColor = vec4(col, a * (1.0 - fog * 0.6));
          #include <colorspace_fragment>
        }`,
    }),
  );
  const group = new THREE.Group();
  const clouds = [cloud, cloud.clone(), cloud.clone()];
  group.add(curtain, ...clouds);
  group.userData = { curtain, clouds, uniforms };
  return group;
}

// ---- カメラの周りの雨粒（斜めの筋） ----
const RAIN_BOX = 160;
function makeRain(count = 2500) {
  const pos = new Float32Array(count * 2 * 3);
  const tail = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = Math.random() * RAIN_BOX, y = Math.random() * RAIN_BOX, z = Math.random() * RAIN_BOX;
    for (let k = 0; k < 2; k++) {
      pos.set([x, y, z], (i * 2 + k) * 3);
      tail[i * 2 + k] = k;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('tail', new THREE.BufferAttribute(tail, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      time: { value: 0 },
      camPos: { value: new THREE.Vector3() },
      velocity: { value: new THREE.Vector3(0, -60, 0) },
      intensity: { value: 0 },
      color: { value: new THREE.Color() },
    },
    vertexShader: /* glsl */ `
      attribute float tail;
      uniform float time;
      uniform vec3 camPos, velocity;
      varying float vAlpha;
      varying float vY;
      void main() {
        float B = ${RAIN_BOX.toFixed(1)};
        vec3 p = position + velocity * time;
        p = mod(p - camPos + B * 0.5, B) - B * 0.5 + camPos; // カメラの周りの箱で巡回させる
        p -= velocity * 0.035 * tail; // 筋の長さ
        vY = p.y;
        vAlpha = 1.0 - tail * 0.7;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float intensity;
      uniform vec3 color;
      varying float vAlpha;
      varying float vY;
      void main() {
        float evap = smoothstep(20.0, 200.0, vY);
        gl_FragColor = vec4(color, intensity * vAlpha * evap * 0.55);
        #include <colorspace_fragment>
      }`,
  });
  const lines = new THREE.LineSegments(g, material);
  lines.frustumCulled = false;
  return lines;
}

const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// 色の置き場（毎フレーム作らない）
const C = {
  dayZenith: new THREE.Color(0x3b4450),
  dayHorizon: new THREE.Color(0x8a8578),
  duskZenith: new THREE.Color(0x2a2a38),
  duskHorizon: new THREE.Color(0x8a5a3a),
  nightZenith: new THREE.Color(0x07090d),
  nightHorizon: new THREE.Color(0x151a20),
  gloomZenith: new THREE.Color(0x1c1d1a),
  gloomHorizon: new THREE.Color(0x3a3a2e),
  sunDay: new THREE.Color(0xe0d6c0),
  sunLow: new THREE.Color(0xd08850),
  stormTint: new THREE.Color(0x3c3a30),
};
const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

export class Atmosphere {
  constructor(scene, { sun, hemi, fog }) {
    this.scene = scene;
    this.sun = sun;
    this.hemi = hemi;
    this.fog = fog;
    this.baseFog = fog.density;
    this.sky = makeSky();
    scene.add(this.sky);
    this.storms = [];
    for (let i = 0; i < 6; i++) {
      const s = makeStormVisual();
      s.visible = false;
      scene.add(s);
      this.storms.push(s);
    }
    this.rain = makeRain();
    scene.add(this.rain);
    this.info = {};
  }

  // hourFloat：創世からの時間（小数）。t：画面の秒（雨粒と雲の動き）
  update(hourFloat, camera, t) {
    const U = this.sky.material.uniforms;
    const cam = camera.position;
    this.sky.position.copy(cam);

    // 太陽：21 時間で一周。傾いた円を描き、半分は地平線の下
    const phase = (((hourFloat / ROTATION_HOURS) % 1) + 1) % 1;
    const th = phase * Math.PI * 2 - Math.PI / 2; // phase 0 = 真夜中
    const sunDir = U.sunDir.value.set(Math.cos(th), Math.sin(th) * 0.8, Math.sin(th) * 0.45 + 0.2).normalize();
    const elev = sunDir.y;
    const daylight = smooth(-0.12, 0.25, elev);
    const dusk = smooth(-0.15, 0.05, elev) * (1 - smooth(0.05, 0.35, elev));

    // 嵐：箱庭とカメラへの近さ
    const minute = hourFloat * 60;
    const alive = stormsAlive(minute);
    let atCamera = 0;
    let atIsland = 0;
    let wind = null;
    alive.forEach((st, i) => {
      const p = stormPosition(st, minute);
      const k = st.strength / 1000;
      const dc = Math.hypot(p.x - cam.x, p.z - cam.z);
      const di = Math.hypot(p.x, p.z);
      const wc = smooth(st.r * 2.2, st.r * 0.5, dc) * (0.5 + 0.5 * k);
      const wi = smooth(st.r * 3 + 500, st.r * 0.5, di) * (0.5 + 0.5 * k);
      if (wc > atCamera) {
        atCamera = wc;
        wind = st;
      }
      atIsland = Math.max(atIsland, wi);
      const v = this.storms[i];
      if (!v) return;
      v.visible = true;
      v.position.set(p.x, 0, p.z);
      const { curtain, clouds, uniforms } = v.userData;
      curtain.scale.set(st.r, 560, st.r);
      // 雲は 3 層。下ほど小さく、上ほど広い
      clouds.forEach((c, j) => {
        const w = st.r * (1.6 + j * 0.6);
        c.scale.set(w, 1, w);
        c.position.y = 520 + j * 90;
        c.rotation.y = j * 2.1;
      });
      // 生まれたては薄く、遠くへ抜けると薄れる
      const age = (minute - st.born) * st.speed;
      uniforms.intensity.value = (0.45 + 0.45 * k) * smooth(0, 1500, age) * (1 - smooth(7000, 10000, age));
      uniforms.time.value = t;
      uniforms.tint.value.copy(C.stormTint).multiplyScalar(0.5 + 0.7 * daylight);
    });
    for (let i = alive.length; i < this.storms.length; i++) this.storms[i].visible = false;

    const gloom = Math.max(atCamera, atIsland * 0.75);

    // 空の色：昼・夕・夜を混ぜ、嵐で暗く濁らせる
    tmpA.copy(C.nightZenith).lerp(C.dayZenith, daylight).lerp(C.duskZenith, dusk * 0.6);
    tmpB.copy(C.nightHorizon).lerp(C.dayHorizon, daylight).lerp(C.duskHorizon, dusk * 0.8);
    tmpA.lerp(tmpA.clone().multiply(C.gloomZenith).multiplyScalar(3), gloom * 0.8);
    tmpB.lerp(tmpB.clone().multiply(C.gloomHorizon).multiplyScalar(2.5), gloom * 0.8);
    U.zenith.value.copy(tmpA);
    U.horizon.value.copy(tmpB);
    U.sunColor.value.copy(C.sunLow).lerp(C.sunDay, smooth(0.0, 0.4, elev));
    U.daylight.value = daylight;
    U.gloom.value = gloom;
    U.spin.value = (hourFloat / VORTEX_SPIN_HOURS) * Math.PI * 2;
    const va = vortexAngle(hourFloat);
    U.vortexDir.value
      .set(Math.cos(va) * Math.cos(VORTEX_ELEVATION), Math.sin(VORTEX_ELEVATION), Math.sin(va) * Math.cos(VORTEX_ELEVATION))
      .normalize();

    // 霧は地平線の色に合わせる（遠くの塊が空に溶ける）
    this.fog.color.copy(tmpB);
    this.fog.density = this.baseFog * (1 + 2.5 * atCamera + 0.8 * atIsland);
    for (const v of this.storms) {
      v.userData.uniforms.fogColor.value.copy(tmpB);
      v.userData.uniforms.fogDensity.value = this.fog.density * 0.3; // 嵐は巨大なので遠くからも見える
    }

    // 光
    this.sun.position.copy(sunDir).multiplyScalar(1000);
    this.sun.color.copy(U.sunColor.value);
    this.sun.intensity = 2.0 * daylight * (1 - 0.75 * gloom);
    this.hemi.intensity = (0.4 + 1.5 * daylight) * (1 - 0.45 * gloom);
    this.hemi.color.copy(tmpA).lerp(tmpB, 0.5).multiplyScalar(1.6);

    // 雨：嵐の進む向きに斜めに降る
    const R = this.rain.material.uniforms;
    R.time.value = t;
    R.camPos.value.copy(cam);
    R.intensity.value = atCamera;
    if (wind) R.velocity.value.set((-wind.ux / 1000) * 14, -70, (-wind.uz / 1000) * 14);
    R.color.value.setRGB(0.78, 0.74, 0.5, THREE.SRGBColorSpace).multiplyScalar(0.4 + 0.6 * daylight); // 硫酸の雨の淡い黄

    this.info = { phase, daylight, gloom, atCamera, atIsland, storms: alive.length };
  }
}
