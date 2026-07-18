'use strict';
/* global THREE, Noise */

/* ---------------- world layout constants ---------------- */
const WORLD = {
  bounds: 2300,
  islands: [
    { x: 0,    z: 0,    r: 430, h: 95 },   // Dragonstone island
    { x: 1080, z: 260,  r: 540, h: 80 },   // King's Landing island
    { x: -620, z: 520,  r: 160, h: 45 },
    { x: 520,  z: -680, r: 130, h: 38 },
    { x: -350, z: -820, r: 110, h: 28 },
    { x: 950,  z: -520, r: 95,  h: 24 },
  ],
  volcano: { x: 70, z: -50, r: 210, h: 240, craterR: 55, craterDepth: 95 },
  bay: { x: 420, z: -420, rx: 200, rz: 150 },   // ship fleet area (open water)
  city: { x: 754, z: 182 },                     // King's Landing center
  castle: { x: -170, z: 120 },                  // Dragonstone castle
};

/* smoothstep that also works with edge0 > edge1 */
function sstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/* single source of truth for terrain elevation (mesh + collisions) */
function terrainHeight(x, z) {
  // seabed
  let h = -22 + Noise.fbm2(x * 0.004 + 7.3, z * 0.004 + 2.9, 3) * 10;

  for (const isl of WORLD.islands) {
    const d = Math.hypot(x - isl.x, z - isl.z);
    if (d > isl.r) continue;
    const m = sstep(isl.r, isl.r * 0.45, d);
    const n = Noise.fbm2(x * 0.006 + isl.x * 0.01, z * 0.006 + isl.z * 0.01, 4);
    h += m * (6 + Math.pow(n, 1.6) * isl.h);
  }

  // the Dragonmont volcano
  const v = WORLD.volcano;
  const dv = Math.hypot(x - v.x, z - v.z);
  if (dv < v.r) {
    h += sstep(v.r, v.r * 0.12, dv) * v.h;      // cone
    h -= sstep(v.craterR, 0, dv) * v.craterDepth; // crater bowl
  }
  return h;
}

/* ============================================================ */
class World {
  constructor(scene) {
    this.scene = scene;
    this.t = 0;
    this.wind = new THREE.Vector3(2.2, 0, 1.1);
    this.SUN_DIR = new THREE.Vector3(-0.52, 0.34, -0.78).normalize();

    this.buildLights();
    this.buildSky();
    this.buildTerrain();
    this.buildOcean();
    this.buildClouds();
    this.buildVolcano();
    this.buildCastle();
    this.buildCity();
    this.buildTrees();
    this.buildBirds();
    this.buildShips();
  }

  /* ---------------- lights ---------------- */
  buildLights() {
    const hemi = new THREE.HemisphereLight(0xffdcb0, 0x1c2026, 0.55);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffd2a0, 1.25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -260; c.right = 260; c.top = 260; c.bottom = -260;
    c.near = 20; c.far = 1700;
    sun.shadow.bias = -0.0008;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
  }

