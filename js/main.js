'use strict';
/* global THREE, World, WORLD, terrainHeight, Dragon, ParticlePool, SoundEngine */

(() => {

/* ---------------- renderer / scene ---------------- */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.75;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xb08458, 0.00045);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 12000);

/* post-processing: bloom makes the fire, lava, sun and sea-glints glow */
const composer = new THREE.EffectComposer(renderer);
composer.addPass(new THREE.RenderPass(scene, camera));
const bloomPass = new THREE.UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.38, 0.4, 0.95);
composer.addPass(bloomPass);

const world = new World(scene);

/* HDRI sky: real photo environment + image-based lighting (falls back to
   procedural sky if the HDR can't load) */
new THREE.RGBELoader().load(ASSET_SKY_HDR, hdrTex => {
  hdrTex.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(hdrTex).texture;
  scene.background = hdrTex;
  pmrem.dispose();
  world.skyMesh.visible = false;
  if (world.sunGlow) world.sunGlow.visible = false;
});

/* crisp texture sampling at grazing angles */
const maxAniso = renderer.capabilities.getMaxAnisotropy();
for (const t of world.terrainTex || []) t.anisotropy = maxAniso;
let dragon = new ModelDragon(scene, 'vhagar');
const aiDragon = new ModelDragon(scene, 'syrax', 0xb8c8d8);   // Seasmoke circling the Dragonmont
aiDragon.group.scale.setScalar(0.8);

const firePool = new ParticlePool(scene, 700, true);    // additive flames
const smokePool = new ParticlePool(scene, 600, false);  // gray smoke

const sound = new SoundEngine();

/* mouth light (only lit while breathing fire) */
const mouthLight = new THREE.PointLight(0xff7a2a, 0, 70, 2);
scene.add(mouthLight);

/* ---------------- DOM refs ---------------- */
const el = id => document.getElementById(id);
const hudSpeed = el('hud-speed'), hudAlt = el('hud-alt'), hudScore = el('hud-score'),
      hudDeaths = el('hud-deaths'), heatFill = el('heat-fill'), toastEl = el('toast'),
      menu = el('menu'), pauseEl = el('pause'), flash = el('flash'),
      crosshair = el('crosshair');

let toastTimer = 0;
function toast(msg, dur = 3.2) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), dur * 1000);
}

/* ---------------- game state ---------------- */
const SPAWN = new THREE.Vector3(-600, 260, -600);
const SPAWN_YAW = Math.atan2(1020, 180);   // facing the fleet in Blackwater Bay (clear of the Dragonmont)

const state = {
  started: false,
  paused: false,
  pos: SPAWN.clone(),
  yaw: SPAWN_YAW, pitch: 0, roll: 0,
  speed: 50, targetSpeed: 50,
  heat: 100, heatDelay: 0,
  firing: false,
  invulnT: 0,
  score: 0, deaths: 0,
  boundsWarnT: 0, stallWarnT: 0,
  roarCd: 0,
  fleetRespawnT: -1,
  fireAcc: 0, brazierAcc: 0, volcanoAcc: 0, emberAcc: 0,
  aiAngle: 0,
};

const input = { mx: 0, my: 0, keys: {}, lmb: false };

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(),
      _v4 = new THREE.Vector3(), _fv1 = new THREE.Vector3(), _fv2 = new THREE.Vector3(),
      _mouth = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

function lockPointer() {
  try {
    const p = document.body.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  } catch (err) { /* re-lock cooldown after ESC */ }
}

function angleDelta(a, b) { return Math.atan2(Math.sin(b - a), Math.cos(b - a)); }

