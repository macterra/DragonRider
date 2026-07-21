'use strict';
/* global THREE, DRAGON_GLB_DEMON, DRAGON_GLB_RED, DRAGON_GLB_GOLD */

/*
 * ModelDragon — rigged, animated, textured GLB dragons. Two realistic rigs
 * (full skeleton, fireBreath bone), three looks:
 *   caraxes  — red rig, pale red tint
 *   syrax    — red rig with gold-shifted texture (The Golden Queen)
 *   vhagar   — dark demon rig
 * (Seasmoke AI dragon: demon rig, grey tint override.)
 * Embedded as base64 so file:// works (fetch/XHR is blocked there).
 */

const DRAGON_DEFS = {
  // size = overall scale, stretch = per-axis [x,y,z] body proportions
  caraxes: { glbKey: 'red',   tint: 0xff9090, saddleY: 1.1, size: 1.0,  stretch: [0.92, 0.9, 1.15] },  // lean, serpentine Blood Wyrm
  syrax:   { glbKey: 'gold',  tint: 0xfff4e0, saddleY: 1.1, size: 0.85, stretch: [1.0, 1.0, 0.95] },   // smallest, compact
  vhagar:  { glbKey: 'demon', tint: 0xd8d0c8, saddleY: 1.1, size: 1.3,  stretch: [1.06, 1.05, 1.0] },  // huge, bulky Queen of All Dragons
};

const GLB_SRC = {
  red:   () => DRAGON_GLB_RED,
  gold:  () => DRAGON_GLB_GOLD,
  demon: () => DRAGON_GLB_DEMON,
};

const DRAGON_LENGTH = 15;   // nose-to-tail target size, metres

const _gltfCache = {};
function loadSharedDragon(glbKey, cb) {
  if (_gltfCache[glbKey]) return cb(_gltfCache[glbKey]);
  const waitKey = glbKey + '_wait';
  (_gltfCache[waitKey] = _gltfCache[waitKey] || []).push(cb);
  if (_gltfCache[waitKey].length > 1) return;
  new THREE.GLTFLoader().load('data:model/gltf-binary;base64,' + GLB_SRC[glbKey](), gltf => {
    _gltfCache[glbKey] = gltf;
    for (const w of _gltfCache[waitKey].splice(0)) w(gltf);
  }, undefined, err => {
    console.error(glbKey + ' dragon failed to load', err);
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:10px;left:10px;z-index:99;font:14px monospace;color:#f66;background:#000;padding:10px;';
    d.textContent = 'DRAGON LOAD ERROR: ' + (err && (err.message || err.toString()));
    document.body.appendChild(d);
  });
}

/* world-space bbox of the *skinned* model, replicating the GPU skinning path
   (Box3.setFromObject only sees the raw bind-pose geometry — wrong here) */
function posedBBox(root) {
  const box = new THREE.Box3();
  const v = new THREE.Vector3(), sk = new THREE.Vector3(), tmp = new THREE.Vector3();
  const m = new THREE.Matrix4();
  root.updateMatrixWorld(true);
  root.traverse(o => {
    if (!o.isSkinnedMesh) return;
    const pos = o.geometry.attributes.position,
          si = o.geometry.attributes.skinIndex,
          sw = o.geometry.attributes.skinWeight;
    for (let i = 0; i < pos.count; i += 5) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.bindMatrix);
      sk.set(0, 0, 0);
      const w = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)],
            bi = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)];
      for (let k = 0; k < 4; k++) {
        if (!w[k]) continue;
        m.multiplyMatrices(o.skeleton.bones[bi[k]].matrixWorld, o.skeleton.boneInverses[bi[k]]);
        sk.addScaledVector(tmp.copy(v).applyMatrix4(m), w[k]);
      }
      box.expandByPoint(sk);
    }
  });
  return box;
}

class ModelDragon {
  constructor(scene, key = 'vhagar', tintOverride = 0) {
    this.def = DRAGON_DEFS[key] || DRAGON_DEFS.vhagar;
    this.tintOverride = tintOverride;

    this.group = new THREE.Group();   // world transform (owned by main)
    this.inner = new THREE.Group();   // centering / orientation fix
    this.group.add(this.inner);
    scene.add(this.group);

    this.ready = false;
    this.buildRider();
    loadSharedDragon(this.def.glbKey, gltf => this.onLoad(gltf));
  }

  findBone(re) {
    let found = null;
    this.model.traverse(o => { if (!found && o.isBone && re.test(o.name)) found = o; });
    return found;
  }

