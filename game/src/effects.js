// effects.js — pooled visual effects: no allocation in hot loops.
// Tracers (fading lines), muzzle flash, impact sparks and the grenade
// explosion are all pre-allocated and recycled.
import * as THREE from 'three';

const MAX_TRACERS = 24;
const MAX_SPARKS = 6; // each spark burst is one Points cloud

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    for (let i = 0; i < MAX_TRACERS; i++) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(6); // two endpoints
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0 });
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      this.tracers.push({ line, life: 0, max: 0.09 });
    }
    this.tracerIdx = 0;
    // Muzzle flash: a small additive plane at the gun tip.
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.34),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.flash.visible = false;
    scene.add(this.flash);
    this.flashLife = 0;
    // Spark bursts.
    this.sparks = [];
    for (let i = 0; i < MAX_SPARKS; i++) {
      const n = 14;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const mat = new THREE.PointsMaterial({ color: 0xffc46b, size: 0.09, transparent: true, opacity: 0 });
      const pts = new THREE.Points(geo, mat);
      pts.visible = false;
      pts.frustumCulled = false;
      scene.add(pts);
      this.sparks.push({ pts, vel: new Float32Array(n * 3), life: 0, n });
    }
    this.sparkIdx = 0;
    // Explosion flash sphere, reused.
    this.blast = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.blast.visible = false;
    scene.add(this.blast);
    this.blastLife = 0;
  }

  tracer(from, to, color = 0xffc46b) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % MAX_TRACERS;
    const p = t.line.geometry.attributes.position.array;
    p[0] = from.x; p[1] = from.y; p[2] = from.z;
    p[3] = to.x; p[4] = to.y; p[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.setHex(color);
    t.line.material.opacity = 0.9;
    t.line.visible = true;
    t.life = t.max;
  }

  muzzle(pos, dir) {
    this.flash.position.copy(pos);
    this.flash.lookAt(pos.x + dir.x, pos.y + dir.y, pos.z + dir.z);
    this.flash.material.opacity = 0.95;
    this.flash.visible = true;
    this.flashLife = 0.05;
    const s = 0.8 + Math.random() * 0.5;
    this.flash.scale.set(s, s, s);
  }

  sparksAt(pos) {
    const s = this.sparks[this.sparkIdx];
    this.sparkIdx = (this.sparkIdx + 1) % MAX_SPARKS;
    const p = s.pts.geometry.attributes.position.array;
    for (let i = 0; i < s.n; i++) {
      p[i * 3] = pos.x; p[i * 3 + 1] = pos.y; p[i * 3 + 2] = pos.z;
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2;
      const sp = 2 + Math.random() * 4;
      s.vel[i * 3] = Math.cos(a) * Math.cos(b) * sp;
      s.vel[i * 3 + 1] = Math.sin(b) * sp + 2;
      s.vel[i * 3 + 2] = Math.sin(a) * Math.cos(b) * sp;
    }
    s.pts.geometry.attributes.position.needsUpdate = true;
    s.pts.material.opacity = 1;
    s.pts.visible = true;
    s.life = 0.35;
  }

  explosion(pos, radius) {
    this.blast.position.set(pos.x, pos.y, pos.z);
    this.blast.scale.setScalar(radius);
    this.blast.material.opacity = 0.85;
    this.blast.visible = true;
    this.blastLife = 0.4;
    this.sparksAt(pos);
  }

  update(dt) {
    for (const t of this.tracers) {
      if (!t.line.visible) continue;
      t.life -= dt;
      if (t.life <= 0) { t.line.visible = false; continue; }
      t.line.material.opacity = 0.9 * (t.life / t.max);
    }
    if (this.flash.visible) {
      this.flashLife -= dt;
      if (this.flashLife <= 0) this.flash.visible = false;
      else this.flash.material.opacity = this.flashLife / 0.05;
    }
    for (const s of this.sparks) {
      if (!s.pts.visible) continue;
      s.life -= dt;
      if (s.life <= 0) { s.pts.visible = false; continue; }
      const p = s.pts.geometry.attributes.position.array;
      for (let i = 0; i < s.n; i++) {
        p[i * 3] += s.vel[i * 3] * dt;
        p[i * 3 + 1] += s.vel[i * 3 + 1] * dt;
        p[i * 3 + 2] += s.vel[i * 3 + 2] * dt;
        s.vel[i * 3 + 1] -= 9 * dt;
      }
      s.pts.geometry.attributes.position.needsUpdate = true;
      s.pts.material.opacity = s.life / 0.35;
    }
    if (this.blast.visible) {
      this.blastLife -= dt;
      if (this.blastLife <= 0) this.blast.visible = false;
      else {
        this.blast.material.opacity = 0.85 * (this.blastLife / 0.4);
        this.blast.scale.multiplyScalar(1 + dt * 2.5);
      }
    }
  }
}
