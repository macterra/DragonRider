'use strict';
/* global THREE, DRAGON_GLB_B64 */

/*
 * ModelDragon — a rigged, animated, fully textured GLB dragon wrapped to expose:
 *   .group  (owned/positioned by main), .update(dt, s), .mouthWorld(out), .setScheme(key)
 *
 * The GLB is loaded once and cloned (SkeletonUtils) for additional instances.
 * Embedded as base64 so file:// works (fetch/XHR is blocked there).
 */

const DRAGON_SCHEMES = {
  caraxes: { tint: 0xffc4b8, name: 'CARAXES' },
  syrax:   { tint: 0xffe6b3, name: 'SYRAX' },
  vhagar:  { tint: 0xc4cbb8, name: 'VHAGAR' },
  seasmoke:{ tint: 0xd0d8e0, name: 'SEASMOKE' },
};

const DRAGON_LENGTH = 15;   // nose-to-tail target size, metres

let _sharedGltf = null;
const _waiters = [];
function loadSharedDragon(cb) {
  if (_sharedGltf) return cb(_sharedGltf);
  _waiters.push(cb);
  if (_waiters.length > 1) return;
  new THREE.GLTFLoader().load('data:model/gltf-binary;base64,' + DRAGON_GLB_B64, gltf => {
    _sharedGltf = gltf;
    for (const w of _waiters.splice(0)) w(gltf);
  }, undefined, err => {
    console.error('dragon.glb failed to load', err);
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:10px;left:10px;z-index:99;font:14px monospace;color:#f66;background:#000;padding:10px;white-space:pre-wrap;max-width:90%';
    d.textContent = 'DRAGON LOAD ERROR: ' + (err && (err.message || err.reason || err.toString()));
    document.body.appendChild(d);
  });
}

class ModelDragon {
  constructor(scene) {
    this.group = new THREE.Group();   // world transform (owned by main)
    this.inner = new THREE.Group();   // centering / orientation fix
    this.group.add(this.inner);
    scene.add(this.group);

    this.ready = false;
    this.schemeKey = 'caraxes';
    this.mouthOffset = new THREE.Vector3(0, 0, 1);

    this.buildRider();
    loadSharedDragon(gltf => this.onLoad(gltf));
  }

  findBone(re) {
    let found = null;
    this.model.traverse(o => { if (!found && o.isBone && re.test(o.name)) found = o; });
    return found;
  }