  /* ---------------- sky dome + sun glow ---------------- */
  buildSky() {
    // soft additive glow around the sun
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const ctx = cv.getContext('2d');
    let g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,240,210,0.4)');
    g.addColorStop(0.25, 'rgba(255,190,120,0.2)');
    g.addColorStop(1, 'rgba(255,150,80,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const glowTex = new THREE.CanvasTexture(cv);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    glow.scale.set(900, 900, 1);
    glow.position.copy(this.SUN_DIR).multiplyScalar(4600);
    glow.renderOrder = -2;
    this.scene.add(glow);

    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    core.scale.set(380, 380, 1);
    core.position.copy(this.SUN_DIR).multiplyScalar(4600);
    core.renderOrder = -1;
    this.scene.add(core);

    const geo = new THREE.SphereGeometry(5200, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uSunDir: { value: this.SUN_DIR },
        uZenith: { value: new THREE.Color(0x2e4a78) },
        uHorizon:{ value: new THREE.Color(0xe0823e) },
        uBelow:  { value: new THREE.Color(0x3a2f2a) },
        uSunCol: { value: new THREE.Color(0xffd9a0) },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uSunDir, uZenith, uHorizon, uBelow, uSunCol;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec3 col;
          if (d.y >= 0.0) col = mix(uHorizon, uZenith, pow(clamp(d.y, 0.0, 1.0), 0.55));
          else            col = mix(uHorizon, uBelow,  pow(clamp(-d.y, 0.0, 1.0), 0.7));
          float s = max(dot(d, uSunDir), 0.0);
          col += uSunCol * (pow(s, 350.0) * 3.0 + pow(s, 8.0) * 0.28);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  /* ---------------- terrain ---------------- */
  buildTerrain() {
    const SIZE = 4800, SEG = 240;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const col = new THREE.Color();

    const sand  = new THREE.Color(0xb39b6b);
    const wet   = new THREE.Color(0x6e6046);
    const grassA= new THREE.Color(0x4f7038);
    const grassB= new THREE.Color(0x7a8a4a);
    const rock  = new THREE.Color(0x6e665e);
    const ash   = new THREE.Color(0x3a3532);
    const basalt= new THREE.Color(0x26221f);

    const v = WORLD.volcano;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);

      // slope estimate
      const e = 6;
      const sx = (terrainHeight(x + e, z) - h) / e;
      const sz = (terrainHeight(x, z + e) - h) / e;
      const slope = Math.hypot(sx, sz);

      const n = Noise.fbm2(x * 0.02 + 3.1, z * 0.02 + 8.7, 3);
      if (h < 1.5) {
        col.lerpColors(wet, sand, sstep(-6, 1.5, h));
      } else if (slope > 0.55) {
        col.copy(rock).offsetHSL(0, 0, (n - 0.5) * 0.08);
      } else if (h > 130) {
        col.copy(ash);
      } else {
        col.lerpColors(grassA, grassB, n);
      }
      // dark basalt near the volcano crater
      const dv = Math.hypot(x - v.x, z - v.z);
      if (dv < v.craterR + 55 && h > 90) col.lerp(basalt, sstep(v.craterR + 55, v.craterR, dv));

      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  /* ---------------- ocean ---------------- */
  buildOcean() {
    const geo = new THREE.PlaneGeometry(7200, 7200, 150, 150);
    geo.rotateX(-Math.PI / 2);
    this.oceanUniforms = {
      uTime:    { value: 0 },
      uSunDir:  { value: this.SUN_DIR },
      uSunColor:{ value: new THREE.Color(0xffc890) },
      uDeep:    { value: new THREE.Color(0x123a4a) },
      uShallow: { value: new THREE.Color(0x2a6a72) },
      uSky:     { value: new THREE.Color(0xe8a06a) },
      uFogColor:{ value: new THREE.Color(0xc8905e) },
      uFogDensity: { value: 0.00045 },
    };
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: this.oceanUniforms,
      vertexShader: `
        uniform float uTime;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        float waveH(vec2 p, float t) {
          return sin(p.x * 0.06 + t * 0.9) * 1.2
               + sin(p.y * 0.045 - t * 0.7) * 1.5
               + sin((p.x + p.y) * 0.02 + t * 0.4) * 2.2;
        }
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float h = waveH(wp.xz, uTime);
          wp.y += h;
          float e = 4.0;
          float hx = waveH(wp.xz + vec2(e, 0.0), uTime) - h;
          float hz = waveH(wp.xz + vec2(0.0, e), uTime) - h;
          vNormal = normalize(vec3(-hx / e, 1.0, -hz / e));
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 uSunDir, uSunColor, uDeep, uShallow, uSky, uFogColor;
        uniform float uFogDensity, uTime;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        void main() {
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 N = normalize(vNormal);
          float fres = pow(1.0 - max(dot(V, N), 0.0), 3.0);
          vec3 col = mix(uDeep, uShallow, clamp(N.y * 0.4 + vWorldPos.y * 0.06 + 0.25, 0.0, 1.0));
          col = mix(col, uSky, fres * 0.7);
          vec3 R = reflect(-V, N);
          float spec = pow(max(dot(R, uSunDir), 0.0), 220.0);
          col += uSunColor * spec * 1.6;
          // whitecap sparkle on wave crests
          float cap = smoothstep(0.72, 0.97,
            sin(vWorldPos.x * 0.9 + uTime * 1.3) * sin(vWorldPos.z * 0.8 - uTime * 1.1)
            + vWorldPos.y * 0.22);
          col += vec3(0.85, 0.9, 0.95) * cap * 0.18;
          float depth = length(cameraPosition - vWorldPos);
          float f = 1.0 - exp(-uFogDensity * uFogDensity * depth * depth);
          col = mix(col, uFogColor, clamp(f, 0.0, 1.0));
          gl_FragColor = vec4(col, 0.93);
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    this.scene.add(mesh);
  }

  /* ---------------- clouds ---------------- */
  makeCloudTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const ctx = cv.getContext('2d');
    for (let i = 0; i < 20; i++) {
      const bx = 30 + Math.random() * 68;
      const by = 42 + Math.random() * 40;
      const br = 12 + Math.random() * 24;
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, 'rgba(255,255,255,0.25)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }
    // shade the undersides for depth
    ctx.globalCompositeOperation = 'source-atop';
    const shade = ctx.createLinearGradient(0, 40, 0, 128);
    shade.addColorStop(0, 'rgba(255,255,255,0)');
    shade.addColorStop(1, 'rgba(70,60,85,0.45)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(cv);
  }

  buildClouds() {
    this.clouds = [];
    const texes = [this.makeCloudTexture(), this.makeCloudTexture(), this.makeCloudTexture()];
    for (let i = 0; i < 46; i++) {
      const mat = new THREE.SpriteMaterial({
        map: texes[i % 3],
        color: 0xffe6c8,
        transparent: true,
        opacity: 0.45 + Math.random() * 0.35,
        depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      const sc = 140 + Math.random() * 240;
      s.scale.set(sc, sc * 0.42, 1);
      s.position.set(
        (Math.random() * 2 - 1) * 2300,
        170 + Math.random() * 260,
        (Math.random() * 2 - 1) * 2300
      );
      this.scene.add(s);
      this.clouds.push(s);
    }
  }

  /* ---------------- volcano lava ---------------- */
  buildVolcano() {
    const v = WORLD.volcano;
    const lavaY = terrainHeight(v.x, v.z) + 7;
    this.craterPos = new THREE.Vector3(v.x, lavaY + 4, v.z);

    this.lavaMat = new THREE.MeshBasicMaterial({ color: 0xff6a1f });
    const lava = new THREE.Mesh(new THREE.CircleGeometry(v.craterR * 0.72, 24), this.lavaMat);
    lava.rotateX(-Math.PI / 2);
    lava.position.set(v.x, lavaY, v.z);
    this.scene.add(lava);

    this.lavaLight = new THREE.PointLight(0xff5a1a, 1.4, 280, 2);
    this.lavaLight.position.set(v.x, lavaY + 14, v.z);
    this.scene.add(this.lavaLight);
  }

  /* ---------------- Dragonstone castle ---------------- */
  buildCastle() {
    const g = new THREE.Group();
    const stone  = new THREE.MeshLambertMaterial({ color: 0x4a4a52 });
    const dark   = new THREE.MeshLambertMaterial({ color: 0x33333a });
    const roof   = new THREE.MeshLambertMaterial({ color: 0x23232a });

    const add = (mesh, x, y, z) => {
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };

    // main keep
    add(new THREE.Mesh(new THREE.BoxGeometry(34, 26, 26), stone), 0, 13, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(26, 34, 20), dark), 0, 17, -6);

    // towers with cone roofs
    const towers = [[-18, 38, -12, 6], [18, 44, -12, 7], [-18, 32, 12, 5], [18, 36, 12, 6], [0, 58, -14, 6]];
    for (const [tx, th, tz, tr] of towers) {
      add(new THREE.Mesh(new THREE.CylinderGeometry(tr, tr * 1.15, th, 8), stone), tx, th / 2, tz);
      add(new THREE.Mesh(new THREE.ConeGeometry(tr * 1.3, 12, 8), roof), tx, th + 6, tz);
    }

    // curtain walls
    add(new THREE.Mesh(new THREE.BoxGeometry(52, 10, 3), dark), 0, 5, 16);
    add(new THREE.Mesh(new THREE.BoxGeometry(52, 10, 3), dark), 0, 5, -20);
    add(new THREE.Mesh(new THREE.BoxGeometry(3, 10, 38), dark), -24, 5, -2);
    add(new THREE.Mesh(new THREE.BoxGeometry(3, 10, 38), dark), 24, 5, -2);

    // jagged rock spikes around the base
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.4;
      const r = 30 + Math.random() * 14;
      const h = 10 + Math.random() * 16;
      const spike = add(new THREE.Mesh(new THREE.ConeGeometry(3.5, h, 5), dark),
        Math.cos(a) * r, h * 0.3, Math.sin(a) * r);
      spike.rotation.z = (Math.random() - 0.5) * 0.4;
    }

    const cx = WORLD.castle.x, cz = WORLD.castle.z;
    const cy = terrainHeight(cx, cz);
    g.position.set(cx, cy - 1, cz);
    g.rotation.y = 0.6;
    this.scene.add(g);

    // brazier points on the two front towers (world space)
    this.braziers = [
      new THREE.Vector3(-18, 34, 12), new THREE.Vector3(18, 38, 12),
    ].map(p => p.applyMatrix4(new THREE.Matrix4().makeRotationY(0.6)).add(new THREE.Vector3(cx, cy - 1, cz)));
  }

  /* ---------------- King's Landing ---------------- */
  buildCity() {
    const g = new THREE.Group();
    const wallMats = [
      new THREE.MeshLambertMaterial({ color: 0xcbb9a0 }),
      new THREE.MeshLambertMaterial({ color: 0xb7a48c }),
      new THREE.MeshLambertMaterial({ color: 0xd8c4a8 }),
    ];
    const roofMats = [
      new THREE.MeshLambertMaterial({ color: 0x8a3b2a }),
      new THREE.MeshLambertMaterial({ color: 0x6e5a3a }),
    ];
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const coneGeo = new THREE.ConeGeometry(1, 1, 4);

    const c = WORLD.city;
    for (let gx = -4; gx <= 4; gx++) {
      for (let gz = -3; gz <= 3; gz++) {
        if (Math.random() < 0.18) continue;
        const x = c.x + gx * 24 + (Math.random() - 0.5) * 10;
        const z = c.z + gz * 24 + (Math.random() - 0.5) * 10;
        const h = terrainHeight(x, z);
        if (h < 2.5) continue;
        const w = 8 + Math.random() * 6, d = 8 + Math.random() * 6;
        const dist = Math.hypot(gx, gz);
        const tall = (5 + Math.random() * 10) * (dist < 2 ? 1.5 : 1);

        const b = new THREE.Mesh(boxGeo, wallMats[(Math.random() * 3) | 0]);
        b.scale.set(w, tall, d);
        b.position.set(x, h + tall / 2 - 0.5, z);
        b.castShadow = b.receiveShadow = true;
        g.add(b);

        const r = new THREE.Mesh(coneGeo, roofMats[(Math.random() * 2) | 0]);
        r.scale.set(w * 0.72, 3 + Math.random() * 3, d * 0.72);
        r.rotation.y = Math.PI / 4;
        r.position.set(x, h + tall - 0.5 + r.scale.y / 2, z);
        r.castShadow = true;
        g.add(r);
      }
    }

    // the Red Keep on its hill
    const keep = new THREE.Group();
    const red = new THREE.MeshLambertMaterial({ color: 0x9c4a34 });
    const redDark = new THREE.MeshLambertMaterial({ color: 0x7a3826 });
    const kx = c.x + 84, kz = c.z + 26;
    const kh = terrainHeight(kx, kz);
    const kb = new THREE.Mesh(new THREE.BoxGeometry(40, 30, 34), red);
    kb.position.set(0, 15, 0);
    kb.castShadow = kb.receiveShadow = true;
    keep.add(kb);
    for (const [tx, tz, th] of [[-22, -14, 42], [22, -14, 48], [0, 18, 38]]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(6, 7, th, 8), redDark);
      t.position.set(tx, th / 2, tz);
      t.castShadow = true;
      keep.add(t);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(7.6, 10, 8), redDark);
      cone.position.set(tx, th + 5, tz);
      keep.add(cone);
    }
    keep.position.set(kx, kh - 1, kz);
    keep.rotation.y = -0.35;
    g.add(keep);

    this.scene.add(g);
  }

  /* ---------------- instanced trees ---------------- */
  buildTrees() {
    const avoid = [
      [WORLD.castle.x, WORLD.castle.z, 95],
      [WORLD.city.x, WORLD.city.z, 135],
      [WORLD.volcano.x, WORLD.volcano.z, 135],
    ];
    const perIsland = [280, 320, 45, 40, 25, 20];
    const spots = [];
    WORLD.islands.forEach((isl, ii) => {
      let placed = 0, tries = 0;
      while (placed < perIsland[ii] && tries++ < perIsland[ii] * 14) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * isl.r * 0.92;
        const x = isl.x + Math.cos(a) * r, z = isl.z + Math.sin(a) * r;
        const h = terrainHeight(x, z);
        if (h < 3 || h > 48) continue;
        const e = 5;
        const slope = Math.hypot(terrainHeight(x + e, z) - h, terrainHeight(x, z + e) - h) / e;
        if (slope > 0.6) continue;
        if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
        spots.push([x, h, z]);
        placed++;
      }
    });

    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.55, 3.2, 5);
    const coneGeo = new THREE.ConeGeometry(2.2, 6.5, 6);
    const trunks = new THREE.InstancedMesh(trunkGeo,
      new THREE.MeshLambertMaterial({ color: 0x4a3626 }), spots.length);
    const leaves = new THREE.InstancedMesh(coneGeo,
      new THREE.MeshLambertMaterial({ color: 0xffffff }), spots.length);
    trunks.castShadow = leaves.castShadow = true;

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(),
          pos = new THREE.Vector3(), scl = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color(), g1 = new THREE.Color(0x2f5230), g2 = new THREE.Color(0x5a7a38);
    spots.forEach(([x, h, z], i) => {
      const s = 0.9 + Math.random() * 0.9;
      q.setFromAxisAngle(up, Math.random() * Math.PI * 2);
      scl.set(s, s, s);
      pos.set(x, h + 1.6 * s, z);
      m.compose(pos, q, scl);
      trunks.setMatrixAt(i, m);
      pos.y = h + 5.8 * s;
      m.compose(pos, q, scl);
      leaves.setMatrixAt(i, m);
      leaves.setColorAt(i, col.lerpColors(g1, g2, Math.random()));
    });
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    this.scene.add(trunks, leaves);
  }

  /* ---------------- bird flocks ---------------- */
  buildBirds() {
    this.birds = [];
    const flocks = [
      { c: [70, 330, -50], r: 280, n: 8 },
      { c: [420, 200, -420], r: 220, n: 6 },
      { c: [754, 170, 182], r: 160, n: 6 },
    ];
    const wingGeo = new THREE.PlaneGeometry(1.1, 0.3);
    wingGeo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x1a1512, side: THREE.DoubleSide });
    for (const f of flocks) {
      for (let i = 0; i < f.n; i++) {
        const b = new THREE.Group();
        const wl = new THREE.Mesh(wingGeo, mat); wl.position.x = -0.5;
        const wr = new THREE.Mesh(wingGeo, mat); wr.position.x = 0.5;
        b.add(wl, wr);
        this.scene.add(b);
        this.birds.push({
          g: b, wl, wr,
          c: new THREE.Vector3(f.c[0], f.c[1], f.c[2]),
          r: f.r * (0.7 + Math.random() * 0.5),
          a: Math.random() * Math.PI * 2,
          sp: 7 + Math.random() * 4,
          ph: Math.random() * 7,
          dy: (Math.random() - 0.5) * 40,
        });
      }
    }
  }

  /* ---------------- ship fleet ---------------- */
  makeShip() {
    const g = new THREE.Group();
    const hullMat = new THREE.MeshLambertMaterial({ color: 0x4a3628 });
    const sailMat = new THREE.MeshLambertMaterial({ color: 0xd8e4d4, side: THREE.DoubleSide });

    const hull = new THREE.Mesh(new THREE.BoxGeometry(13, 2.6, 4.4), hullMat);
    hull.position.y = 0.6;
    hull.castShadow = true;
    g.add(hull);

    const bow = new THREE.Mesh(new THREE.ConeGeometry(2.2, 5, 4), hullMat);
    bow.rotation.z = -Math.PI / 2;
    bow.scale.set(1, 1, 0.7);
    bow.position.set(8.6, 0.6, 0);
    g.add(bow);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 11, 5), hullMat);
    mast.position.y = 6;
    mast.castShadow = true;
    g.add(mast);

    const sail = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 7), sailMat);
    sail.position.set(0, 6.4, 0.3);
    sail.castShadow = true;
    g.add(sail);

    return g;
  }

  placeShip(ship) {
    const b = WORLD.bay;
    for (let tries = 0; tries < 30; tries++) {
      const x = b.x + (Math.random() * 2 - 1) * b.rx;
      const z = b.z + (Math.random() * 2 - 1) * b.rz;
      if (terrainHeight(x, z) > -4) continue;
      let ok = true;
      for (const o of this.ships) {
        if (o !== ship && o.state === 'sailing' &&
            Math.hypot(o.group.position.x - x, o.group.position.z - z) < 55) { ok = false; break; }
      }
      if (!ok) continue;
      ship.group.position.set(x, 0, z);
      return;
    }
    ship.group.position.set(b.x + Math.random() * 100 - 50, 0, b.z + Math.random() * 100 - 50);
  }

  buildShips() {
    this.ships = [];
    for (let i = 0; i < 12; i++) {
      const group = this.makeShip();
      const ship = {
        group,
        heading: Math.random() * Math.PI * 2,
        speed: 1.2 + Math.random() * 1.4,
        phase: Math.random() * Math.PI * 2,
        state: 'sailing',   // sailing | burning | sinking | gone
        burnT: 0,
        flameAcc: 0, smokeAcc: 0,
      };
      this.placeShip(ship);
      group.rotation.y = ship.heading;
      this.scene.add(group);
      this.ships.push(ship);
    }
  }

  resetShips() {
    for (const s of this.ships) {
      s.state = 'sailing';
      s.burnT = 0;
      s.flameAcc = s.smokeAcc = 0;
      s.heading = Math.random() * Math.PI * 2;
      s.group.visible = true;
      s.group.rotation.set(0, s.heading, 0);
      this.placeShip(s);
    }
  }

  /* ---------------- per-frame ---------------- */
  update(dt) {
    this.t += dt;
    const t = this.t;

    this.oceanUniforms.uTime.value = t;

    // lava pulse
    this.lavaLight.intensity = 1.3 + Math.sin(t * 3.7) * 0.3 + Math.sin(t * 9.1) * 0.15;
    this.lavaMat.color.setHSL(0.045 + Math.sin(t * 2.2) * 0.008, 1.0, 0.52 + Math.sin(t * 5.3) * 0.04);

    // birds wheel around their flocks
    for (const b of this.birds) {
      b.a += (b.sp * dt) / b.r;
      b.g.position.set(
        b.c.x + Math.cos(b.a) * b.r,
        b.c.y + b.dy + Math.sin(t * 0.8 + b.ph) * 6,
        b.c.z + Math.sin(b.a) * b.r
      );
      b.g.rotation.y = -b.a;
      const flap = Math.sin(t * 9 + b.ph) * 0.75;
      b.wl.rotation.z = flap;
      b.wr.rotation.z = -flap;
    }

    // clouds drift with the wind
    for (const c of this.clouds) {
      c.position.addScaledVector(this.wind, dt);
      if (c.position.x > 2500) c.position.x -= 5000;
      if (c.position.x < -2500) c.position.x += 5000;
      if (c.position.z > 2500) c.position.z -= 5000;
      if (c.position.z < -2500) c.position.z += 5000;
    }

    // ships
    const b = WORLD.bay;
    for (const s of this.ships) {
      const p = s.group.position;
      if (s.state === 'sailing') {
        s.heading += Math.sin(t * 0.25 + s.phase) * 0.04 * dt;
        p.x += Math.cos(s.heading) * s.speed * dt;
        p.z -= Math.sin(s.heading) * s.speed * dt;
        // stay inside the bay ellipse and off the shallows
        const ex = (p.x - b.x) / b.rx, ez = (p.z - b.z) / b.rz;
        if (ex * ex + ez * ez > 1 || terrainHeight(p.x, p.z) > -4) s.heading += Math.PI * 0.7 * dt;
        p.y = Math.sin(t * 0.9 + s.phase) * 0.35;
        s.group.rotation.y = s.heading;
        s.group.rotation.z = Math.sin(t * 0.7 + s.phase) * 0.05;
        s.group.rotation.x = Math.sin(t * 0.55 + s.phase * 2) * 0.03;
      } else if (s.state === 'sinking') {
        p.y -= 2.2 * dt;
        s.group.rotation.z += 0.22 * dt;
        if (p.y < -10) {
          s.state = 'gone';
          s.group.visible = false;
        }
      }
    }
  }
}
