// 区画の表示：カメラからの距離で段を選び、変わった区画だけ作り直す。
import * as THREE from 'three';
import { CHUNK, LEVELS, chunkColumns, buildChunk } from './chunk.js';
import { WORLD_RADIUS } from './field.js';

// 段を切り替える距離（区画の箱までの最短距離、メートル）
const LOD_DISTANCE = [140, 450, 900, 1800];
const HYSTERESIS = 0.1;
const BUILD_BUDGET_MS = 12;

export class ChunkView {
  constructor(scene, material, { forcedLevel = null } = {}) {
    this.scene = scene;
    this.material = material;
    this.forcedLevel = forcedLevel;
    this.chunks = [];
    this.busy = true;
    this.stats = { boxes: 0, meshes: 0 };
    const n = Math.ceil(WORLD_RADIUS / CHUNK);
    for (let cz = -n; cz < n; cz++) {
      for (let cx = -n; cx < n; cx++) {
        const cols = chunkColumns(cx, cz);
        if (cols.max <= 0) continue;
        this.chunks.push({ cx, cz, top: cols.max, level: -1, mesh: null, boxes: 0 });
      }
    }
  }

  distance(c, p) {
    const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
    const dx = Math.max(x0 - p.x, 0, p.x - (x0 + CHUNK));
    const dz = Math.max(z0 - p.z, 0, p.z - (z0 + CHUNK));
    const dy = Math.max(0 - p.y, 0, p.y - c.top);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  wantedLevel(c, d) {
    if (this.forcedLevel !== null) return this.forcedLevel;
    let level = LEVELS - 1;
    for (let i = 0; i < LOD_DISTANCE.length; i++) {
      // 今の段に留まる側へ少し広げて、境目でのちらつきを防ぐ
      const edge = LOD_DISTANCE[i] * (i < c.level ? 1 + HYSTERESIS : 1 - HYSTERESIS);
      if (d < edge) {
        level = i;
        break;
      }
    }
    return level;
  }

  update(camera) {
    const p = camera.position;
    const todo = [];
    for (const c of this.chunks) {
      const d = this.distance(c, p);
      const level = this.wantedLevel(c, d);
      if (level !== c.level) todo.push({ c, level, d });
    }
    todo.sort((a, b) => a.d - b.d);
    const t0 = performance.now();
    let done = 0;
    for (const { c, level } of todo) {
      if (done > 0 && performance.now() - t0 > BUILD_BUDGET_MS && c.level !== -1) break;
      this.rebuild(c, level);
      done++;
    }
    this.busy = done < todo.length;
  }

  rebuild(c, level) {
    if (c.mesh) {
      this.scene.remove(c.mesh);
      c.mesh.geometry.dispose();
      c.mesh = null;
      this.stats.boxes -= c.boxes;
      this.stats.meshes--;
    }
    const { geometry, boxes } = buildChunk(c.cx, c.cz, level);
    c.level = level;
    c.boxes = boxes;
    if (geometry) {
      c.mesh = new THREE.Mesh(geometry, this.material);
      this.scene.add(c.mesh);
      this.stats.boxes += boxes;
      this.stats.meshes++;
    }
  }

  levelCounts() {
    const n = new Array(LEVELS).fill(0);
    for (const c of this.chunks) if (c.level >= 0) n[c.level]++;
    return n;
  }
}
