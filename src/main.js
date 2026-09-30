// 暗い海と霧、座標から生成した塊（寄ると柱が部品の集積に分かれる）、空と天候。
//
// URL の引数（確認用）：
//   t=秒          画面の時刻を固定する
//   view=far|mid|near  決まった位置から見る
//   view=vortex|storm   渦の方角／いちばん近い嵐を、箱庭越しに見る
//   cam=x,y,z,tx,ty,tz  カメラの位置と注視点
//   lod=0..4      全区画の段を固定する（段どうしの辻褄を比べる）
//   hud=1         区画の数などを画面に出す
//   at=日時       世界の時刻をこの日時から始める（例 at=2027-03-01T12:00Z）
//   speed=倍率    世界の時刻の進む速さ（例 speed=3600 で 1 秒に 1 時間）
//   tone=real|mid|ink  画の仕上げ（写実寄り／中間／線画寄り）
import * as THREE from 'three';
import { ChunkView } from './view.js';
import { massHeight } from './field.js';
import { worldHour, GENESIS, HOUR } from './state.js';
import { Atmosphere } from './atmosphere.js';
import { makeStructureMaterial } from './surface.js';
import { Post, TONES } from './post.js';
import { vortexAngle, stormsAlive, stormPosition } from './weather.js';

const params = new URLSearchParams(location.search);
const fixedTime = params.has('t') ? Number(params.get('t')) : null;
const forcedLevel = params.has('lod') ? Number(params.get('lod')) : null;
// 世界の時刻：ふだんは現実の時刻そのもの
const worldStart = params.has('at') ? Date.parse(params.get('at')) : Date.now();
const worldSpeed = params.has('speed') ? Number(params.get('speed')) : 1;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const post = new Post(renderer, TONES.includes(params.get('tone')) ? params.get('tone') : 'real');

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x1f2226, 0.0006);

// 嵐は 5 km 先から見えるので、遠くまで描く
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 14000);

const hemi = new THREE.HemisphereLight(0x9aa0a8, 0x0b0d10, 1.3);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xd2cab8, 1.8);
scene.add(sun);
const atmosphere = new Atmosphere(scene, { sun, hemi, fog: scene.fog });

// 海
const sea = new THREE.Mesh(
  new THREE.PlaneGeometry(30000, 30000),
  new THREE.MeshStandardMaterial({ color: 0x0b0e11, roughness: 0.3, metalness: 0.3 }),
);
sea.rotation.x = -Math.PI / 2;
scene.add(sea);

const material = makeStructureMaterial();
const world = new ChunkView(scene, material, { forcedLevel });

// カメラ
const VIEWS = {
  far: [1500, 380, 900, 0, 120, 0],
  mid: [520, 200, 340, 0, 110, 0],
  near: [150, 70, 250, 60, 90, 120],
};
let fixedCam = null;
if (params.has('cam')) fixedCam = params.get('cam').split(',').map(Number);
else if (VIEWS[params.get('view')]) fixedCam = VIEWS[params.get('view')];

// 自動：塊の周りを回りながら、遠景と寄りをゆっくり行き来する。
// 寄ったときは塊の上をかすめる。柱は場所の高さの 1.3 倍まで、先端の柱はさらに 30 m 伸びるので、
// 周り 40 m の最も高いところより上を飛ぶ
function clearance(x, z) {
  let m = 0;
  for (let j = -2; j <= 2; j++) {
    for (let i = -2; i <= 2; i++) m = Math.max(m, massHeight(x + i * 20, z + j * 20));
  }
  return m * 1.3 + 40;
}

function autoCamera(t) {
  const a = t * 0.015;
  const k = 0.5 - 0.5 * Math.cos(t * 0.01); // 0 = 遠景、1 = 寄り（約 10 分で往復）
  const r = 1300 - k * 950;
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  const y = Math.max(380 - k * 300, clearance(x, z));
  camera.position.set(x, y, z);
  camera.lookAt(0, 110 - k * 40, 0);
}

let hud = null;
if (params.get('hud') === '1') {
  hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;left:8px;top:8px;color:#9aa;font:12px monospace;white-space:pre';
  document.body.appendChild(hud);
}

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post.setSize();
}
addEventListener('resize', resize);

// スクリーンショット側が描画の完了を待つための印
window.__hakoniwa = { frames: 0, busy: true, stats: world.stats };

renderer.setAnimationLoop((ms) => {
  const t = fixedTime ?? ms / 1000;
  const hourNow = (worldStart + t * 1000 * worldSpeed - GENESIS) / HOUR;
  if (params.get('view') === 'vortex') {
    // 渦の反対側から、箱庭越しに渦を見る
    const a = vortexAngle(hourNow);
    camera.position.set(-Math.cos(a) * 1500, 260, -Math.sin(a) * 1500);
    camera.lookAt(Math.cos(a) * 2000, 520, Math.sin(a) * 2000);
  } else if (params.get('view') === 'storm') {
    // いちばん近い嵐を、箱庭越しに見る
    const m = hourNow * 60;
    let best = null, bd = Infinity;
    for (const st of stormsAlive(m)) {
      const p = stormPosition(st, m);
      const d = Math.hypot(p.x, p.z);
      if (d < bd) { bd = d; best = p; }
    }
    const a = best ? Math.atan2(best.z, best.x) : 0;
    camera.position.set(-Math.cos(a) * 1100, 300, -Math.sin(a) * 1100);
    camera.lookAt(best ? best.x : 0, 150, best ? best.z : 0);
  } else if (fixedCam) {
    camera.position.set(fixedCam[0], fixedCam[1], fixedCam[2]);
    camera.lookAt(fixedCam[3], fixedCam[4], fixedCam[5]);
  } else {
    autoCamera(t);
  }
  const worldMs = worldStart + t * 1000 * worldSpeed;
  world.setHour(worldHour(worldMs));
  world.update(camera);
  atmosphere.update((worldMs - GENESIS) / HOUR, camera, t);
  post.render(scene, camera);
  const h = window.__hakoniwa;
  h.frames++;
  h.busy = world.busy;
  h.levels = world.levelCounts();
  h.hour = world.hour;
  h.mean = world.meanState();
  h.air = atmosphere.info;
  if (hud) {
    const m = h.mean;
    hud.textContent =
      `${new Date(worldMs).toISOString().slice(0, 16)}Z  hour ${world.hour}\n` +
      `P ${m.P}  S ${m.S}  D ${m.D}\n` +
      `day ${(h.air.phase * 21).toFixed(1)}/21h  light ${h.air.daylight.toFixed(2)}  storms ${h.air.storms}  ` +
      `gloom ${h.air.gloom.toFixed(2)}  rain ${h.air.atCamera.toFixed(2)}\n` +
      `boxes ${world.stats.boxes}  meshes ${world.stats.meshes}\nlevels ${h.levels.join(' ')}`;
  }
});
