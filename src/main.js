// 仮の画面：暗い海と霧、海から突き出た灰色の塊。
// 描画と確認の仕組みを通すためのもので、世界の生成はまだ入っていない。
import * as THREE from 'three';

const params = new URLSearchParams(location.search);
// ?t=秒 で画面の時刻を固定する（スクリーンショット用）
const fixedTime = params.has('t') ? Number(params.get('t')) : null;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const skyColor = new THREE.Color(0x1a1d22);
scene.background = skyColor;
scene.fog = new THREE.FogExp2(skyColor, 0.0008);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 1, 5000);

scene.add(new THREE.HemisphereLight(0x8a9099, 0x0b0d10, 1.2));
const sun = new THREE.DirectionalLight(0xc9c2b4, 1.6);
sun.position.set(-300, 400, 200);
scene.add(sun);

// 海
const sea = new THREE.Mesh(
  new THREE.PlaneGeometry(8000, 8000),
  new THREE.MeshStandardMaterial({ color: 0x0c1014, roughness: 0.35, metalness: 0.2 }),
);
sea.rotation.x = -Math.PI / 2;
scene.add(sea);

// 仮の塊：座標の整数ハッシュで箱の高さを決める
function hash2(x, y) {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const box = new THREE.BoxGeometry(1, 1, 1);
box.translate(0, 0.5, 0);
const N = 24;
const cell = 12;
const blocks = new THREE.InstancedMesh(
  box,
  new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.9 }),
  N * N,
);
const m = new THREE.Matrix4();
let count = 0;
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const x = (i - N / 2 + 0.5) * cell;
    const z = (j - N / 2 + 0.5) * cell;
    const r = Math.hypot(x, z) / (N * cell * 0.5);
    if (r > 1) continue;
    const h = hash2(i, j);
    const height = (1 - r * r) * 260 * (0.4 + ((h & 0xff) / 255) * 0.6);
    const w = cell * (0.6 + ((h >>> 8) & 0xff) / 255 * 0.5);
    m.makeScale(w, height, w);
    m.setPosition(x, -10, z);
    blocks.setMatrixAt(count++, m);
  }
}
blocks.count = count;
scene.add(blocks);

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);

// スクリーンショット側が描画の完了を待つための印
window.__hakoniwa = { frames: 0 };

renderer.setAnimationLoop((ms) => {
  const t = fixedTime ?? ms / 1000;
  const a = t * 0.02;
  camera.position.set(Math.cos(a) * 900, 180, Math.sin(a) * 900);
  camera.lookAt(0, 90, 0);
  renderer.render(scene, camera);
  window.__hakoniwa.frames++;
});
