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

/* tileable organic detail texture (modulates vertex colors, doubles as bump) */
function makeDetailTexture() {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#b4b4b4';
  ctx.fillRect(0, 0, S, S);
  const blob = (x, y, r, style) => {
    ctx.fillStyle = style;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.fill();
  };
  const wrapBlob = (x, y, r, style) => {
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) blob(x + dx, y + dy, r, style);
  };
  // large soft mottling
  for (let i = 0; i < 260; i++) {
    const g = 155 + (Math.random() * 60) | 0;
    wrapBlob(Math.random() * S, Math.random() * S, 6 + Math.random() * 34,
      `rgba(${g},${g},${g},0.25)`);
  }
  // fine speckle
  for (let i = 0; i < 4200; i++) {
    const g = 130 + (Math.random() * 100) | 0;
    wrapBlob(Math.random() * S, Math.random() * S, 0.6 + Math.random() * 2,
      `rgba(${g},${g},${g},0.5)`);
  }
  // cracks / strata
  ctx.strokeStyle = 'rgba(60,60,60,0.18)';
  for (let i = 0; i < 34; i++) {
    ctx.lineWidth = 0.5 + Math.random() * 1.5;
    let x = Math.random() * S, y = Math.random() * S;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 40; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(300, 300);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

/* grayscale noise → tangent-space normal map texture (tileable via wrapped lattice) */
function makeNormalTexture() {
  const S = 256, P1 = 16, P2 = 32;
  const hash = (ix, iy, p) => {
    ix = ((ix % p) + p) % p; iy = ((iy % p) + p) % p;
    let n = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const vnoise = (x, y, p) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy, p), b = hash(ix + 1, iy, p), c = hash(ix, iy + 1, p), d = hash(ix + 1, iy + 1, p);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++)
      h[y * S + x] = vnoise(x * P1 / S, y * P1 / S, P1) * 0.65 +
                     vnoise(x * P2 / S, y * P2 / S, P2) * 0.35;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S);
  const at = (x, y) => h[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.2;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * S + x) * 4;
      img.data[i]     = (-dx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function canvasTex(size, draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

/* wood planks for ship hulls */
function makeWoodTexture() {
  return canvasTex(128, (ctx, S) => {
    ctx.fillStyle = '#8a6a48';
    ctx.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 16) {
      ctx.fillStyle = 'rgba(40,25,15,0.55)';
      ctx.fillRect(0, y, S, 2);
      for (let x = ((y / 16) % 2) * 32; x < S; x += 64) ctx.fillRect(x, y, 2, 16);   // joints
    }
    for (let i = 0; i < 300; i++) {
      const g = 90 + (Math.random() * 80) | 0;
      ctx.fillStyle = `rgba(${g},${g * 0.7 | 0},${g * 0.45 | 0},0.25)`;
      ctx.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 14, 1);
    }
  });
}

/* plastered wall with window grid and stone base */
function makeWallTexture(base) {
  return canvasTex(128, (ctx, S) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 500; i++) {
      const a = 0.05 + Math.random() * 0.08;
      ctx.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
      ctx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
    }
    // stone base band
    ctx.fillStyle = 'rgba(60,50,45,0.55)';
    ctx.fillRect(0, S - 18, S, 18);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (let x = 0; x < S; x += 21) ctx.fillRect(x, S - 18, 1, 18);
    // windows
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const x = 18 + c * 38, y = 16 + r * 32;
        ctx.fillStyle = 'rgba(220,210,190,0.7)';
        ctx.fillRect(x - 2, y - 2, 16, 20);
        ctx.fillStyle = '#241f18';
        ctx.fillRect(x, y, 12, 16);
      }
    }
  });
}

/* curved roof tiles */
function makeRoofTexture(base) {
  return canvasTex(128, (ctx, S) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 16) {
      for (let x = -8; x < S; x += 16) {
        const ox = ((y / 16) % 2) * 8;
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.beginPath(); ctx.arc(x + ox, y + 14, 8, Math.PI, 0); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.arc(x + ox, y + 15, 8, 0, Math.PI); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.arc(x + ox, y + 14, 8, Math.PI, 0); ctx.stroke();
      }
    }
  });
}

