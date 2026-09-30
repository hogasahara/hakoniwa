// 区画の表示：カメラからの距離で段を選び、変わった区画だけ作り直す。
// 世界の時刻が 1 時間進むたびに区画の量を求め直し、量が変わった区画も作り直す。
import * as THREE from 'three';
import { CHUNK, LEVELS, chunkColumns, buildChunk } from './chunk.js';
import { WORLD_RADIUS } from './field.js';
import { chunkSite, chunkState } from './state.js';

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
    this.hour = null;
    const n = Math.ceil(WORLD_RADIUS / CHUNK);
    for (let cz = -n; cz < n; cz++) {
      for (let cx = -n; cx < n; cx++) {
        const cols = chunkColumns(cx, cz);
        if (cols.max <= 0) continue;
        this.chunks.push({
          cx, cz, top: cols.max, level: -1, mesh: null, boxes: 0,
          site: chunkSite(cx, cz, CHUNK), cache: new Map(), state: null, dirty: false,
        });
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
      // 境目でのちらつきを防ぐ：すでに段 i 以下（細かい側）なら少し遠くまで留まり、
      // 粗い側から細かくなるには少し近づく必要がある
      const edge = LOD_DISTANCE[i] * (c.level !== -1 && c.level <= i ? 1 + HYSTERESIS : 1 - HYSTERESIS);
      if (d < edge) {
        level = i;
        break;
      }
    }
    return level;
  }

  // 世界の時刻 hour（時間単位の整数）の量にする
  setHour(hour) {
    if (hour === this.hour) return;
    this.hour = hour;
    const oldest = Math.floor(hour / 24) - 120;
    for (const c of this.chunks) {
      const s = chunkState(c.site, hour, c.cache);
      if (!c.state || s.S !== c.state.S || s.D !== c.state.D) c.dirty = c.state !== null;
      c.state = s;
      // 古い日の棲むものの値を捨てる（窓の外）
      for (const day of c.cache.keys()) if (day < oldest) c.cache.delete(day);
    }
  }

  update(camera) {
    const p = camera.position;
    const todo = [];
    for (const c of this.chunks) {
      const d = this.distance(c, p);
      const level = this.wantedLevel(c, d);
      if (level !== c.level || c.dirty) todo.push({ c, level, d });
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
    const { geometry, boxes } = buildChunk(c.cx, c.cz, level, c.state);
    c.level = level;
    c.dirty = false;
    c.boxes = boxes;
    if (geometry) {
      c.mesh = new THREE.Mesh(geometry, this.material);
      this.scene.add(c.mesh);
      this.stats.boxes += boxes;
      this.stats.meshes++;
    }
  }

  // 区画の量の平均（表示用）
  meanState() {
    let P = 0, S = 0, D = 0;
    for (const c of this.chunks) {
      P += c.state.P;
      S += c.state.S;
      D += c.state.D;
    }
    const n = this.chunks.length;
    return { P: Math.round(P / n), S: Math.round(S / n), D: Math.round(D / n) };
  }

  levelCounts() {
    const n = new Array(LEVELS).fill(0);
    for (const c of this.chunks) if (c.level >= 0) n[c.level]++;
    return n;
  }
}
