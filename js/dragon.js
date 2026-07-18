'use strict';
/* global THREE */

const DRAGON_SCHEMES = {
  caraxes: { body: 0x661214, belly: 0xb87a4e, membrane: 0x3d0c0e, horn: 0x1b1512, eye: 0xffb02a, spike: 0x240a0a },
  syrax:   { body: 0xa07a28, belly: 0xe0c890, membrane: 0x6e5218, horn: 0x3a2c12, eye: 0xffcf5a, spike: 0x4a3a14 },
  vhagar:  { body: 0x4c5546, belly: 0xa8a088, membrane: 0x323b2e, horn: 0xd8cfc0, eye: 0xd8e8c8, spike: 0x2a3028 },
  seasmoke:{ body: 0x8a9296, belly: 0xd8d4c8, membrane: 0x5a6068, horn: 0x3a3a3a, eye: 0x9adfff, spike: 0x4a4e52 },
};

/* spine keys from tail tip to head base: [z, y, radius] (forward = +Z) */
const SPINE_KEYS = [
  [-10.5, -0.20, 0.06], [-9.3, -0.16, 0.13], [-8.0, -0.11, 0.23],
  [-6.6, -0.06, 0.37],  [-5.2, -0.02, 0.54], [-3.8,  0.00, 0.74],
  [-2.5,  0.03, 0.94],  [-1.2,  0.05, 1.11], [ 0.0,  0.05, 1.21],
  [ 1.2,  0.06, 1.24],  [ 2.3,  0.08, 1.16], [ 3.3,  0.20, 0.98],
  [ 4.2,  0.60, 0.80],  [ 5.0,  1.10, 0.64], [ 5.8,  1.60, 0.50],
  [ 6.5,  2.05, 0.40],  [ 7.1,  2.40, 0.33],
];

const BODY_RINGS = 46;   // cross-sections along the spine
const RING_PTS = 12;     // points per cross-section (+1 seam vertex)

/* normalized cumulative length for each key */
const KEY_T = (() => {
  const t = [0];
  for (let i = 1; i < SPINE_KEYS.length; i++) {
    const [z0, y0] = SPINE_KEYS[i - 1], [z1, y1] = SPINE_KEYS[i];
    t.push(t[i - 1] + Math.hypot(z1 - z0, y1 - y0));
  }
  return t.map(v => v / t[t.length - 1]);
})();

function radiusAt(t) {
  for (let i = 1; i < KEY_T.length; i++) {
    if (t <= KEY_T[i]) {
      const f = (t - KEY_T[i - 1]) / (KEY_T[i] - KEY_T[i - 1]);
      return SPINE_KEYS[i - 1][2] + (SPINE_KEYS[i][2] - SPINE_KEYS[i - 1][2]) * f;
    }
  }
  return SPINE_KEYS[SPINE_KEYS.length - 1][2];
}

/* ---------------- procedural textures ---------------- */
function makeScaleTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#d8d8d8';
  ctx.fillRect(0, 0, 256, 256);
  for (let row = 0, y = -8; y < 264; y += 15, row++) {
    for (let x = (row % 2 ? 0 : 8) - 8; x < 264; x += 16) {
      const g = 165 + (Math.random() * 55) | 0;
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.beginPath();
      ctx.moveTo(x, y + 15);
      ctx.quadraticCurveTo(x + 8, y - 5, x + 16, y + 15);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(70,70,70,0.4)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeVeinTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#e2e2e2';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(90,90,90,0.55)';
  for (let i = 0; i < 7; i++) {
    ctx.lineWidth = 2.5 - i * 0.25;
    ctx.beginPath();
    ctx.moveTo(2, 2);
    const a = 0.15 + i * 0.19;
    ctx.quadraticCurveTo(Math.cos(a) * 60, Math.sin(a) * 60, Math.cos(a) * 126, Math.sin(a) * 126);
    ctx.stroke();
  }
  // faint mottling
  for (let i = 0; i < 40; i++) {
    const g = 190 + (Math.random() * 40) | 0;
    ctx.fillStyle = `rgba(${g},${g},${g},0.35)`;
    ctx.beginPath();
    ctx.arc(Math.random() * 128, Math.random() * 128, 4 + Math.random() * 9, 0, 7);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeEyeTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 28);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, '#c8c8c8');
  g.addColorStop(1, '#3a3a3a');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(32, 32, 28, 0, 7); ctx.fill();
  // slit pupil
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath(); ctx.ellipse(32, 32, 5, 19, 0, 0, 7); ctx.fill();
  // highlight
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.arc(24, 22, 4, 0, 7); ctx.fill();
  return new THREE.CanvasTexture(cv);
}

