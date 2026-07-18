'use strict';
/* global THREE */

/*
 * ModelDragon — a rigged, animated GLB dragon (Quaternius, CC0)
 * wrapped to expose the same interface as the old procedural Dragon:
 *   .group  (owned/positioned by main), .update(dt, s), .mouthWorld(out), .setScheme(key)
 */

const DRAGON_SCHEMES = {
  caraxes: { body: 0x8f1d22, belly: 0xc98a5a, membrane: 0x5a1013, horn: 0x1b1512, eye: 0xffb02a },
  syrax:   { body: 0xb98a2f, belly: 0xe0c890, membrane: 0x8a6420, horn: 0x3a2c12, eye: 0xffcf5a },
  vhagar:  { body: 0x55604e, belly: 0xa8a088, membrane: 0x3a4436, horn: 0xd8cfc0, eye: 0xd8e8c8 },
  seasmoke:{ body: 0x9aa2a6, belly: 0xd8d4c8, membrane: 0x666c74, horn: 0x3a3a3a, eye: 0x9adfff },
};

const DRAGON_LENGTH = 17;   // nose-to-tail target size, metres

class ModelDragon {
  constructor(scene) {
    this.group = new THREE.Group();   // world transform (owned by main)
    this.inner = new THREE.Group();   // centering / forward-axis fix
    this.group.add(this.inner);
    scene.add(this.group);

    this.ready = false;
    this.schemeKey = 'caraxes';
    this.mouthForward = 1.6;

    this.buildRider();

    // embedded as base64 so file:// works (fetch/XHR is blocked there)
    new THREE.GLTFLoader().load('data:model/gltf-binary;base64,' + DRAGON_GLB_B64,
      gltf => this.onLoad(gltf),
      undefined,
      err => console.error('dragon.glb failed to load', err));
  }

  onLoad(gltf) {
    const model = gltf.scene;

    // normalize size + center
    const bbox = new THREE.Box3().setFromObject(model);
    const size = bbox.getSize(new THREE.Vector3());
    const center = bbox.getCenter(new THREE.Vector3());
    const s = DRAGON_LENGTH / size.z;
    this.fix = new THREE.Group();            // orientation-fix wrapper
    this.fix.scale.setScalar(s);
    this.fix.add(model);
    model.position.sub(center);
    this.inner.add(this.fix);
    this.model = model;

    // materials by name, for recoloring
    this.mats = {};
    model.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.frustumCulled = false;           // skinned bounds go stale when animating
        const list = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of list) (this.mats[m.name] = this.mats[m.name] || []).push(m);
      }
    });

    // bones we care about
    this.headBone = model.getObjectByName('Head');
    this.bodyBone = model.getObjectByName('Body');

    // NOTE: bind pose faces -Z, but the Flying clip rotates the armature to +Z,
    // so no orientation fix is needed.

    // animation
    this.mixer = new THREE.AnimationMixer(model);
    const clip = re => gltf.animations.find(c => re.test(c.name));
    this.flyAction = this.mixer.clipAction(clip(/Flying/i) || gltf.animations[0]);
    this.flyAction.play();

    this.ready = true;
    this.setScheme(this.schemeKey);
  }

  setScheme(key) {
    if (!DRAGON_SCHEMES[key]) return;
    this.schemeKey = key;
    if (!this.ready) return;
    const s = DRAGON_SCHEMES[key];
    const tint = (name, hex, keep) => {
      for (const m of this.mats[name] || []) m.color.set(hex);
    };
    tint('Main', s.body);
    tint('Belly', s.belly);
    tint('Wings', s.membrane);
    tint('Claws', s.horn);
    tint('Eyes', s.eye);
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
    if (this.ready && this.headBone) {
      this.headBone.getWorldPosition(out);
      const fwd = _mdFwd.set(0, 0, 1).applyQuaternion(this.group.quaternion);
      return out.addScaledVector(fwd, this.mouthForward).add(_mdUp.set(0, -0.25, 0));
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

    // rider: glued to the body bone so the saddle follows the animation
    if (this.bodyBone) {
      this.bodyBone.getWorldPosition(_mdV1);
      this.inner.worldToLocal(_mdV1);
      this.rider.position.set(_mdV1.x, _mdV1.y + 6.2, _mdV1.z + 1.8);
    }
    this.rider.visible = true;
    this.cloak.rotation.x = 0.9 + Math.sin(s.t * 9) * 0.12 + Math.min(0.5, s.speed * 0.004);
  }
}

const _mdFwd = new THREE.Vector3();
const _mdUp = new THREE.Vector3();
const _mdV1 = new THREE.Vector3();