/* ---------------- input ---------------- */
document.addEventListener('keydown', e => {
  if (e.repeat) return;
  input.keys[e.code] = true;
  if (e.code === 'KeyM') {
    const muted = sound.toggleMute();
    toast(muted ? 'Sound off' : 'Sound on', 1.5);
  }
  if (e.code === 'KeyB' && state.started && !state.paused && state.roarCd <= 0) {
    sound.roar();
    state.roarCd = 3;
  }
  if (e.code === 'Space') e.preventDefault();
});
document.addEventListener('keyup', e => { input.keys[e.code] = false; });
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== document.body) return;
  input.mx = Math.max(-1, Math.min(1, input.mx + e.movementX * 0.0022));
  input.my = Math.max(-1, Math.min(1, input.my + e.movementY * 0.0022));
});
document.addEventListener('mousedown', e => {
  if (document.pointerLockElement === document.body && e.button === 0) input.lmb = true;
});
document.addEventListener('mouseup', e => { if (e.button === 0) input.lmb = false; });
document.addEventListener('contextmenu', e => e.preventDefault());

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === document.body;
  if (!locked && state.started) {
    state.paused = true;
    pauseEl.classList.add('visible');
    document.body.classList.remove('playing');
    sound.setFire(false);
  } else if (locked) {
    state.paused = false;
    pauseEl.classList.remove('visible');
    if (state.started) document.body.classList.add('playing');
  }
});
pauseEl.addEventListener('click', lockPointer);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

/* ---------------- menu / start ---------------- */
document.querySelectorAll('.dragon-card').forEach(card => {
  card.addEventListener('click', () => {
    scene.remove(dragon.group);
    dragon = new ModelDragon(scene, card.dataset.dragon);
    startGame();
  });
});

function startGame() {
  sound.init();
  state.started = true;
  menu.classList.add('hidden');
  document.body.classList.add('playing');
  lockPointer();
  sound.roar();
  toast('Fly, rider. Hold SPACE — dracarys.', 5);
}

/* ---------------- crash / respawn ---------------- */
function crash(msg) {
  state.deaths++;
  flash.style.opacity = 0.85;
  setTimeout(() => { flash.style.opacity = 0; }, 130);
  sound.roar();
  toast(msg, 3.5);
  state.pos.copy(SPAWN);
  state.yaw = SPAWN_YAW;
  state.pitch = 0; state.roll = 0;
  state.speed = 50; state.targetSpeed = 50;
  state.invulnT = 2.5;
  input.mx = input.my = 0;
}

/* ---------------- fire breath ---------------- */
const FIRE_C0 = [1.0, 0.82, 0.45];   // white-hot orange
const FIRE_C1 = [0.55, 0.10, 0.02];  // dying ember
const SMOKE_C0 = [0.28, 0.26, 0.25];
const SMOKE_C1 = [0.05, 0.05, 0.05];