/* ============================================================ */
class Dragon {
  constructor(scene, schemeKey) {
    this.group = new THREE.Group();   // world transform (owned by main)
    this.inner = new THREE.Group();   // cosmetic bob
    this.group.add(this.inner);
    scene.add(this.group);

    this.flapPhase = 0;
    this.sweep = 0;
    this.jawOpen = 0.06;

    this.schemeKey = schemeKey || 'caraxes';
    this.buildMaterials();
    this.buildBody();
    this.buildHead();
    this.buildLegs();
    this.wingL = this.buildWing(1);
    this.wingR = this.buildWing(-1);
    this.buildSpikes();
    this.buildTailFin();
    this.buildRider();

    this.mouthLocal = new THREE.Vector3(0, -0.02, 1.5);

    this.inner.traverse(o => { if (o.isMesh) o.castShadow = true; });
  }

  buildMaterials() {
    const s = DRAGON_SCHEMES[this.schemeKey];
    this.scaleTex = makeScaleTexture();
    this.veinTex = makeVeinTexture();
    this.bodyMat = new THREE.MeshPhongMaterial({
      vertexColors: true, map: this.scaleTex, bumpMap: this.scaleTex,
      bumpScale: 0.45, shininess: 24, specular: 0x2a2a2a,
    });
    // for rigid parts (head, legs, wing bones) that have no vertex colors
    this.bodySolidMat = new THREE.MeshPhongMaterial({
      color: s.body, map: this.scaleTex, bumpMap: this.scaleTex,
      bumpScale: 0.45, shininess: 24, specular: 0x2a2a2a,
    });
    this.membraneMat = new THREE.MeshPhongMaterial({
      color: s.membrane, map: this.veinTex, side: THREE.DoubleSide,
      shininess: 8, transparent: true, opacity: 0.97,
    });
    this.hornMat = new THREE.MeshPhongMaterial({ color: s.horn, shininess: 42 });
    this.spikeMat = new THREE.MeshPhongMaterial({ color: s.spike, shininess: 34 });
    this.toothMat = new THREE.MeshPhongMaterial({ color: 0xe8dcc8, shininess: 55 });
    this.eyeMat = new THREE.MeshBasicMaterial({ map: makeEyeTexture(), transparent: true });
    this.eyeMat.color.set(s.eye);
  }

  setScheme(key) {
    if (!DRAGON_SCHEMES[key] || key === this.schemeKey) return;
    this.schemeKey = key;
    const s = DRAGON_SCHEMES[key];
    this.bodySolidMat.color.set(s.body);
    this.membraneMat.color.set(s.membrane);
    this.hornMat.color.set(s.horn);
    this.spikeMat.color.set(s.spike);
    this.eyeMat.color.set(s.eye);
    this.paintBody();
  }

