// 骨組みの最小版：暗い海と霧、座標から生成した塊。寄ると柱が部品の集積に分かれる。
//
// URL の引数（確認用）：
//   t=秒          画面の時刻を固定する
//   view=far|mid|near  決まった位置から見る
//   cam=x,y,z,tx,ty,tz  カメラの位置と注視点
//   lod=0..4      全区画の段を固定する（段どうしの辻褄を比べる）
//   hud=1         区画の数などを画面に出す
import * as THREE from 'three';
import { ChunkView } from './view.js';
import { massHeight } from './field.js';

const params = new URLSearchParams(location.search);
const fixedTime = params.has('t') ? Number(params.get('t')) : null;
const forcedLevel = params.has('lod') ? Number(params.get('lod')) : null;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const skyColor = new THREE.Color(0x1f2226);
scene.background = skyColor;
scene.fog = new THREE.FogExp2(skyColor, 0.0006);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 6000);

scene.add(new THREE.HemisphereLight(0x9aa0a8, 0x0b0d10, 1.3));
const sun = new THREE.DirectionalLight(0xd2cab8, 1.8);
sun.position.set(-300, 400, 200);
scene.add(sun);

// 海
const sea = new THREE.Mesh(
  new THREE.PlaneGeometry(12000, 12000),
  new THREE.MeshStandardMaterial({ color: 0x0b0e11, roughness: 0.3, metalness: 0.3 }),
);
sea.rotation.x = -Math.PI / 2;
scene.add(sea);

const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
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
}
addEventListener('resize', resize);

// スクリーンショット側が描画の完了を待つための印
window.__hakoniwa = { frames: 0, busy: true, stats: world.stats };

renderer.setAnimationLoop((ms) => {
  const t = fixedTime ?? ms / 1000;
  if (fixedCam) {
    camera.position.set(fixedCam[0], fixedCam[1], fixedCam[2]);
    camera.lookAt(fixedCam[3], fixedCam[4], fixedCam[5]);
  } else {
    autoCamera(t);
  }
  world.update(camera);
  renderer.render(scene, camera);
  const h = window.__hakoniwa;
  h.frames++;
  h.busy = world.busy;
  h.levels = world.levelCounts();
  if (hud) {
    hud.textContent = `boxes ${world.stats.boxes}  meshes ${world.stats.meshes}\nlevels ${h.levels.join(' ')}`;
  }
});