function spawnFireBreath(dt, mouth, dir, dragonVel) {
  state.fireAcc += dt * 300;
  while (state.fireAcc >= 1) {
    state.fireAcc -= 1;
    _fv1.set((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(5.5);
    const spread = _fv2.copy(dir).multiplyScalar(56 + Math.random() * 16).add(_fv1);
    firePool.spawn(
      mouth.x + (Math.random() - 0.5) * 0.6,
      mouth.y + (Math.random() - 0.5) * 0.6,
      mouth.z + (Math.random() - 0.5) * 0.6,
      spread.x + dragonVel.x * 0.45,
      spread.y + dragonVel.y * 0.45,
      spread.z + dragonVel.z * 0.45,
      0.5 + Math.random() * 0.45,          // life
      2.2 + Math.random() * 1.6,           // size
      9,                                    // grow
      FIRE_C0, FIRE_C1,
      0.85, 1.6, 11                         // alpha, drag, buoyancy
    );
  }
}

function spawnFlameAt(p, scale, dt, acc) {
  // returns new accumulator value
  acc += dt * 40;
  while (acc >= 1) {
    acc -= 1;
    firePool.spawn(
      p.x + (Math.random() - 0.5) * 4 * scale,
      p.y + Math.random() * 2,
      p.z + (Math.random() - 0.5) * 4 * scale,
      (Math.random() - 0.5) * 2, 4 + Math.random() * 4, (Math.random() - 0.5) * 2,
      0.4 + Math.random() * 0.35,
      1.6 * scale, 7 * scale,
      FIRE_C0, FIRE_C1, 0.85, 1.2, 6
    );
  }
  return acc;
}

function spawnSmokeAt(p, rate, size, dt, acc, wind) {
  acc += dt * rate;
  while (acc >= 1) {
    acc -= 1;
    smokePool.spawn(
      p.x + (Math.random() - 0.5) * size * 0.5,
      p.y + Math.random() * 2,
      p.z + (Math.random() - 0.5) * size * 0.5,
      (wind ? world.wind.x : 0) + (Math.random() - 0.5) * 2,
      3 + Math.random() * 3,
      (wind ? world.wind.z : 0) + (Math.random() - 0.5) * 2,
      2.5 + Math.random() * 2.5,
      size, size * 1.2,
      SMOKE_C0, SMOKE_C1, 0.32, 0.4, 2.5
    );
  }
  return acc;
}

/* ---------------- per-frame: flight ---------------- */
function updateFlight(dt) {
  // self-centering stick
  input.mx *= Math.exp(-dt * 1.8);
  input.my *= Math.exp(-dt * 1.8);
  if (input.keys.ArrowLeft)  input.mx = Math.max(-1, input.mx - dt * 2.5);
  if (input.keys.ArrowRight) input.mx = Math.min( 1, input.mx + dt * 2.5);
  if (input.keys.ArrowUp)    input.my = Math.max(-1, input.my - dt * 2.5);
  if (input.keys.ArrowDown)  input.my = Math.min( 1, input.my + dt * 2.5);

  // attitude
  const bankTarget = input.mx * 0.9;
  const pitchTarget = -input.my * 0.75;
  state.roll += (bankTarget - state.roll) * Math.min(1, dt * 5);
  state.pitch += (pitchTarget - state.pitch) * Math.min(1, dt * 4);
  state.yaw += state.roll * 1.35 * dt;

  // throttle
  if (input.keys.KeyW) state.targetSpeed = Math.min(90, state.targetSpeed + 40 * dt);
  if (input.keys.KeyS) state.targetSpeed = Math.max(16, state.targetSpeed - 40 * dt);
  const boost = !!input.keys.ShiftLeft || !!input.keys.ShiftRight;
  const target = boost ? state.targetSpeed * 1.55 : state.targetSpeed;
  state.speed += (target - state.speed) * Math.min(1, dt * 0.9);
  state.speed += -Math.sin(state.pitch) * 26 * dt;      // dives accelerate, climbs bleed
  state.speed = Math.max(10, Math.min(140, state.speed));

  // stall
  if (state.speed < 18) {
    state.pitch -= 0.5 * dt;
    if (state.stallWarnT <= 0) { toast('Stalling — dive to regain speed!', 2); state.stallWarnT = 5; }
  }
  state.stallWarnT -= dt;

  // orientation & velocity
  _e.set(-state.pitch, state.yaw, -state.roll, 'YXZ');
  _q.setFromEuler(_e);
  dragon.group.quaternion.copy(_q);
  const forward = _v3.set(0, 0, 1).applyQuaternion(_q);
  state.pos.addScaledVector(forward, state.speed * dt);

  // soft ceiling
  if (state.pos.y > 800) state.pos.y = 800;

  // world bounds — nudge back toward the bay
  const rr = Math.hypot(state.pos.x, state.pos.z);
  if (rr > 2050) {
    const home = Math.atan2(-state.pos.x, -state.pos.z);
    state.yaw += angleDelta(state.yaw, home) * Math.min(1, dt * 0.9);
    if (state.boundsWarnT <= 0) { toast('Turn back — the open sea is death.', 2.5); state.boundsWarnT = 6; }
    if (rr > WORLD.bounds) {
      const k = WORLD.bounds / rr;
      state.pos.x *= k; state.pos.z *= k;
    }
  }
  state.boundsWarnT -= dt;

  // collisions
  if (state.invulnT > 0) state.invulnT -= dt;
  else {
    const ground = terrainHeight(state.pos.x, state.pos.z);
    if (state.pos.y < ground + 2.4) return crash('You met the earth. The dragon remembers.');
    if (state.pos.y < 1.4) return crash('The sea claims another rider.');
  }

  dragon.group.position.copy(state.pos);
  dragon.group.updateMatrixWorld();   // mouth emitter uses fresh transforms this frame

  // heat / fire
  const wantFire = (input.keys.Space || input.lmb) && state.heat > 0.5;
  state.firing = wantFire;
  if (state.firing) {
    state.heat = Math.max(0, state.heat - 24 * dt);
    state.heatDelay = 0.8;
  } else {
    state.heatDelay -= dt;
    if (state.heatDelay <= 0) state.heat = Math.min(100, state.heat + 15 * dt);
  }
  state.roarCd -= dt;
}

/* ---------------- per-frame: fire & burning ships ---------------- */
function updateFire(dt) {
  _e.set(-state.pitch, state.yaw, 0, 'YXZ');
  const fwd = _v2.set(0, 0, 1).applyQuaternion(_q.setFromEuler(_e));
  const vel = _v3.copy(fwd).multiplyScalar(state.speed);
  const mouth = dragon.mouthWorld(_mouth);

  if (state.firing) {
    // aim from the mouth toward the crosshair point
    const aimDir = _v1.copy(camera.position)
      .addScaledVector(camera.getWorldDirection(_v2), 150)
      .sub(mouth).normalize();

    spawnFireBreath(dt, mouth, aimDir, vel);

    mouthLight.position.copy(mouth);
    mouthLight.intensity = 2.4 + Math.sin(world.t * 40) * 0.7 + Math.random() * 0.4;

    // ignite ships caught in the cone
    for (const s of world.ships) {
      if (s.state !== 'sailing') continue;
      const to = s.group.position.clone().sub(mouth);
      const d = to.length();
      const ang = aimDir.angleTo(to.normalize());
      if (DEBUG && s === world.ships[0]) {
        if (d < (window.__minD || 1e9)) window.__minD = d;
        if (ang < (window.__minA || 1e9)) window.__minA = ang;
      }
      if (d < 150 && ang < 0.3) {
        s.state = 'burning';
        s.burnT = 0;
        sound.ignite();
        toast('Dracarys.', 1.6);
      }
    }
  } else {
    mouthLight.intensity = 0;
  }
  sound.setFire(state.firing);

  // burning / sinking ships
  let allGone = true;
  for (const s of world.ships) {
    if (s.state === 'sailing') { allGone = false; continue; }
    if (s.state === 'gone') continue;
    allGone = false;
    if (s.state === 'burning') {
      s.burnT += dt;
      const p = s.group.position;
      p.y = Math.max(p.y - dt * 0.3, -1.5);
      s.flameAcc = spawnFlameAt(p, 1.4, dt, s.flameAcc);
      s.smokeAcc = spawnSmokeAt(p, 14, 4, dt, s.smokeAcc, true);
      if (s.burnT > 4.5) {
        s.state = 'sinking';
        state.score++;
        toast(`${state.score} ${state.score === 1 ? 'ship' : 'ships'} sent to the depths.`, 2.2);
      }
    } else if (s.state === 'sinking') {
      s.smokeAcc = spawnSmokeAt(s.group.position, 6, 3, dt, s.smokeAcc, true);
    }
  }

  // fleet respawn
  if (allGone) {
    if (state.fleetRespawnT < 0) {
      state.fleetRespawnT = 22;
      toast('The bay is quiet… for now.', 4);
    } else {
      state.fleetRespawnT -= dt;
      if (state.fleetRespawnT <= 0) {
        world.resetShips();
        state.fleetRespawnT = -1;
        toast('A new fleet dares Blackwater Bay.', 3.5);
      }
    }
  }

  // braziers on the castle towers
  for (const b of world.braziers) {
    state.brazierAcc = spawnFlameAt(b, 0.55, dt, state.brazierAcc);
  }

  // volcano smoke column + embers
  state.volcanoAcc = spawnSmokeAt(world.craterPos, 9, 14, dt, state.volcanoAcc, true);
  state.emberAcc += dt * 6;
  while (state.emberAcc >= 1) {
    state.emberAcc -= 1;
    const c = world.craterPos;
    firePool.spawn(
      c.x + (Math.random() - 0.5) * 40, c.y, c.z + (Math.random() - 0.5) * 40,
      (Math.random() - 0.5) * 6, 8 + Math.random() * 8, (Math.random() - 0.5) * 6,
      1.5 + Math.random() * 1.5, 2.5, 3,
      [1, 0.6, 0.15], [0.5, 0.08, 0.02], 0.8, 0.6, -4
    );
  }
}

/* ---------------- per-frame: camera ---------------- */
const camPos = new THREE.Vector3().copy(SPAWN).add(new THREE.Vector3(-10, 6, -20));
function updateCamera(dt) {
  const back = _v1.set(0, 0, -1).applyQuaternion(dragon.group.quaternion);
  const up = _v2.set(0, 1, 0).applyQuaternion(dragon.group.quaternion);
  const desired = _v3.copy(state.pos).addScaledVector(back, 11).addScaledVector(up, 3.4);
  camPos.lerp(desired, 1 - Math.exp(-dt * 6));

  // keep the camera out of the ground
  const ground = terrainHeight(camPos.x, camPos.z);
  if (camPos.y < ground + 1.6) camPos.y = ground + 1.6;

  camera.position.copy(camPos);
  const look = _v4.copy(state.pos).addScaledVector(back, -14).addScaledVector(up, 1.2);
  camera.lookAt(look);

  const boost = !!input.keys.ShiftLeft || !!input.keys.ShiftRight;
  const fovT = boost ? 78 : 62;
  if (Math.abs(camera.fov - fovT) > 0.1) {
    camera.fov += (fovT - camera.fov) * Math.min(1, dt * 5);
    camera.updateProjectionMatrix();
  }
}

/* ---------------- AI dragon circling the volcano ---------------- */
function updateAiDragon(dt) {
  state.aiAngle += dt * 0.09;
  const a = state.aiAngle;
  const c = WORLD.volcano;
  aiDragon.group.position.set(
    c.x + Math.cos(a) * 430,
    300 + Math.sin(a * 2.3) * 25,
    c.z + Math.sin(a) * 430
  );
  aiDragon.group.rotation.set(0, -a, -0.18, 'YXZ');
  aiDragon.update(dt, { speed: 55, pitch: 0, roll: 0.18, firing: false, boost: false, t: world.t });
}

/* ---------------- HUD ---------------- */
let lastHud = {};
function updateHud() {
  const vals = {
    speed: Math.round(state.speed * 3.6),
    alt: Math.round(Math.max(0, state.pos.y)),
    score: state.score,
    deaths: state.deaths,
  };
  if (vals.speed !== lastHud.speed) hudSpeed.textContent = vals.speed + ' km/h';
  if (vals.alt !== lastHud.alt) hudAlt.textContent = vals.alt + ' m';
  if (vals.score !== lastHud.score) hudScore.textContent = vals.score;
  if (vals.deaths !== lastHud.deaths) hudDeaths.textContent = vals.deaths;
  lastHud = vals;
  heatFill.style.width = state.heat.toFixed(1) + '%';
  crosshair.classList.toggle('firing', state.firing);
}

/* ---------------- menu backdrop camera ---------------- */
function updateMenuCamera() {
  const t = world.t * 0.06 - 2.16;   // start on the sunlit side of the Dragonmont
  const c = WORLD.volcano;
  camera.position.set(
    c.x + Math.cos(t) * 620,
    260,
    c.z + Math.sin(t) * 620
  );
  camera.lookAt(c.x, 120, c.z);
}

/* ---------------- main loop ---------------- */
const clock = new THREE.Clock();

const DEBUG = new URLSearchParams(location.search).get('debug');
let debugEl = null, debugT = 0;
if (DEBUG) {
  debugEl = document.createElement('div');
  debugEl.id = 'debug';
  debugEl.style.cssText = 'position:fixed;top:38%;left:12px;z-index:99;font:16px monospace;' +
    'color:#0f0;background:rgba(0,0,0,.85);padding:8px;white-space:pre;';
  document.body.appendChild(debugEl);
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (state.started && !state.paused) {
    updateFlight(dt);
    dragon.update(dt, {
      speed: state.speed, pitch: state.pitch, roll: state.roll,
      firing: state.firing, boost: !!input.keys.ShiftLeft || !!input.keys.ShiftRight,
      t: world.t,
    });
    updateFire(dt);
    updateCamera(dt);
    updateHud();
    sound.setWind(Math.min(1, state.speed / 120));
  } else if (!state.started) {
    updateMenuCamera();
    // idle animation for the parked player dragon
  dragon.group.position.copy(state.pos);
  dragon.group.updateMatrixWorld();   // mouth emitter uses fresh transforms this frame
    dragon.update(dt, { speed: 0, pitch: 0, roll: 0, firing: false, boost: false, t: world.t });
  }

  if (!state.paused) {
    world.update(dt);
    updateAiDragon(dt);
    firePool.update(dt);
    smokePool.update(dt);
  }

  // sun shadows follow the action
  world.sun.position.copy(dragon.group.position).addScaledVector(world.SUN_DIR, 700);
  world.sun.target.position.copy(dragon.group.position);
  world.sun.target.updateMatrixWorld();

  if (DEBUG) {
    debugT += dt;
    if (debugT > 0.5) {
      debugT = 0;
      debugEl.textContent = JSON.stringify({
        t: +world.t.toFixed(1), firing: state.firing, heat: Math.round(state.heat),
        fire: firePool.count, smoke: smokePool.count,
        pos: state.pos.toArray().map(v => Math.round(v)),
        started: state.started, paused: state.paused,
        dready: dragon.ready,
        dsize: dragon.size ? [dragon.size.x, dragon.size.y, dragon.size.z].map(v => +v.toFixed(1)) : null,
        ship0: world.ships[0].state,
        d0: Math.round(state.pos.distanceTo(world.ships[0].group.position)),
        score: state.score,
      });
    }
  }

  composer.render();
}

loop();

/* quick-start: ?auto=caraxes|syrax|vhagar skips the menu (also used for testing) */
const urlParams = new URLSearchParams(location.search);
const autoDragon = urlParams.get('auto');
if (autoDragon) {
  if (DRAGON_DEFS[autoDragon]) {
    scene.remove(dragon.group);
    dragon = new ModelDragon(scene, autoDragon);
  }
  startGame();
  if (urlParams.get('fire')) input.keys.Space = true;   // test: breathe fire continuously

  // test: teleport viewpoint, e.g. ?pos=500,120,150&yaw=82
  if (urlParams.get('pos')) {
    const [px, py, pz] = urlParams.get('pos').split(',').map(Number);
    state.pos.set(px, py, pz);
    if (urlParams.get('yaw')) state.yaw = Number(urlParams.get('yaw')) * Math.PI / 180;
  }

  // test: strafing run over the fleet — low pass across the bay, fire held
  const burnTest = urlParams.get('burn');
  if (burnTest) {
    state.pos.set(330, 60, -300);
    state.yaw = Math.atan2(90, -120);
    input.keys.Space = true;
    // pin one ship on the flight line for a deterministic ignite
    const target = world.ships[0];
    target.group.position.set(430, 0, -420);
    target.state = 'sailing';
  }

  // test hook: synchronously simulate N seconds before the first render
  const warp = parseFloat(urlParams.get('warp') || '0');
  const doWarp = () => {
    for (let i = 0; i < warp * 20; i++) {
      if (burnTest) input.my = 0.3;   // hold the dive through the decay
      updateFlight(0.05);
      dragon.update(0.05, {
        speed: state.speed, pitch: state.pitch, roll: state.roll,
        firing: state.firing, boost: false, t: world.t,
      });
      updateFire(0.05);
      updateCamera(0.05);
      world.update(0.05);
      updateAiDragon(0.05);
      firePool.update(0.05);
      smokePool.update(0.05);
    }
    updateHud();
    if (DEBUG && debugEl) {
      debugEl.textContent = JSON.stringify({
        dready: dragon.ready, diag: dragon.diag,
        bones: [!!dragon.spineBone, !!dragon.headBone, !!dragon.fireBone],
        rider: dragon.rider ? dragon.rider.position.toArray().map(v => +v.toFixed(1)) : null,
        warped: warp, firing: state.firing, heat: Math.round(state.heat),
        fire: firePool.count, pos: state.pos.toArray().map(v => Math.round(v)),
        ship0: world.ships[0].state,
        d0: Math.round(state.pos.distanceTo(world.ships[0].group.position)),
        minD: Math.round(window.__minD || -1), minA: +(window.__minA || -1).toFixed(2),
        ship0pos: world.ships[0].group.position.toArray().map(v => Math.round(v)),
        score: state.score, deaths: state.deaths,
      });
    }

    // test: side-view camera so the fire cone is visible in screenshots
    const sideDist = parseFloat(urlParams.get('side') || '0');
    if (sideDist) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(dragon.group.quaternion);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(dragon.group.quaternion);
      camPos.copy(state.pos).addScaledVector(right, sideDist)
        .addScaledVector(fwd, sideDist * (urlParams.get('front') ? 0.9 : 0.35))
        .add(new THREE.Vector3(0, sideDist * 0.18, 0));
    }
  };

  // the dragon GLB loads async — wait for it before warping
  if (warp > 0) {
    if (dragon.ready) doWarp();
    else {
      const waitReady = setInterval(() => {
        if (dragon.ready) { clearInterval(waitReady); doWarp(); }
      }, 50);
    }
  }
}

})();