  /* ---------------- the lofted body ---------------- */
  buildBody() {
    this.spinePts = SPINE_KEYS.map(([z, y]) => new THREE.Vector3(0, y, z));
    this.curve = new THREE.CatmullRomCurve3(this.spinePts, false, 'catmullrom', 0.5);

    const M = BODY_RINGS, R = RING_PTS;
    const vertsPerRing = R + 1;                       // +1 duplicated seam
    const total = M * vertsPerRing + 1;               // +1 tail tip cap point
    this.bodyPos = new Float32Array(total * 3);
    const uvs = new Float32Array(total * 2);

    const idx = [];
    for (let i = 0; i < M - 1; i++) {
      for (let j = 0; j < R; j++) {
        const a = i * vertsPerRing + j, b = a + 1;
        const c = a + vertsPerRing, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    // tail cap fan (last vertex = tip point)
    const tip = M * vertsPerRing;
    for (let j = 0; j < R; j++) idx.push(tip, j + 1, j);

    for (let i = 0; i < M; i++) {
      for (let j = 0; j <= R; j++) {
        const vi = i * vertsPerRing + j;
        uvs[vi * 2] = (j / R) * 2;
        uvs[vi * 2 + 1] = i * 0.45;
      }
    }
    uvs[tip * 2] = 1; uvs[tip * 2 + 1] = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.bodyPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
    geo.setIndex(idx);

    this.bodyMesh = new THREE.Mesh(geo, this.bodyMat);
    this.bodyMesh.frustumCulled = false;
    this.inner.add(this.bodyMesh);

    this.paintBody();
    this.updateBodyGeometry(0);
  }

  /* vertex colors: dorsal = body color, ventral = belly color */
  paintBody() {
    const s = DRAGON_SCHEMES[this.schemeKey];
    const body = new THREE.Color(s.body), belly = new THREE.Color(s.belly);
    const col = this.bodyMesh.geometry.attributes.color;
    const M = BODY_RINGS, R = RING_PTS;
    const c = new THREE.Color();
    for (let i = 0; i < M; i++) {
      const jitter = 0.9 + 0.2 * Math.abs(Math.sin(i * 12.9898) % 1);
      for (let j = 0; j <= R; j++) {
        const th = (j / R) * Math.PI * 2;
        const sTh = Math.sin(th);
        // belly blend: 1 at the bottom, 0 on top
        const b = Math.min(1, Math.max(0, (-sTh - 0.12) / 0.5));
        c.lerpColors(body, belly, b);
        if (sTh > 0.3) c.multiplyScalar(0.92);            // darker back
        c.multiplyScalar(jitter);
        const vi = i * (R + 1) + j;
        col.setXYZ(vi, c.r, c.g, c.b);
      }
    }
    col.setXYZ(M * (R + 1), body.r, body.g, body.b);
    col.needsUpdate = true;
  }

  /* sweep elliptical rings along the animated spine curve */
  updateBodyGeometry(time) {
    const M = BODY_RINGS, R = RING_PTS;
    const pos = new THREE.Vector3(), tan = new THREE.Vector3();
    const side = new THREE.Vector3(), upv = new THREE.Vector3();
    const breathe = Math.sin(time * 1.4) * 0.03;

    for (let i = 0; i < M; i++) {
      const t = i / (M - 1);
      this.curve.getPoint(t, pos);
      this.curve.getTangent(t, tan);
      side.set(-tan.z, 0, tan.x).normalize();
      upv.crossVectors(side, tan);

      let r = radiusAt(t);
      // chest breathing
      const cw = Math.exp(-Math.pow((t - 0.62) / 0.12, 2));
      r *= 1 + breathe * cw;

      for (let j = 0; j <= R; j++) {
        const th = (j / R) * Math.PI * 2;
        const cTh = Math.cos(th), sTh = Math.sin(th);
        const w = sTh < 0 ? 1.06 : 1.08;          // slightly wider belly
        const h = sTh < 0 ? 0.80 : 0.95;          // flattened underside
        let vy = sTh * r * h;
        if (sTh > 0.85) vy += r * 0.07;           // dorsal ridge
        const vx = cTh * r * w;
        const vi = (i * (R + 1) + j) * 3;
        this.bodyPos[vi]     = pos.x + side.x * vx + upv.x * vy;
        this.bodyPos[vi + 1] = pos.y + side.y * vx + upv.y * vy;
        this.bodyPos[vi + 2] = pos.z + side.z * vx + upv.z * vy;
      }
    }
    // tail tip cap
    const tip = M * (R + 1) * 3;
    this.curve.getPoint(0, pos);
    this.bodyPos[tip] = pos.x; this.bodyPos[tip + 1] = pos.y; this.bodyPos[tip + 2] = pos.z;

    const geo = this.bodyMesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  }

  /* ---------------- head ---------------- */
  buildHead() {
    this.head = new THREE.Group();
    this.inner.add(this.head);
    const add = (m, x, y, z, rx = 0, ry = 0, rz = 0) => {
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      this.head.add(m);
      return m;
    };

    // cranium
    const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 10), this.bodySolidMat);
    cranium.scale.set(0.78, 0.66, 1.05);
    add(cranium, 0, 0.05, 0.15);

    // upper snout (tapered)
    const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.34, 1.35, 8), this.bodySolidMat);
    snout.scale.set(1, 1, 1);
    add(snout, 0, -0.02, 0.95, Math.PI / 2).scale.y = 0.72;

    // nose horn
    add(new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.42, 5), this.hornMat), 0, 0.24, 1.35, 0.7);

    // brow ridges
    for (const sd of [-1, 1]) {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.44), this.bodySolidMat),
        sd * 0.26, 0.3, 0.36, 0, -sd * 0.25, sd * 0.18);

      // eye with slit pupil
      const eye = new THREE.Mesh(new THREE.CircleGeometry(0.115, 12), this.eyeMat);
      add(eye, sd * 0.31, 0.13, 0.42, 0, sd * (Math.PI / 2 - 0.55), 0);

      // horn crown: big curved pair
      const h1 = add(new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.8, 6), this.hornMat),
        sd * 0.22, 0.38, -0.25, -1.05, 0, -sd * 0.22);
      const tipDir = new THREE.Vector3(0, Math.cos(-1.05), Math.sin(-1.05));
      add(new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.65, 6), this.hornMat),
        sd * 0.22 + tipDir.x * 0, 0.38 + tipDir.y * 0.68, -0.25 + tipDir.z * 0.68, -0.55, 0, -sd * 0.2);

      // mid horn pair
      add(new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.55, 5), this.hornMat),
        sd * 0.35, 0.2, -0.05, -1.3, 0, -sd * 0.55);

      // cheek spikes
      add(new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.4, 5), this.hornMat),
        sd * 0.42, -0.06, 0.15, -0.4, 0, -sd * 1.35);

      // nostrils
      add(new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 4), this.hornMat),
        sd * 0.09, 0.15, 1.42, 1.2);
    }

    // dark palate visible when the jaw opens
    add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.95),
      new THREE.MeshPhongMaterial({ color: 0x4a1008 })), 0, -0.13, 0.8);

    // upper teeth
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const z = 0.72 + i * 0.18;
        const x = sd * (0.17 - i * 0.016);
        add(new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.13, 4), this.toothMat),
          x, -0.16, z, Math.PI);
      }
    }

    // lower jaw
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, -0.18, 0.35);
    const jawMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.24, 1.15, 7), this.bodySolidMat);
    jawMesh.rotation.x = Math.PI / 2;
    jawMesh.position.set(0, -0.03, 0.6);
    jawMesh.scale.y = 0.55;
    this.jaw.add(jawMesh);
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const z = 0.5 + i * 0.17;
        const x = sd * (0.12 - i * 0.013);
        const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.11, 4), this.toothMat);
        tooth.position.set(x, 0.05, z);
        this.jaw.add(tooth);
      }
    }
    const mouthGlow = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.85),
      new THREE.MeshBasicMaterial({ color: 0xff5a1f }));
    mouthGlow.position.set(0, 0.02, 0.6);
    this.mouthGlow = mouthGlow;
    this.jaw.add(mouthGlow);
    this.head.add(this.jaw);
  }

  /* ---------------- legs with toes and claws ---------------- */
  buildLegs() {
    const mk = (x, y, z, sc) => {
      const leg = new THREE.Group();
      const bone = (a, b, r0, r1) => {
      const dir = new THREE.Vector3().subVectors(b, a);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, dir.length(), 6), this.bodySolidMat);
      m.position.copy(a).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      leg.add(m);
      };
      // haunch
      const haunch = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 7), this.bodySolidMat);
      haunch.scale.set(0.55, 0.68, 0.9);
      leg.add(haunch);
      bone(new THREE.Vector3(0, -0.1, 0.1), new THREE.Vector3(0, -0.95, -0.85), 0.24, 0.16); // thigh
      bone(new THREE.Vector3(0, -0.95, -0.85), new THREE.Vector3(0, -1.65, -0.25), 0.14, 0.09); // calf
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.13, 0.62), this.hornMat);
      foot.position.set(0, -1.7, 0.05);
      leg.add(foot);
      // toes + claws
      for (let ti = -1; ti <= 1; ti++) {
        const a = new THREE.Vector3(ti * 0.11, -1.72, 0.3);
        const b = new THREE.Vector3(ti * 0.22, -1.78, 0.62);
        bone(a, b, 0.05, 0.035);
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.22, 4), this.hornMat);
        claw.position.copy(b).add(new THREE.Vector3(0, -0.02, 0.1));
        claw.rotation.x = Math.PI / 2 - 0.35;
        leg.add(claw);
      }
      leg.position.set(x, y, z);
      leg.scale.setScalar(sc);
      this.inner.add(leg);
    };
    mk(0.95, -0.65, 1.5, 0.72);   // front
    mk(-0.95, -0.65, 1.5, 0.72);
    mk(1.05, -0.7, -2.4, 1.0);    // rear
    mk(-1.05, -0.7, -2.4, 1.0);
  }

  /* ---------------- two-joint wings ---------------- */
  buildWing(side) {
    const group = new THREE.Group();
    group.position.set(side * 1.15, 0.95, 1.6);
    this.inner.add(group);

    const E = new THREE.Vector3(side * 2.4, 0, -0.25);          // elbow (shoulder space)
    const W = new THREE.Vector3(side * 2.15, 0, -0.75);         // wrist (elbow space)
    const tips = [
      new THREE.Vector3(side * 5.3, 0, -1.5),
      new THREE.Vector3(side * 4.6, 0, -3.8),
      new THREE.Vector3(side * 3.4, 0, -5.7),
      new THREE.Vector3(side * 1.7, 0, -7.0),
    ];
    const IN1 = new THREE.Vector3(side * 0.55, 0, -2.2);
    const IN2 = new THREE.Vector3(side * 1.3, 0, -4.3);

    const bone = (parent, a, b, r0, r1) => {
      const dir = new THREE.Vector3().subVectors(b, a);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, dir.length(), 6), this.bodySolidMat);
      m.position.copy(a).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      parent.add(m);
      return m;
    };

    // upper arm (shoulder space)
    bone(group, new THREE.Vector3(0, 0, 0), E, 0.16, 0.11);
    const elbowBall = new THREE.Mesh(new THREE.SphereGeometry(0.15, 7, 6), this.bodySolidMat);
    elbowBall.position.copy(E);
    group.add(elbowBall);

    // elbow joint group
    const elbow = new THREE.Group();
    elbow.position.copy(E);
    group.add(elbow);

    // forearm + wrist claw
    bone(elbow, new THREE.Vector3(0, 0, 0), W, 0.10, 0.07);
    const claw = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.35, 5), this.hornMat);
    claw.position.copy(W).add(new THREE.Vector3(side * 0.15, 0, 0.15));
    claw.rotation.z = -side * 1.2;
    elbow.add(claw);

    // finger digits
    for (let i = 0; i < tips.length; i++) {
      bone(elbow, W, tips[i], 0.065 - i * 0.011, 0.025);
    }

    // membrane — positions rebuilt every frame around the elbow joint
    const mid = (a, b) => new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5).lerp(new THREE.Vector3(0, 0, 0), 0.16);
    const dyn = [W, tips[0], mid(tips[0], tips[1]), tips[1], mid(tips[1], tips[2]),
                 tips[2], mid(tips[2], tips[3]), tips[3]];      // elbow space
    const stat = [new THREE.Vector3(0, 0, 0), E.clone(), IN1, IN2]; // shoulder space

    const totalV = stat.length + dyn.length;
    const posArr = new Float32Array(totalV * 3);
    const uvArr = new Float32Array(totalV * 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));

    // triangle list (indices into [stat(0..3), dyn(4..11)])
    const S = { A0: 0, E: 1, IN1: 2, IN2: 3 };
    const D = { W: 4, F1: 5, M12: 6, F2: 7, M23: 8, F3: 9, M34: 10, F4: 11 };
    const idx = [
      S.A0, S.E, D.W,
      S.A0, D.W, S.IN1,
      D.W, D.F1, D.M12, D.W, D.M12, D.F2, D.W, D.F2, D.M23,
      D.W, D.M23, D.F3, D.W, D.F3, D.M34, D.W, D.M34, D.F4,
      D.W, D.F4, S.IN2, D.W, S.IN2, S.IN1,
    ];
    // mirrored wing: flip winding so both wings share up-facing normals
    if (side < 0) {
      for (let i = 0; i < idx.length; i += 3) {
        const tmp = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = tmp;
      }
    }
    geo.setIndex(idx);

    // planar UVs from rest positions
    const allRest = stat.concat(dyn);
    for (let i = 0; i < allRest.length; i++) {
      uvArr[i * 2] = Math.abs(allRest[i].x) / 7.5;
      uvArr[i * 2 + 1] = -allRest[i].z / 7.5;
    }

    const mesh = new THREE.Mesh(geo, this.membraneMat);
    mesh.frustumCulled = false;
    group.add(mesh);

    const wing = { group, elbow, side, E, W, dyn, stat, posArr, geo };
    this.updateWingMembrane(wing, 0, 0);
    return wing;
  }

  /* fold the membrane around the elbow (rotation z=e then y=f) */
  updateWingMembrane(wing, e, f) {
    const ce = Math.cos(e), se = Math.sin(e);
    const cf = Math.cos(f), sf = Math.sin(f);
    // static (shoulder space)
    for (let i = 0; i < wing.stat.length; i++) {
      const p = wing.stat[i];
      wing.posArr[i * 3] = p.x; wing.posArr[i * 3 + 1] = p.y; wing.posArr[i * 3 + 2] = p.z;
    }
    // dynamic (elbow space → shoulder space)
    for (let i = 0; i < wing.dyn.length; i++) {
      const p = wing.dyn[i];
      const x1 = p.x * ce;              // Rz(e)
      const y1 = p.x * se;
      const z1 = p.z;
      const x2 = x1 * cf + z1 * sf;     // Ry(f)
      const z2 = -x1 * sf + z1 * cf;
      const vi = (wing.stat.length + i) * 3;
      wing.posArr[vi]     = wing.E.x + x2;
      wing.posArr[vi + 1] = y1;
      wing.posArr[vi + 2] = wing.E.z + z2;
    }
    wing.geo.attributes.position.needsUpdate = true;
    wing.geo.computeVertexNormals();
  }

  /* ---------------- dorsal spikes following the spine ---------------- */
  buildSpikes() {
    this.spikes = [];
    for (let i = 0; i < 14; i++) {
      const t = 0.05 + (i / 13) * 0.83;
      const r = radiusAt(t);
      const mesh = new THREE.Mesh(new THREE.ConeGeometry(Math.max(0.06, r * 0.15), 0.25 + r * 0.55, 5), this.spikeMat);
      this.inner.add(mesh);
      this.spikes.push({ mesh, t, r });
    }
  }

  buildTailFin() {
    this.tailFin = new THREE.Group();
    this.inner.add(this.tailFin);
    for (const sd of [-1, 1]) {
      const geo = new THREE.BufferGeometry();
      const v = new Float32Array([0, 0, 0, 0, 0.7, -0.6, 0, 0.1, -1.6, 0, -0.55, -0.7]);
      geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      geo.computeVertexNormals();
      const blade = new THREE.Mesh(geo, this.membraneMat);
      blade.rotation.z = sd * 0.9;
      blade.rotation.y = sd * 0.35;
      this.tailFin.add(blade);
    }
  }

  buildRider() {
    const r = new THREE.Group();
    r.position.set(0, 1.32, 0.4);
    this.inner.add(r);

    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, 0.85),
      new THREE.MeshPhongMaterial({ color: 0x3a2418 }));
    saddle.position.y = -0.08;
    r.add(saddle);

    const cloth = new THREE.MeshPhongMaterial({ color: 0x1a1a1c });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.55, 6), cloth);
    torso.position.y = 0.3;
    r.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6),
      new THREE.MeshPhongMaterial({ color: 0xe8e0d8 }));
    head.position.y = 0.68;
    r.add(head);

    this.cloak = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.8),
      new THREE.MeshPhongMaterial({ color: 0x5a0d12, side: THREE.DoubleSide }));
    this.cloak.position.set(0, 0.25, -0.3);
    this.cloak.rotation.x = 0.9;
    r.add(this.cloak);
  }

  /* world-space mouth position (fire emitter origin) */
  mouthWorld(out) {
    return this.head.localToWorld(out.copy(this.mouthLocal));
  }

  /* s = { speed, pitch, roll, firing, boost, t } */
  update(dt, s) {
    const time = s.t;

    /* --- flight-driven wing motion --- */
    let glide = Math.min(1, Math.max(0, (s.speed - 32) / 45));
    if (s.pitch > 0.12) glide *= 0.4;
    const amp = THREE.MathUtils.lerp(0.8, 0.1, glide);
    const freq = THREE.MathUtils.lerp(2.4, 0.9, glide);
    this.flapPhase += dt * freq * Math.PI * 2;
    const flap = Math.sin(this.flapPhase) * amp + 0.14;
    const elbowFlap = Math.sin(this.flapPhase - 0.55) * amp * 0.6 - 0.08;

    const sweepTarget = s.boost ? 0.55 : glide * 0.22;
    this.sweep += (sweepTarget - this.sweep) * Math.min(1, dt * 4);

    for (const wing of [this.wingL, this.wingR]) {
      const sd = wing.side;
      wing.group.rotation.z = sd * flap;
      wing.group.rotation.y = -sd * this.sweep;
      const e = elbowFlap;
      const f = -sd * this.sweep * 0.9;
      wing.elbow.rotation.z = sd * e;
      wing.elbow.rotation.y = f;
      this.updateWingMembrane(wing, sd * e, f);
    }

    /* --- animate the spine, then re-skin the body --- */
    const pts = this.spinePts;
    for (let i = 0; i < pts.length; i++) {
      const [z, y] = SPINE_KEYS[i];
      const t = KEY_T[i];
      let kx = 0, ky = 0;
      const tailW = Math.max(0, (0.45 - t) / 0.45);
      kx += Math.sin(time * 1.6 - i * 0.55) * 0.4 * tailW + s.roll * 0.55 * tailW;
      const neckW = Math.max(0, (t - 0.8) / 0.2);
      kx += Math.sin(time * 1.3 - i * 0.4) * 0.045 * neckW;
      ky += Math.sin(time * 1.1 + i * 0.3) * 0.02 * neckW;
      pts[i].set(kx, y + ky, z);
    }
    this.updateBodyGeometry(time);

    /* --- spikes ride the spine --- */
    const pos = new THREE.Vector3(), tan = new THREE.Vector3(), upv = new THREE.Vector3(), side = new THREE.Vector3();
    for (const sp of this.spikes) {
      this.curve.getPoint(sp.t, pos);
      this.curve.getTangent(sp.t, tan);
      side.set(-tan.z, 0, tan.x).normalize();
      upv.crossVectors(side, tan);
      const dir = upv.clone().addScaledVector(tan, -0.55).normalize();
      sp.mesh.position.copy(pos).addScaledVector(upv, sp.r * 0.88);
      sp.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    }

    /* --- tail fin --- */
    this.curve.getPoint(0, pos);
    this.curve.getTangent(0, tan);
    this.tailFin.position.copy(pos);
    this.tailFin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan);

    /* --- head follows the neck tip --- */
    this.curve.getPoint(1, pos);
    this.curve.getTangent(1, tan);
    this.head.position.copy(pos).addScaledVector(tan, 0.1);
    this.head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan);
    this.head.rotateX(-s.pitch * 0.25 + (s.firing ? -0.06 : 0));
    this.head.rotateY(Math.sin(time * 0.7) * 0.05);

    const jawTarget = s.firing ? 0.5 : 0.06;
    this.jawOpen += (jawTarget - this.jawOpen) * Math.min(1, dt * 10);
    this.jaw.rotation.x = this.jawOpen;
    this.mouthGlow.visible = s.firing;

    /* --- bob + cloak --- */
    this.inner.position.y = Math.sin(time * 1.8) * 0.08 * (1 - glide);
    this.cloak.rotation.x = 0.9 + Math.sin(time * 9) * 0.12 + Math.min(0.5, s.speed * 0.004);
  }
}