  onLoad(gltf) {
    this.model = THREE.SkeletonUtils.clone(gltf.scene);

    // animation first — measure the posed model, not the raw bind pose
    this.mixer = new THREE.AnimationMixer(this.model);
    const clip = re => gltf.animations.find(c => re.test(c.name));
    this.flyAction = this.mixer.clipAction(clip(/flying|fly/i) || gltf.animations[0]);
    this.flyAction.play();
    this.mixer.update(0.01);

    this.fix = new THREE.Group();
    this.fix.add(this.model);
    this.inner.add(this.fix);

    // measure in the group's local frame: main.js owns group.position/quaternion
    // and may already be rotating it (auto-start / reselect while the GLB loads),
    // which would bake a bogus yaw/pitch into the orientation fix below
    const savedPos = this.group.position.clone();
    const savedQuat = this.group.quaternion.clone();
    this.group.position.set(0, 0, 0);
    this.group.quaternion.identity();
    this.group.updateMatrixWorld(true);

    this.headBone = this.findBone(/^head/i);
    this.fireBone = this.findBone(/firebreath/i);
    this.spineBone = this.findBone(/^spine_05/i) || this.findBone(/^spine_04/i) ||
                     this.findBone(/^torso/i) || this.findBone(/^body$/i) || this.findBone(/^body/i);
    const tailBone = this.findBone(/^tail_30/i) || this.findBone(/^tail_29/i) ||
                     this.findBone(/^body4/i) || this.findBone(/^tail/i);

    // orient from the posed skeleton: spine (tail->head) -> +Z, dorsal up -> +Y.
    // Wing bones give the lateral axis, so pitch/roll are corrected too (the
    // Quaternius rig flies reared-up; a yaw-only fix leaves it vertical).
    // note: GLTFLoader strips dots from node names (Wing1.L -> Wing1L)
    const lWing = this.findBone(/^l_wingflapa_01/i) || this.findBone(/^wing1[._]?l$/i);
    const rWing = this.findBone(/^r_wingflapa_01/i) || this.findBone(/^wing1[._]?r$/i);
    if (this.headBone && tailBone && lWing && rWing) {
      const f = this.headBone.getWorldPosition(new THREE.Vector3())
        .sub(tailBone.getWorldPosition(new THREE.Vector3())).normalize();
      const w = lWing.getWorldPosition(new THREE.Vector3())
        .sub(rWing.getWorldPosition(new THREE.Vector3())).normalize();   // right -> left
      const y = new THREE.Vector3().crossVectors(f, w).normalize();      // dorsal up
      const x = new THREE.Vector3().crossVectors(y, f).normalize();      // re-orthogonalized lateral
      const m = new THREE.Matrix4().makeBasis(x, y, f);
      this.fix.quaternion.setFromRotationMatrix(m).invert();
      this.group.updateMatrixWorld(true);
    } else if (this.headBone && tailBone) {
      // fallback: yaw-only fix on the head->tail axis
      const h = this.headBone.getWorldPosition(new THREE.Vector3());
      const t = tailBone.getWorldPosition(new THREE.Vector3());
      const fwd = h.clone().sub(t);
      this.fix.rotation.y = -Math.atan2(fwd.x, fwd.z);
      this.group.updateMatrixWorld(true);
    }

    // scale + center from the posed skinned model (bind-pose bboxes lie)
    const bbox = posedBBox(this.model);
    const len = Math.max(bbox.getSize(new THREE.Vector3()).z, 0.01);
    const d = this.def, k = DRAGON_LENGTH / len * (d.size || 1);
    const st = d.stretch || [1, 1, 1];
    this.fix.scale.set(k * st[0], k * st[1], k * st[2]);
    this.sizeScale = d.size || 1;
    this.group.updateMatrixWorld(true);

    const mid = posedBBox(this.model).getCenter(new THREE.Vector3());
    this.model.position.sub(this.fix.worldToLocal(mid));

    this.size = posedBBox(this.model).getSize(new THREE.Vector3());   // local frame, debug only

    // restore the flight transform
    this.group.position.copy(savedPos);
    this.group.quaternion.copy(savedQuat);
    this.group.updateMatrixWorld(true);

    // materials
    this.mats = [];
    this.model.traverse(o => {
      if ((o.isMesh || o.isSkinnedMesh) && o.visible) {
        o.castShadow = true;
        o.frustumCulled = false;           // skinned bounds go stale when animating
        const list = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of list) {
          m.metalness = 0.0;               // GLB M/R textures render black otherwise
          m.roughness = 0.7;
          m.metalnessMap = null;
          m.roughnessMap = null;
          m.aoMap = null;
          m.envMapIntensity = 0.45;
          if (!/^eyes$/i.test(m.name)) m.color.set(this.tintOverride || this.def.tint);
          this.mats.push(m);
        }
      }
    });

    this.ready = true;
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
    if (!this.ready) return out.copy(this.group.position);
    if (this.fireBone) return this.fireBone.getWorldPosition(out);
    if (this.headBone) {
      this.headBone.getWorldPosition(out);
      return out.addScaledVector(_mdFwd.set(0, 0, 1).applyQuaternion(this.group.quaternion), 1.5);
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

    // rider follows the saddle point
    if (this.spineBone) {
      this.spineBone.getWorldPosition(_mdV1);
      this.inner.worldToLocal(_mdV1);
      const st = this.def.stretch || [1, 1, 1];
      this.rider.position.set(_mdV1.x, _mdV1.y + (this.def.saddleY || 1.1) * this.sizeScale * st[1], _mdV1.z - 0.4);
    }
    this.rider.visible = true;
    this.cloak.rotation.x = 0.9 + Math.sin(s.t * 9) * 0.12 + Math.min(0.5, s.speed * 0.004);
  }
}

const _mdFwd = new THREE.Vector3();
const _mdV1 = new THREE.Vector3();