/* stone block courses for the castle */
function makeStoneTexture() {
  return canvasTex(128, (ctx, S) => {
    ctx.fillStyle = '#9a9aa2';
    ctx.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 16) {
      ctx.fillStyle = 'rgba(30,30,40,0.45)';
      ctx.fillRect(0, y, S, 2);
      for (let x = ((y / 16) % 2) * 16; x < S; x += 32) ctx.fillRect(x, y, 2, 16);
    }
    for (let i = 0; i < 400; i++) {
      const a = 0.05 + Math.random() * 0.1;
      ctx.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
      ctx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
    }
  });
}

/* sail with house sigil */
function makeSailTexture() {
  return canvasTex(256, (ctx, S) => {
    ctx.fillStyle = '#e8e0ce';
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(120,100,80,0.35)';
    for (let x = 0; x < S; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, S); ctx.stroke(); }
    // Velaryon sea-green band
    ctx.fillStyle = 'rgba(60,110,90,0.85)';
    ctx.fillRect(0, S - 34, S, 34);
    // seahorse-ish sigil
    ctx.strokeStyle = '#1e4a3c';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(96, 150);
    ctx.bezierCurveTo(70, 110, 110, 60, 145, 78);
    ctx.bezierCurveTo(170, 92, 165, 120, 142, 122);
    ctx.bezierCurveTo(160, 140, 150, 172, 118, 176);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(142, 86, 6, 0, 7); ctx.fillStyle = '#1e4a3c'; ctx.fill();
  });
}

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
    this.buildRocks();
    this.buildBirds();
    this.buildShips();
  }

  /* ---------------- lights ---------------- */
  buildLights() {
    const hemi = new THREE.HemisphereLight(0xffdcb0, 0x1c2026, 0.45);
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
    this.skyMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.skyMesh);   // also reused to bake the IBL environment map
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

    const detail = makeDetailTexture();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: detail,
      bumpMap: detail,
      bumpScale: 0.6,
      roughness: 0.95,
      metalness: 0.0,
    });
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
      tNormal:  { value: makeNormalTexture() },
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
        uniform sampler2D tNormal;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        void main() {
          vec3 V = normalize(cameraPosition - vWorldPos);
          // two scrolling normal-map layers ripple the surface
          vec3 n1 = texture2D(tNormal, vWorldPos.xz * 0.012 + vec2(uTime * 0.008, 0.0)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(tNormal, vWorldPos.xz * 0.031 + vec2(0.0, -uTime * 0.011)).xyz * 2.0 - 1.0;
          vec3 N = normalize(vNormal + vec3(n1.x + n2.x, 0.0, n1.y + n2.y) * 0.18);
          float fres = pow(1.0 - max(dot(V, N), 0.0), 3.0);
          vec3 col = mix(uDeep, uShallow, clamp(N.y * 0.4 + vWorldPos.y * 0.06 + 0.25, 0.0, 1.0));
          col = mix(col, uSky, fres * 0.7);
          vec3 R = reflect(-V, N);
          float spec = pow(max(dot(R, uSunDir), 0.0), 220.0);
          col += uSunColor * spec * 1.6;
          // organic foam patches drifting on the swells
          float fn = texture2D(tNormal, vWorldPos.xz * 0.017 + vec2(uTime * 0.004, 0.0)).x * 0.5
                   + texture2D(tNormal, vWorldPos.xz * 0.041 + vec2(0.0, -uTime * 0.006)).y * 0.5;
          float cap = smoothstep(0.60, 0.78, fn + vWorldPos.y * 0.05);
          col += vec3(0.85, 0.9, 0.95) * cap * 0.25;
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
    const stoneTex = makeStoneTexture();
    const stone  = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, color: 0x6a6a74, map: stoneTex });
    const dark   = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, color: 0x48484e, map: stoneTex });
    const roof   = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, color: 0x23232a });

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
      new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, map: makeWallTexture('#cbb9a0') }),
      new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, map: makeWallTexture('#b7a48c') }),
      new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, map: makeWallTexture('#d8c4a8') }),
    ];
    const roofMats = [
      new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, map: makeRoofTexture('#8a3b2a') }),
      new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, map: makeRoofTexture('#6e5a3a') }),
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
    const redTex = makeWallTexture('#9c4a34');
    const red = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, map: redTex });
    const redDark = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, map: redTex, color: 0xa88878 });
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

    // split into conifers (multi-tier) and broadleaf (blob canopy)
    const conf = [], broad = [];
    for (const s of spots) (Math.random() < 0.72 ? conf : broad).push(s);

    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.55, 3.2, 5);
    const trunkMat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, color: 0x4a3626 });
    const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, color: 0xffffff });
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(),
          pos = new THREE.Vector3(), scl = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color(), g1 = new THREE.Color(0x2f5230), g2 = new THREE.Color(0x5a7a38);

    // conifers: trunk + 3 canopy tiers
    const tierGeos = [
      new THREE.ConeGeometry(2.6, 3.4, 7),
      new THREE.ConeGeometry(1.9, 2.9, 7),
      new THREE.ConeGeometry(1.2, 2.5, 6),
    ];
    const trunksC = new THREE.InstancedMesh(trunkGeo, trunkMat, conf.length);
    const tiers = tierGeos.map(tg => new THREE.InstancedMesh(tg, leafMat, conf.length));
    trunksC.castShadow = true;
    tiers.forEach(t => { t.castShadow = true; });
    conf.forEach(([x, h, z], i) => {
      const s = 0.8 + Math.random() * 0.8;
      q.setFromAxisAngle(up, Math.random() * Math.PI * 2);
      scl.set(s, s, s);
      pos.set(x, h + 1.6 * s, z);
      m.compose(pos, q, scl);
      trunksC.setMatrixAt(i, m);
      const treeCol = col.lerpColors(g1, g2, Math.random());
      let y = h + 3.6 * s;
      for (let t = 0; t < 3; t++) {
        pos.y = y;
        m.compose(pos, q, scl);
        tiers[t].setMatrixAt(i, m);
        tiers[t].setColorAt(i, col.copy(treeCol).multiplyScalar(0.88 + t * 0.1));
        y += (t === 0 ? 2.3 : 2.0) * s;
      }
    });

    // broadleaf: trunk + squashed blob canopy
    const blobGeo = new THREE.IcosahedronGeometry(2.4, 1);
    const trunksB = new THREE.InstancedMesh(trunkGeo, trunkMat, broad.length);
    const blobs = new THREE.InstancedMesh(blobGeo, leafMat, broad.length);
    trunksB.castShadow = blobs.castShadow = true;
    const b1 = new THREE.Color(0x4a7030), b2 = new THREE.Color(0x7a9440);
    broad.forEach(([x, h, z], i) => {
      const s = 0.8 + Math.random() * 0.7;
      q.setFromAxisAngle(up, Math.random() * Math.PI * 2);
      scl.set(s, s, s);
      pos.set(x, h + 1.6 * s, z);
      m.compose(pos, q, scl);
      trunksB.setMatrixAt(i, m);
      scl.set(s * 1.15, s * 0.78, s * 1.15);
      pos.y = h + 4.6 * s;
      m.compose(pos, q, scl);
      blobs.setMatrixAt(i, m);
      blobs.setColorAt(i, col.lerpColors(b1, b2, Math.random()));
    });

    for (const im of [trunksC, ...tiers, trunksB, blobs]) {
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      this.scene.add(im);
    }
  }

  /* ---------------- noise-displaced rocks ---------------- */
  buildRocks() {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const p = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = Noise.fbm2(v.x * 1.3 + 5, v.z * 1.3 + v.y + 2, 3);
      v.multiplyScalar(1 + (n - 0.5) * 0.9);
      p.setXYZ(i, v.x, v.y * 0.7, v.z);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b625a, roughness: 1, metalness: 0 });

    const spots = [];
    for (const isl of WORLD.islands) {
      const want = isl.r > 300 ? 70 : 15;
      let placed = 0, tries = 0;
      while (placed < want && tries++ < want * 20) {
        const a = Math.random() * Math.PI * 2;
        const rr = isl.r * (0.55 + Math.random() * 0.5);
        const x = isl.x + Math.cos(a) * rr, z = isl.z + Math.sin(a) * rr;
        const h = terrainHeight(x, z);
        const e = 5;
        const slope = Math.hypot(terrainHeight(x + e, z) - h, terrainHeight(x, z + e) - h) / e;
        const coastal = h > -2.5 && h < 3;
        const steep = slope > 0.55 && h > 8 && h < 220;
        if (!coastal && !steep) continue;
        spots.push([x, h, z]);
        placed++;
      }
    }
    const rocks = new THREE.InstancedMesh(geo, mat, spots.length);
    rocks.castShadow = rocks.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(),
          pos = new THREE.Vector3(), scl = new THREE.Vector3(), eul = new THREE.Euler();
    spots.forEach(([x, h, z], i) => {
      eul.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      q.setFromEuler(eul);
      const s = 0.6 + Math.random() * 2.8;
      scl.set(s * (0.7 + Math.random() * 0.7), s * (0.5 + Math.random() * 0.5), s * (0.7 + Math.random() * 0.7));
      pos.set(x, h + s * 0.1, z);
      m.compose(pos, q, scl);
      rocks.setMatrixAt(i, m);
    });
    this.scene.add(rocks);
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
    // a little wooden cog: flared hull, stern/bow castles, curved sail, rigging
    const g = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, color: 0x9a7850, map: makeWoodTexture() });
    const trimMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, color: 0x3a2a1c });

    const add = (mesh, x, y, z) => {
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };

    add(new THREE.Mesh(new THREE.BoxGeometry(13, 2.2, 4.2), hullMat), 0, 0.4, 0);      // lower hull
    add(new THREE.Mesh(new THREE.BoxGeometry(12, 1.6, 5.0), hullMat), -0.2, 2.2, 0);   // flared upper hull
    add(new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.6, 4.4), hullMat), 6.0, 2.4, 0);   // bow castle
    add(new THREE.Mesh(new THREE.BoxGeometry(4.2, 3.4, 4.8), hullMat), -5.2, 3.0, 0);  // stern castle
    add(new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.4, 5.2), trimMat), -5.2, 4.9, 0);  // castle roof

    const sprit = add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 5, 5), trimMat), 8.4, 3.4, 0);
    sprit.rotation.z = -1.2;                                                            // bowsprit

    add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 13, 6), trimMat), 0.5, 7.5, 0);  // mast
    const yard = add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 7.6, 5), trimMat), 0.5, 12.2, 0);
    yard.rotation.x = Math.PI / 2;                                                      // yard arm

    // wind-filled sail (belly curved)
    const sailGeo = new THREE.PlaneGeometry(6.8, 6.4, 6, 5);
    const sp = sailGeo.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i);
      sp.setZ(i, (1 - Math.pow(x / 3.4, 2)) * 0.9);
    }
    sailGeo.computeVertexNormals();
    const sail = add(new THREE.Mesh(sailGeo,
      new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, map: makeSailTexture(), side: THREE.DoubleSide })),
      0.5, 8.8, 0.2);
    sail.rotation.y = Math.PI / 2;

    // rigging
    const rig = (ax, ay, bx, by) => {
      const a = new THREE.Vector3(ax, ay, 0), b = new THREE.Vector3(bx, by, 0);
      const dir = new THREE.Vector3().subVectors(b, a);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, dir.length(), 3), trimMat);
      m.position.copy(a).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      g.add(m);
    };
    rig(0.5, 13.6, 7.6, 3.2);
    rig(0.5, 13.6, -6.6, 5.0);

    // pennant
    const flag = add(new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x1e5a3c, side: THREE.DoubleSide })), 0.5, 14.0, 0.9);
    flag.rotation.y = 0.3;

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
