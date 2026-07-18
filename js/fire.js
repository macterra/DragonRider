'use strict';
/* global THREE */

/*
 * CPU-simulated particle pool rendered as a single THREE.Points draw call.
 * Used for dragon fire (additive) and smoke (normal blending).
 */
class ParticlePool {
  constructor(scene, max, additive) {
    this.max = max;
    this.count = 0;

    // simulation state (structure of arrays)
    this.px = new Float32Array(max); this.py = new Float32Array(max); this.pz = new Float32Array(max);
    this.vx = new Float32Array(max); this.vy = new Float32Array(max); this.vz = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.alpha0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);

    // render attributes
    this.aPos = new Float32Array(max * 3);
    this.aColor = new Float32Array(max * 3);
    this.aSize = new Float32Array(max);
    this.aAlpha = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.aPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.aColor, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.aSize, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.aAlpha, 1).setUsage(THREE.DynamicDrawUsage));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 aColor;
        varying float vA;
        varying vec3 vC;
        void main() {
          vC = aColor;
          vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (280.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA;
        varying vec3 vC;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float m = smoothstep(0.5, 0.06, d);
          if (m * vA < 0.004) discard;
          gl_FragColor = vec4(vC, m * vA);
        }`,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.geo = geo;
  }

  spawn(px, py, pz, vx, vy, vz, life, size, grow, c0, c1, alpha, drag, grav) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.px[i] = px; this.py[i] = py; this.pz[i] = pz;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size0[i] = size; this.grow[i] = grow;
    this.c0[i * 3] = c0[0]; this.c0[i * 3 + 1] = c0[1]; this.c0[i * 3 + 2] = c0[2];
    this.c1[i * 3] = c1[0]; this.c1[i * 3 + 1] = c1[1]; this.c1[i * 3 + 2] = c1[2];
    this.alpha0[i] = alpha;
    this.drag[i] = drag;
    this.grav[i] = grav;
  }

  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove with the last live particle
        const j = --this.count;
        if (i !== j) {
          this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pz[i] = this.pz[j];
          this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
          this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j];
          this.size0[i] = this.size0[j]; this.grow[i] = this.grow[j];
          for (let k = 0; k < 3; k++) {
            this.c0[i * 3 + k] = this.c0[j * 3 + k];
            this.c1[i * 3 + k] = this.c1[j * 3 + k];
          }
          this.alpha0[i] = this.alpha0[j];
          this.drag[i] = this.drag[j];
          this.grav[i] = this.grav[j];
        }
        continue;
      }

      const dragF = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] *= dragF; this.vz[i] *= dragF;
      this.vy[i] = this.vy[i] * dragF + this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;

      const t = 1 - this.life[i] / this.maxLife[i];   // 0 = fresh, 1 = dying
      this.aPos[i * 3] = this.px[i];
      this.aPos[i * 3 + 1] = this.py[i];
      this.aPos[i * 3 + 2] = this.pz[i];
      for (let k = 0; k < 3; k++) {
        this.aColor[i * 3 + k] = this.c0[i * 3 + k] + (this.c1[i * 3 + k] - this.c0[i * 3 + k]) * t;
      }
      this.aSize[i] = this.size0[i] + this.grow[i] * t;
      this.aAlpha[i] = this.alpha0[i] * Math.pow(1 - t, 0.9);
      i++;
    }

    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.setDrawRange(0, this.count);
  }
}