  onLoad(gltf) {
    this.model = THREE.SkeletonUtils.clone(gltf.scene);

    this.headBone = this.findBone(/^head/i);
    this.fireBone = this.findBone(/firebreath/i);
    this.spineBone = this.findBone(/^spine_05/i) || this.findBone(/^spine_04/i);
    const tailBone = this.findBone(/^tail_30/i) || this.findBone(/^tail_29/i) || this.findBone(/^tail/i);

    this.fix = new THREE.Group();
    this.fix.add(this.model);
    this.inner.add(this.fix);

    // animation first — the bind pose may be degenerate; measure after frame 0
    this.mixer = new THREE.AnimationMixer(this.model);
    const clip = re => gltf.animations.find(c => re.test(c.name));
    this.flyAction = this.mixer.clipAction(clip(/flying|fly/i) || gltf.animations[0]);
    this.flyAction.play();
    this.mixer.update(0.01);
    this.inner.updateMatrixWorld(true);

    // normalize size from the actual skeleton span (head -> tail tip)
    let span = 10;
    if (this.headBone && tailBone) {
      span = this.headBone.getWorldPosition(new THREE.Vector3())
        .distanceTo(tailBone.getWorldPosition(new THREE.Vector3()));
    } else {
      const bbox = new THREE.Box3().setFromObject(this.model);
      span = bbox.getSize(new THREE.Vector3()).z;
    }
    const s = DRAGON_LENGTH / Math.max(span, 0.01);
    this.fix.scale.setScalar(s);
    this.inner.updateMatrixWorld(true);

    // diagnostics for the debug overlay
    const bb = new THREE.Box3().setFromObject(this.model).getSize(new THREE.Vector3());
    this.diag = { span: +span.toFixed(1), bbox: [bb.x, bb.y, bb.z].map(v => Math.round(v)) };

    // center on the skeleton's midpoint
    if (this.headBone && tailBone) {
      const h = this.headBone.getWorldPosition(new THREE.Vector3());
      const t = tailBone.getWorldPosition(new THREE.Vector3());
      const mid = h.clone().add(t).multiplyScalar(0.5);
      // orient: head-tail forward axis -> +Z
      const fwd = h.clone().sub(t);
      this.fix.rotation.y = -Math.atan2(fwd.x, fwd.z);
      this.inner.updateMatrixWorld(true);               // apply rotation before measuring
      this.model.position.sub(this.model.worldToLocal(mid));
    } else {
      const bbox = new THREE.Box3().setFromObject(this.model);
      const center = bbox.getCenter(new THREE.Vector3());
      this.model.position.sub(center);
    }

    // materials
    this.mats = {};
    this.model.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.frustumCulled = false;           // skinned bounds go stale when animating
        const list = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of list) {
          // the GLB's M/R texture is pure white (metallic=1) -> renders black; use scalars
          m.metalness = 0.0;
          m.roughness = 0.7;
          m.metalnessMap = null;
          m.roughnessMap = null;
          m.aoMap = null;
          m.envMapIntensity = 0.45;        // stay saturated under IBL
          (this.mats[m.name] = this.mats[m.name] || []).push(m);
        }
      }
    });

    this.ready = true;
    this.setScheme(this.schemeKey);
  }

  setScheme(key) {
    if (!DRAGON_SCHEMES[key]) return;
    this.schemeKey = key;
    if (!this.ready) return;
    for (const list of Object.values(this.mats)) {
      for (const m of list) m.color.set(DRAGON_SCHEMES[key].tint);
    }
  }

  buildRider() {
    const r = new THREE.Group();
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, 0.85),
      new THREE.MeshPhongMaterial({ color: 0x3a2418 }));
    saddle.position.y = -0.08;
    r.add(saddle);
    const cloth = new THREE.MeshPhongMaterial({ color: 0x1a1a1c });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.55, 6), cloth);
    torso.position.y = 0.3;
    r.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6),
      new THREE.MeshPhongMaterial({ color: 0xe8e0d8 }));   // silver hair
    head.position.y = 0.68;
    r.add(head);
    this.cloak = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.8),
      new THREE.MeshPhongMaterial({ color: 0x5a0d12, side: THREE.DoubleSide }));
    this.cloak.position.set(0, 0.25, -0.3);
    this.cloak.rotation.x = 0.9;
    r.add(this.cloak);
    this.rider = r;
    this.rider.visible = false;
    this.inner.add(this.rider);
  }

  /* world-space mouth position (fire emitter origin) */
  mouthWorld(out) {
    if (this.ready && this.fireBone) return this.fireBone.getWorldPosition(out);
    if (this.ready && this.headBone) {
      this.headBone.getWorldPosition(out);
      const fwd = _mdFwd.set(0, 0, 1).applyQuaternion(this.group.quaternion);
      return out.addScaledVector(fwd, 1.5);
    }
    return out.copy(this.group.position);
  }

  /* s = { speed, pitch, roll, firing, boost, t } */
  update(dt, s) {
    if (!this.ready) return;

    // flap slower when gliding fast, beat hard when slow/climbing
    let glide = Math.min(1, Math.max(0, (s.speed - 32) / 45));
    if (s.pitch > 0.12) glide *= 0.4;
    this.flyAction.timeScale = THREE.MathUtils.lerp(1.25, 0.25, glide);

    this.mixer.update(dt);

    // rider: glued to the mid-spine so the saddle follows the animation
    if (this.spineBone) {
      this.spineBone.getWorldPosition(_mdV1);
      this.inner.worldToLocal(_mdV1);
      this.rider.position.set(_mdV1.x, _mdV1.y + 1.1, _mdV1.z - 0.4);
    }
    this.rider.visible = true;
    this.cloak.rotation.x = 0.9 + Math.sin(s.t * 9) * 0.12 + Math.min(0.5, s.speed * 0.004);
  }
}

const _mdFwd = new THREE.Vector3();
const _mdV1 = new THREE.Vector3();
