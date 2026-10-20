/**
 * Órbita Rush — motor do jogo (three.js + WebAudio + Discord).
 *
 * Código-fonte legível (substitui o bundle minificado antigo).
 * Sistemas: power-ups, combo, ondas, conquistas, ranking local e
 * integração com o Discord (Embedded App SDK / Social SDK) usando a
 * linha de prova ?proof=c7396932d0aee5ce no convite.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ════════════════════════════════════════════════════════════════
   CONFIGURAÇÃO
   ════════════════════════════════════════════════════════════════ */

const CONFIG = {
  // Application ID do teu app no Discord Developer Portal.
  // Deixa vazio para jogar só no navegador (o badge mostra o estado).
  clientId: '1551238667492790352',
  // Convite do teu servidor Discord. O ?proof= é anexado automaticamente.
  invite: 'https://discord.gg/9apTx4xyJQ',
  // ✅ Linha de prova do Discord Social SDK (Claim Your Game / Game Identity)
  proof: 'c7396932d0aee5ce',
  // ID do servidor (guild) — quem fizer login e for membro ganha a skin dourada.
  guildId: '1501482046693052466',
};

// A prova também pode chegar na URL (?proof=...) — nesse caso, usa a recebida.
const PROOF = new URLSearchParams(window.location.search).get('proof') || CONFIG.proof;
const INVITE_URL = `${CONFIG.invite}${CONFIG.invite.includes('?') ? '&' : '?'}proof=${PROOF}`;

/* ── Constantes de jogo (as mesmas do jogo original) ── */
const SHIP_Z = 6;
const SPAWN_Z = -170;
const DESPAWN_Z = 26;
const VEL_X = 17;
const VEL_Y = 12;
const INVULN_TIME = 2.2;

const COLOR_ORB = 4911296;        // #4af0c0
const COLOR_GATE = 16763213;      // #ffc94d
const COLOR_HIT = 16729190;       // #ff4466
const COLOR_GLOW = 5760767;       // #57e6ff
const COLOR_ASTEROID = 7173768;

const WAVE_NAMES = [
  'Órbita Baixa', 'Cinturão de Íons', 'Nebulosa Rosa',
  'Corredor Dourado', 'Tempestade Solar', 'Vazio Profundo',
];
const WAVE_COLORS = [0x04060c, 0x0a1026, 0x1a0f2e, 0x241505, 0x2c0a12, 0x041018];

const POWERUPS = {
  shield: { nome: 'Escudo', cor: 0x4af0c0 },
  slow: { nome: 'Câmera lenta', cor: 0x57e6ff },
  x2: { nome: 'Pontos ×2', cor: 0xffc94d },
  magnet: { nome: 'Ímã de orbes', cor: 0xff4466 },
};

const ACHIEVEMENTS = {
  decolar: { nome: 'Primeiro voo', desc: 'Começar uma partida' },
  mil: { nome: '1.000 pontos', desc: 'Chegar a 1.000 pontos numa partida' },
  lenda: { nome: 'Lenda da órbita', desc: 'Chegar a 5.000 pontos numa partida' },
  sobrevivente: { nome: 'Sobrevivente', desc: 'Ficar 60 segundos vivo' },
  velocista: { nome: 'Velocista', desc: 'Atingir velocidade 60' },
  combo5: { nome: 'Combo mestre', desc: 'Alcançar combo ×5' },
  colecionador: { nome: 'Colecionador', desc: 'Apanhar 50 orbe(s) no total' },
  porteiro: { nome: 'Porteiro dourado', desc: 'Atravessar 10 portão(ões)' },
  power10: { nome: 'Energia pura', desc: 'Apanhar 10 power-up(s)' },
  blindado: { nome: 'Blindado', desc: 'Guardar 2 escudos ao mesmo tempo' },
};

/* ════════════════════════════════════════════════════════════════
   PERSISTÊNCIA (localStorage) — o recorde agora sobrevive a reloads
   ════════════════════════════════════════════════════════════════ */

const STORE_KEY = 'orbita-rush/v1';
const DEFAULTS = {
  best: 0,
  muted: false,
  top: [],
  totals: { orbs: 0, gates: 0, powerups: 0, runs: 0 },
  ach: {},
};

function loadStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return {
      ...DEFAULTS,
      ...raw,
      totals: { ...DEFAULTS.totals, ...(raw.totals || {}) },
      ach: { ...DEFAULTS.ach, ...(raw.ach || {}) },
      top: Array.isArray(raw.top) ? raw.top : [],
    };
  } catch {
    return { ...DEFAULTS, totals: { ...DEFAULTS.totals }, ach: {}, top: [] };
  }
}

function saveStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* modo privado / storage cheio — o jogo continua, só não guarda */
  }
}

const store = loadStore();

/* ════════════════════════════════════════════════════════════════
   ÁUDIO (sintetizado com WebAudio — sem ficheiros)
   ════════════════════════════════════════════════════════════════ */

const MUSIC_SCALE = [220, 261.63, 293.66, 329.63, 392, 440, 523.25];

class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.echo = null;
    this.muted = store.muted;
    this.musicOn = false;
    this._noiseBuffer = null;
  }

  unlock() {
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);
    const size = Math.floor(this.ctx.sampleRate * 0.4);
    this._noiseBuffer = this.ctx.createBuffer(1, size, this.ctx.sampleRate);
    const data = this._noiseBuffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
  }

  toggleMute() {
    this.muted = !this.muted;
    store.muted = this.muted;
    saveStore();
    if (this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.03);
    }
    return this.muted;
  }

  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.master);

    this.echo = this.ctx.createDelay(1);
    this.echo.delayTime.value = 0.34;
    const feedback = this.ctx.createGain();
    feedback.gain.value = 0.36;
    this.echo.connect(feedback).connect(this.echo);
    this.echo.connect(this.musicGain);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 240;
    filter.Q.value = 0.8;

    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();

    for (const [freq, detune] of [[55, -7], [82.41, 5]]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.32;
      osc.connect(gain).connect(filter);
      osc.start();
    }
    filter.connect(this.musicGain);

    this._nextNote = this.ctx.currentTime + 0.4;
    this._step = 0;
    const tick = () => {
      if (!this.ctx || this.muted) return;
      while (this._nextNote < this.ctx.currentTime + 0.6) {
        const when = Math.max(this._nextNote, this.ctx.currentTime);
        const nota = MUSIC_SCALE[(this._step + (Math.random() * 3 | 0)) % MUSIC_SCALE.length];
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = nota;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(0.22, when + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, when + 1.1);
        osc.connect(gain).connect(this.musicGain);
        gain.connect(this.echo);
        osc.start(when);
        osc.stop(when + 1.2);
        this._step = (this._step + 1) % MUSIC_SCALE.length;
        this._nextNote += 0.42 + Math.random() * 0.18;
      }
    };
    this._musicTimer = setInterval(tick, 200);
  }

  _blip(freq, endFreq, dur, type = 'sine', vol = 0.25, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  playPickup() {
    this._blip(660, 990, 0.12, 'sine', 0.22);
    this._blip(990, 1320, 0.1, 'sine', 0.12, 0.06);
  }

  playGate() {
    [523, 659, 784].forEach((f, i) => this._blip(f, f * 1.01, 0.14, 'triangle', 0.2, i * 0.07));
  }

  playPower() {
    [392, 523, 659, 880].forEach((f, i) => this._blip(f, f * 1.02, 0.12, 'triangle', 0.2, i * 0.05));
  }

  playShield() {
    this._blip(880, 220, 0.25, 'square', 0.16);
  }

  playAchieve() {
    [523, 659, 784, 1046].forEach((f, i) => this._blip(f, f * 1.01, 0.16, 'triangle', 0.18, i * 0.09));
  }

  playHit() {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, t0);
    filter.frequency.exponentialRampToValueAtTime(120, t0 + 0.3);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.5, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
    noise.connect(filter).connect(gain).connect(this.master);
    noise.start(t0);
    this._blip(120, 45, 0.3, 'sine', 0.5);
  }

  playGameOver() {
    this._blip(300, 60, 0.9, 'sawtooth', 0.28);
    this._blip(200, 50, 1.1, 'triangle', 0.2, 0.1);
  }

  playStart() {
    this._blip(330, 660, 0.18, 'triangle', 0.25);
    this._blip(660, 990, 0.18, 'triangle', 0.2, 0.12);
  }
}

/* ════════════════════════════════════════════════════════════════
   UTILITÁRIOS
   ════════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;

function radialTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}

/* ════════════════════════════════════════════════════════════════
   JOGO
   ════════════════════════════════════════════════════════════════ */

// Geometrias base dos asteroides (5 rochas irregulares, como no original)
const ASTEROID_GEOS = [];
for (let i = 0; i < 5; i++) {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const pos = geo.attributes.position;
  for (let v = 0; v < pos.count; v++) {
    const n = 0.75 + Math.random() * 0.5;
    pos.setXYZ(v, pos.getX(v) * n, pos.getY(v) * n, pos.getZ(v) * n);
  }
  geo.computeVertexNormals();
  ASTEROID_GEOS.push(geo);
}

const MAT_ASTEROID = new THREE.MeshStandardMaterial({
  color: COLOR_ASTEROID, metalness: 0.15, roughness: 0.9, flatShading: true,
});
const ORB_GEO = new THREE.IcosahedronGeometry(0.42, 1);
const MAT_ORB = new THREE.MeshStandardMaterial({
  color: COLOR_ORB, emissive: COLOR_ORB, emissiveIntensity: 2.6, metalness: 0, roughness: 0.3,
});
const GATE_GEO = new THREE.TorusGeometry(2.1, 0.16, 10, 40);
const MAT_GATE = new THREE.MeshStandardMaterial({
  color: COLOR_GATE, emissive: COLOR_GATE, emissiveIntensity: 2.2, metalness: 0.3, roughness: 0.35,
});

function powerupGeometry(tipo) {
  switch (tipo) {
    case 'shield': return new THREE.TorusGeometry(0.55, 0.13, 10, 26);
    case 'slow': return new THREE.OctahedronGeometry(0.6, 0);
    case 'x2': return new THREE.DodecahedronGeometry(0.6, 0);
    default: return new THREE.IcosahedronGeometry(0.6, 0);
  }
}

class Game {
  constructor({ scene, camera, audio, onUi }) {
    this.scene = scene;
    this.camera = camera;
    this.audio = audio;
    this.onUi = onUi;

    this.phase = 'menu';
    this.score = 0;
    this.lives = 3;
    this.elapsed = 0;
    this.speed = 30;
    this.invuln = 0;
    this.shake = 0;
    this.milestone = 0;

    // ── sistemas novos ──
    this.combo = 0;
    this.comboTimer = 0;
    this.shieldCharges = 0;
    this.slowTimer = 0;
    this.x2Timer = 0;
    this.magnetTimer = 0;
    this.wave = 1;
    this.stats = { orbs: 0, gates: 0, powerups: 0, distance: 0 };

    this.keys = new Set();
    this.touch = { active: false, x: 0, y: 0 };
    this.shipPos = new THREE.Vector3(0, 0.6, SHIP_Z);
    this.vel = new THREE.Vector2(0, 0);
    this.orbs = [];
    this.asteroids = [];
    this.gates = [];
    this.powerups = [];
    this.debris = [];
    this.timers = { asteroid: 1.2, orb: 0.6, gate: 6, powerup: 10 };
    this.bounds = { x: 7.6, yMin: -3.8, yMax: 4.8 };

    this.buildShip();
    this.buildStars();
    this.buildNebulas();
    this.buildDebrisPool();
    this.updateBounds();
    this.bindInput();
  }

  /* ── construção da cena ── */

  updateBounds() {
    const cam = this.camera;
    const dist = cam.position.z - SHIP_Z;
    const halfH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * dist;
    const halfW = halfH * cam.aspect;
    const angle = Math.atan2(cam.position.y - 1.1, cam.position.z + 8);
    const baseY = cam.position.y - dist * Math.tan(angle);
    this.bounds.x = Math.max(2.2, halfW - 1.5);
    this.bounds.yMin = Math.max(baseY - halfH + 0.6, -2.4);
    this.bounds.yMax = Math.min(baseY + halfH - 0.6, 4.8);
  }

  buildShip() {
    const ship = new THREE.Group();
    const matBody = new THREE.MeshStandardMaterial({ color: 14674421, metalness: 0.75, roughness: 0.32 });
    const matWing = new THREE.MeshStandardMaterial({ color: 2766408, metalness: 0.6, roughness: 0.45 });
    const matGlow = new THREE.MeshStandardMaterial({
      color: COLOR_GLOW, emissive: COLOR_GLOW, emissiveIntensity: 2.4, metalness: 0, roughness: 0.4,
    });
    this.glowMat = matGlow;

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.52, 2.3, 10), matBody);
    body.rotation.x = -Math.PI / 2;
    ship.add(body);

    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), matGlow);
    dome.position.set(0, 0.22, 0.25);
    ship.add(dome);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.09, 0.8), matWing);
    wing.position.set(-0.75, 0, 0.55);
    wing.rotation.z = 0.22;
    const wing2 = wing.clone();
    wing2.position.x = 0.75;
    wing2.rotation.z = -0.22;
    ship.add(wing, wing2);

    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.7), matWing);
    fin.position.set(0, 0.34, 0.72);
    ship.add(fin);

    const engine = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.9, 8), matGlow);
    engine.rotation.x = Math.PI / 2;
    engine.position.set(0, 0, 1.55);
    ship.add(engine);
    this.engine = engine;

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialTexture(), color: COLOR_GLOW,
      transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.set(3, 3, 1);
    glow.position.set(0, 0, 1.8);
    ship.add(glow);

    ship.position.copy(this.shipPos);
    this.ship = ship;
    this.scene.add(ship);
  }

  buildStars() {
    const count = 1600;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 180;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 110;
      positions[i * 3 + 2] = -220 + Math.random() * 260;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 12570856, size: 0.42, sizeAttenuation: true,
      transparent: true, opacity: 0.9, depthWrite: false,
    });
    this.stars = new THREE.Points(geo, mat);
    this.scene.add(this.stars);
  }

  buildNebulas() {
    const tex = radialTexture();
    const colors = [2833039, 941934, 4008550, 1133148];
    this.nebulas = [];
    for (let i = 0; i < 6; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color: colors[i % colors.length],
        transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      const size = 60 + Math.random() * 80;
      sprite.scale.set(size, size, 1);
      sprite.position.set((Math.random() - 0.5) * 120, (Math.random() - 0.5) * 70, -160 + Math.random() * 120);
      this.scene.add(sprite);
      this.nebulas.push(sprite);
    }
  }

  buildDebrisPool() {
    this.debris = [];
    const geo = new THREE.TetrahedronGeometry(0.16);
    for (let i = 0; i < 48; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: COLOR_GATE }));
      mesh.visible = false;
      this.scene.add(mesh);
      this.debris.push({ mesh, vel: new THREE.Vector3(), life: 0, active: false });
    }
  }

  /* ── entrada ── */

  bindInput() {
    const opts = { signal: undefined };
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's'].includes(k)) {
        this.keys.add(k);
        e.preventDefault();
      }
    }, opts);
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()), opts);
    window.addEventListener('blur', () => this.keys.clear(), opts);

    const app = $('app');
    let origin = null;
    app.addEventListener('pointerdown', (e) => {
      if (this.phase !== 'playing') return;
      origin = { x: e.clientX, y: e.clientY };
      this.touch.active = true;
      app.setPointerCapture?.(e.pointerId);
    }, opts);
    app.addEventListener('pointermove', (e) => {
      if (!origin) return;
      const dx = e.clientX - origin.x;
      const dy = e.clientY - origin.y;
      this.touch.x = clamp(dx / 64, -1, 1);
      this.touch.y = clamp(-dy / 64, -1, 1);
    }, opts);
    const end = () => {
      origin = null;
      this.touch.active = false;
      this.touch.x = 0;
      this.touch.y = 0;
    };
    app.addEventListener('pointerup', end, opts);
    app.addEventListener('pointercancel', end, opts);
  }

  inputDir() {
    let x = 0;
    let y = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) x -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) x += 1;
    if (this.keys.has('arrowup') || this.keys.has('w')) y += 1;
    if (this.keys.has('arrowdown') || this.keys.has('s')) y -= 1;
    x += this.touch.x;
    y += this.touch.y;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  /* ── ciclo de vida ── */

  start() {
    this.resetWorld();
    this.phase = 'playing';
    this.onUi.onScore(this.score, true);
    this.onUi.onLives(this.lives);
    this.onUi.onPowerups(this);
  }

  togglePause() {
    if (this.phase === 'playing') this.phase = 'paused';
    else if (this.phase === 'paused') this.phase = 'playing';
    return this.phase;
  }

  toMenu() {
    this.resetWorld();
    this.phase = 'menu';
    this.onUi.onPowerups(this);
    this.onUi.onCombo(0);
  }

  resetWorld() {
    for (const a of this.asteroids) this.scene.remove(a.mesh);
    for (const o of this.orbs) this.scene.remove(o.mesh);
    for (const g of this.gates) this.scene.remove(g.mesh);
    for (const p of this.powerups) this.scene.remove(p.mesh);
    for (const d of this.debris) { d.active = false; d.mesh.visible = false; }
    this.asteroids.length = 0;
    this.orbs.length = 0;
    this.gates.length = 0;
    this.powerups.length = 0;

    this.score = 0;
    this.lives = 3;
    this.elapsed = 0;
    this.speed = 30;
    this.invuln = 0;
    this.shake = 0;
    this.milestone = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.shieldCharges = 0;
    this.slowTimer = 0;
    this.x2Timer = 0;
    this.magnetTimer = 0;
    this.wave = 1;
    this.stats = { orbs: 0, gates: 0, powerups: 0, distance: 0 };
    this.timers = { asteroid: 1.4, orb: 0.6, gate: 6, powerup: 10 };
    this.shipPos.set(0, 0.6, SHIP_Z);
    this.vel.set(0, 0);
    this.ship.position.copy(this.shipPos);
    this.ship.rotation.set(0, 0, 0);
    this.ship.visible = true;
    this.scene.fog.color.setHex(WAVE_COLORS[0]);
    this.scene.background.setHex(WAVE_COLORS[0]);
  }

  /* ── spawn ── */

  spawnAsteroid() {
    const geo = ASTEROID_GEOS[Math.random() * ASTEROID_GEOS.length | 0];
    const mesh = new THREE.Mesh(geo, MAT_ASTEROID);
    const scale = 0.7 + Math.random() * 1.1;
    mesh.scale.setScalar(scale);
    mesh.position.set(
      (Math.random() - 0.5) * 2 * this.bounds.x,
      this.bounds.yMin + Math.random() * (this.bounds.yMax - this.bounds.yMin),
      SPAWN_Z,
    );
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    this.scene.add(mesh);
    this.asteroids.push({
      mesh, r: scale * 1.05,
      vx: (Math.random() - 0.5) * 3.2,
      vy: (Math.random() - 0.5) * 1.6,
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 1.4,
        (Math.random() - 0.5) * 1.4,
        (Math.random() - 0.5) * 1.4,
      ),
    });
  }

  spawnOrb() {
    const mesh = new THREE.Mesh(ORB_GEO, MAT_ORB);
    mesh.position.set(
      (Math.random() - 0.5) * 2 * (this.bounds.x - 0.6),
      this.bounds.yMin + 0.5 + Math.random() * (this.bounds.yMax - this.bounds.yMin - 1),
      SPAWN_Z,
    );
    this.scene.add(mesh);
    this.orbs.push({ mesh, r: 0.8, baseY: mesh.position.y, t: Math.random() * 6 });
  }

  spawnGate() {
    const mesh = new THREE.Mesh(GATE_GEO, MAT_GATE);
    mesh.position.set(
      (Math.random() - 0.5) * 2 * Math.max(1, this.bounds.x - 2.4),
      this.bounds.yMin + 1.6 + Math.random() * Math.max(0.5, this.bounds.yMax - this.bounds.yMin - 3.2),
      SPAWN_Z,
    );
    this.scene.add(mesh);
    this.gates.push({ mesh });
  }

  spawnPowerup() {
    const tipos = Object.keys(POWERUPS);
    const tipo = tipos[Math.random() * tipos.length | 0];
    const info = POWERUPS[tipo];
    const mat = new THREE.MeshStandardMaterial({
      color: info.cor, emissive: info.cor, emissiveIntensity: 2.2, metalness: 0.3, roughness: 0.35,
    });
    const mesh = new THREE.Mesh(powerupGeometry(tipo), mat);
    mesh.position.set(
      (Math.random() - 0.5) * 2 * (this.bounds.x - 1),
      this.bounds.yMin + 0.8 + Math.random() * Math.max(0.5, this.bounds.yMax - this.bounds.yMin - 1.6),
      SPAWN_Z,
    );
    this.scene.add(mesh);
    this.powerups.push({ mesh, tipo, r: 0.9, baseY: mesh.position.y, t: Math.random() * 6 });
  }

  /* ── partículas ── */

  burst(position, color, count = 14) {
    let made = 0;
    for (const d of this.debris) {
      if (made >= count) break;
      if (d.active) continue;
      d.active = true;
      d.life = 0.7 + Math.random() * 0.4;
      d.mesh.visible = true;
      d.mesh.material.color.setHex(color);
      d.mesh.position.copy(position);
      d.vel.set(
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 10 + 2,
        (Math.random() - 0.5) * 8 + this.speed * 0.4,
      );
      made++;
    }
  }

  updateDebris(dt) {
    for (const d of this.debris) {
      if (!d.active) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.active = false;
        d.mesh.visible = false;
        continue;
      }
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += 6 * dt;
      d.mesh.rotation.y += 5 * dt;
      d.mesh.scale.setScalar(Math.max(0.01, d.life));
    }
  }

  /* ── pontuação e sistemas novos ── */

  multiplier() {
    const comboMult = Math.min(5, 1 + Math.floor(this.combo / 3));
    return comboMult * (this.x2Timer > 0 ? 2 : 1);
  }

  addScore(base) {
    const gained = Math.round(base * this.multiplier());
    this.score += gained;
    return gained;
  }

  registerCollect(pointsBase) {
    this.combo += 1;
    this.comboTimer = 4;
    this.onUi.onCombo(this.multiplier(), this.combo);
    return this.addScore(pointsBase);
  }

  applyPowerup(tipo) {
    this.stats.powerups += 1;
    store.totals.powerups += 1;
    switch (tipo) {
      case 'shield':
        this.shieldCharges = Math.min(2, this.shieldCharges + 1);
        break;
      case 'slow':
        this.slowTimer = 6;
        break;
      case 'x2':
        this.x2Timer = 10;
        break;
      case 'magnet':
        this.magnetTimer = 8;
        break;
    }
    this.onUi.onPowerups(this);
    this.onUi.onToast(`⚡ ${POWERUPS[tipo].nome}!`);
    this.audio.playPower();
    if (store.totals.powerups >= 10) this.unlock('power10');
    if (this.shieldCharges >= 2) this.unlock('blindado');
  }

  hit() {
    this.combo = 0;
    this.onUi.onCombo(0);
    if (this.shieldCharges > 0) {
      this.shieldCharges -= 1;
      this.invuln = 1.2;
      this.shake = 0.8;
      this.onUi.onPowerups(this);
      this.onUi.onToast('🛡️ Escudo absorveu!');
      this.audio.playShield();
      return;
    }
    this.lives -= 1;
    this.invuln = INVULN_TIME;
    this.shake = 1;
    this.onUi.onLives(this.lives);
    this.audio.playHit();
    if (this.lives <= 0) {
      this.phase = 'gameover';
      store.best = Math.max(store.best, Math.floor(this.score));
      this.onUi.onGameOver(Math.floor(this.score), store.best, this.stats, this.wave);
      this.audio.playGameOver();
    }
  }

  unlock(id) {
    if (store.ach[id]) return;
    store.ach[id] = true;
    saveStore();
    const info = ACHIEVEMENTS[id];
    this.onUi.onAchievement(info);
    this.audio.playAchieve();
    this.onUi.onAchievements();
  }

  checkAchievements() {
    if (this.score >= 1000) this.unlock('mil');
    if (this.score >= 5000) this.unlock('lenda');
    if (this.elapsed >= 60) this.unlock('sobrevivente');
    if (this.speed >= 60) this.unlock('velocista');
    if (this.combo >= 12) this.unlock('combo5');  // combo ×5 = 12 coletas seguidas
  }

  /* ── atualização por frame ── */

  update(dt) {
    if (this.phase === 'paused') return;

    const drift = this.phase === 'playing' ? this.speed : 7;

    // estrelas e nebulas
    const pos = this.stars.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let z = pos.getZ(i) + drift * dt * 0.65;
      if (z > 40) z -= 260;
      pos.setZ(i, z);
    }
    pos.needsUpdate = true;
    for (const n of this.nebulas) {
      n.position.z += drift * dt * 0.18;
      if (n.position.z > 30) n.position.z -= 190;
    }

    // motor a pulsar
    const pulse = 1 + Math.sin(performance.now() * 0.012) * 0.18;
    this.engine.scale.set(1, pulse, 1);
    this.glowMat.emissiveIntensity = 2.2 + pulse;

    if (this.phase === 'menu') {
      const t = performance.now() * 0.001;
      this.shipPos.x = Math.sin(t * 0.7) * 2.2;
      this.shipPos.y = 0.6 + Math.sin(t * 1.1) * 0.7;
      this.ship.position.copy(this.shipPos);
      this.ship.rotation.z = -Math.cos(t * 0.7) * 0.14;
      this.updateCamera(dt, false);
      return;
    }
    if (this.phase !== 'playing') {
      this.updateCamera(dt, false);
      return;
    }

    // efeitos correm em tempo real; o mundo desacelera com a câmera lenta
    this.slowTimer = Math.max(0, this.slowTimer - dt);
    this.x2Timer = Math.max(0, this.x2Timer - dt);
    this.magnetTimer = Math.max(0, this.magnetTimer - dt);
    // Chips dos power-ups: re-render quando o estado muda e ~4×/s para o contador
    this._puHud = (this._puHud || 0) + dt;
    const temEfeitos = this.shieldCharges > 0 || this.slowTimer > 0
      || this.x2Timer > 0 || this.magnetTimer > 0;
    if (temEfeitos !== this._puHudState || (temEfeitos && this._puHud >= 0.25)) {
      this._puHud = 0;
      this._puHudState = temEfeitos;
      this.onUi.onPowerups(this);
    }
    const wdt = dt * (this.slowTimer > 0 ? 0.55 : 1);

    this.elapsed += wdt;
    this.speed = 30 + Math.min(36, this.elapsed * 0.5);
    this.invuln = Math.max(0, this.invuln - dt);
    this.shake = Math.max(0, this.shake - dt * 2.4);

    if (this.combo > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 0;
        this.onUi.onCombo(0);
      }
    }

    // ondas de dificuldade
    const wave = 1 + Math.floor(this.elapsed / 30);
    if (wave !== this.wave) {
      this.wave = wave;
      const cor = WAVE_COLORS[(wave - 1) % WAVE_COLORS.length];
      this.scene.fog.color.setHex(cor);
      this.scene.background.setHex(cor);
      this.onUi.onWave(wave, WAVE_NAMES[(wave - 1) % WAVE_NAMES.length]);
    }

    // movimento da nave
    const dir = this.inputDir();
    const k = 1 - Math.exp(-9 * dt);
    this.vel.x += (dir.x * VEL_X - this.vel.x) * k;
    this.vel.y += (dir.y * VEL_Y - this.vel.y) * k;
    this.shipPos.x = clamp(this.shipPos.x + this.vel.x * wdt, -this.bounds.x, this.bounds.x);
    this.shipPos.y = clamp(this.shipPos.y + this.vel.y * wdt, this.bounds.yMin, this.bounds.yMax);
    this.ship.position.copy(this.shipPos);
    this.ship.rotation.z = lerp(this.ship.rotation.z, -this.vel.x / VEL_X * 0.55, k);
    this.ship.rotation.x = lerp(this.ship.rotation.x, this.vel.y / VEL_Y * 0.28, k);
    this.ship.visible = this.invuln <= 0 || Math.sin(this.invuln * 24) > -0.3;

    // pontuação por distância
    this.score += this.speed * wdt * 0.45;
    this.stats.distance += this.speed * wdt * 0.45;
    this.onUi.onScore(this.score);

    // spawn
    this.timers.asteroid -= wdt;
    if (this.timers.asteroid <= 0) {
      this.spawnAsteroid();
      this.timers.asteroid = Math.max(0.4, 1.25 - this.elapsed * 0.007) * (0.75 + Math.random() * 0.5);
    }
    this.timers.orb -= wdt;
    if (this.timers.orb <= 0) {
      this.spawnOrb();
      this.timers.orb = 0.45 + Math.random() * 0.5;
    }
    this.timers.gate -= wdt;
    if (this.timers.gate <= 0) {
      this.spawnGate();
      this.timers.gate = 6.5 + Math.random() * 3;
    }
    this.timers.powerup -= wdt;
    if (this.timers.powerup <= 0) {
      this.spawnPowerup();
      this.timers.powerup = 12 + Math.random() * 10;
    }

    // orbes
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const orb = this.orbs[i];
      orb.t += wdt;
      orb.mesh.position.z += this.speed * wdt;
      orb.mesh.position.y = orb.baseY + Math.sin(orb.t * 2.2) * 0.35;
      orb.mesh.rotation.y += 2.4 * wdt;

      if (this.magnetTimer > 0) {
        const dist = orb.mesh.position.distanceTo(this.shipPos);
        if (dist < 14) {
          const pull = this.shipPos.clone().sub(orb.mesh.position).normalize();
          orb.mesh.position.addScaledVector(pull, 26 * wdt);
        }
      }

      if (orb.mesh.position.z > DESPAWN_Z) {
        this.scene.remove(orb.mesh);
        this.orbs.splice(i, 1);
      } else if (orb.mesh.position.distanceTo(this.shipPos) < orb.r + 0.72) {
        this.scene.remove(orb.mesh);
        this.orbs.splice(i, 1);
        this.stats.orbs += 1;
        store.totals.orbs += 1;
        const gained = this.registerCollect(25);
        this.onUi.onScore(this.score);
        this.onUi.onToast(`+${gained}`);
        this.burst(orb.mesh.position, COLOR_ORB, 10);
        this.audio.playPickup();
        if (store.totals.orbs >= 50) this.unlock('colecionador');
      }
    }

    // portões dourados
    for (let i = this.gates.length - 1; i >= 0; i--) {
      const gate = this.gates[i];
      const prevZ = gate.mesh.position.z;
      gate.mesh.position.z += this.speed * wdt;
      gate.mesh.rotation.z += 0.8 * wdt;
      if (gate.mesh.position.z > DESPAWN_Z) {
        this.scene.remove(gate.mesh);
        this.gates.splice(i, 1);
      } else if (prevZ < SHIP_Z && gate.mesh.position.z >= SHIP_Z) {
        const dx = this.shipPos.x - gate.mesh.position.x;
        const dy = this.shipPos.y - gate.mesh.position.y;
        if (Math.hypot(dx, dy) < 1.55) {
          this.stats.gates += 1;
          store.totals.gates += 1;
          const gained = this.registerCollect(60);
          this.onUi.onScore(this.score);
          this.onUi.onToast(`Portão +${gained}`);
          this.burst(gate.mesh.position, COLOR_GATE, 18);
          this.audio.playGate();
          if (store.totals.gates >= 10) this.unlock('porteiro');
        }
      }
    }

    // power-ups
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const pu = this.powerups[i];
      pu.t += wdt;
      pu.mesh.position.z += this.speed * wdt;
      pu.mesh.position.y = pu.baseY + Math.sin(pu.t * 2) * 0.3;
      pu.mesh.rotation.y += 1.8 * wdt;
      pu.mesh.rotation.x += 1.1 * wdt;
      if (pu.mesh.position.z > DESPAWN_Z) {
        this.scene.remove(pu.mesh);
        this.powerups.splice(i, 1);
      } else if (pu.mesh.position.distanceTo(this.shipPos) < pu.r + 0.72) {
        this.scene.remove(pu.mesh);
        this.powerups.splice(i, 1);
        this.burst(pu.mesh.position, POWERUPS[pu.tipo].cor, 12);
        this.applyPowerup(pu.tipo);
      }
    }

    // asteroides
    for (let i = this.asteroids.length - 1; i >= 0; i--) {
      const ast = this.asteroids[i];
      ast.mesh.position.z += this.speed * wdt;
      ast.mesh.position.x += ast.vx * wdt;
      ast.mesh.position.y += ast.vy * wdt;
      ast.mesh.rotation.x += ast.spin.x * wdt;
      ast.mesh.rotation.y += ast.spin.y * wdt;
      ast.mesh.rotation.z += ast.spin.z * wdt;

      const fora = ast.mesh.position.z > DESPAWN_Z
        || Math.abs(ast.mesh.position.x) > this.bounds.x + 6
        || ast.mesh.position.y < this.bounds.yMin - 5
        || ast.mesh.position.y > this.bounds.yMax + 5;
      if (fora) {
        this.scene.remove(ast.mesh);
        this.asteroids.splice(i, 1);
      } else if (this.invuln <= 0 && ast.mesh.position.distanceTo(this.shipPos) < ast.r + 0.78) {
        this.scene.remove(ast.mesh);
        this.asteroids.splice(i, 1);
        this.burst(this.shipPos, COLOR_HIT, 20);
        this.hit();
      }
    }

    this.updateDebris(wdt);
    this.updateCamera(dt, true);
    this.checkAchievements();
  }

  updateCamera(dt, tracking) {
    const targetX = tracking ? this.shipPos.x * 0.3 : 0;
    const targetY = 3.4 + (tracking ? this.shipPos.y * 0.18 : 0);
    const k = 1 - Math.exp(-6 * dt);
    this.camera.position.x += (targetX - this.camera.position.x) * k;
    this.camera.position.y += (targetY - this.camera.position.y) * k;
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.5;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.4;
    }
    this.camera.lookAt(0, 1.1, -8);
  }
}

/* ════════════════════════════════════════════════════════════════
   DISCORD (Embedded App SDK + linha de prova do Social SDK)
   ════════════════════════════════════════════════════════════════ */

const discord = { sdk: null, mode: 'browser', user: null };

function setBadge(mode, text) {
  const badge = $('discord-badge');
  badge.dataset.state = mode;
  $('discord-text').textContent = text;
}

async function setPresence(details, state) {
  if (discord.mode !== 'discord' || !discord.sdk?.commands?.setActivity) return;
  try {
    await discord.sdk.commands.setActivity({
      activity: {
        type: 0,
        name: 'Órbita Rush',
        details,
        state,
        timestamps: { start: Date.now() },
      },
    });
  } catch {
    /* presença é cosmética — nunca deve rebentar o jogo */
  }
}

async function initDiscord() {
  // Sempre liga o botão de convite com a prova do Social SDK
  for (const id of ['discord-link', 'discord-link-2']) {
    const el = $(id);
    if (el) el.href = INVITE_URL;
  }
  const hint = $('invite-hint');
  if (hint) hint.innerHTML = `Convite (com prova do Discord Social SDK): <code>${INVITE_URL}</code>`;
  document.documentElement.dataset.discordProof = PROOF;

  const params = new URLSearchParams(window.location.search);
  const insideDiscord = params.has('frame_id');
  if (!insideDiscord) {
    discord.mode = 'browser';
    setBadge('browser', 'Modo navegador');
    return;
  }

  try {
    const { DiscordSDK } = await import('https://cdn.jsdelivr.net/npm/@discord/embedded-app-sdk/+esm');
    const clientId = CONFIG.clientId || params.get('client_id') || '';
    if (!clientId) {
      discord.mode = 'unconfigured';
      setBadge('unconfigured', 'Discord: por configurar');
      return;
    }
    const sdk = new DiscordSDK(clientId);
    await sdk.ready();
    discord.sdk = sdk;
    discord.mode = 'discord';
    setBadge('discord', 'Discord ligado');
    setPresence('No menu', 'A escolher a nave');
  } catch {
    discord.mode = 'error';
    setBadge('error', 'Discord: sem ligação');
  }
}

/* ════════════════════════════════════════════════════════════════
   DISCORD NO SITE (OAuth2 "Ligar com Discord" — 100% no navegador)

   O Discord Social SDK é só para engines nativas (C++/Unity/Unreal).
   Num site, o equivalente é: (1) Activity + Embedded App SDK (em cima)
   e (2) este login OAuth2 para jogar no navegador comum.
   Usa o implicit grant (response_type=token) — o único fluxo do Discord
   que não precisa de client_secret, logo funciona em site estático.
   ════════════════════════════════════════════════════════════════ */

const auth = { user: null, token: null, guilds: [] };

function safeGet(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function safeSet(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* storage bloqueado (modo privado) — o login simplesmente não persiste */
  }
}

function randomState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function redirectUri() {
  // ⚠️ Tem de estar igualzinho em Developer Portal → OAuth2 → Redirects
  return window.location.origin + window.location.pathname;
}

function discordLogin() {
  if (!CONFIG.clientId) {
    showToast('⚠️ Define o clientId em assets/game.js primeiro');
    return;
  }
  const state = randomState();
  safeSet('orbita-rush/oauth-state', state);
  const params = new URLSearchParams({
    response_type: 'token',
    client_id: CONFIG.clientId,
    redirect_uri: redirectUri(),
    scope: 'identify guilds',
    state,
  });
  window.location.href = `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function discordLogout() {
  safeSet('orbita-rush/oauth', null);
  auth.user = null;
  auth.token = null;
  auth.guilds = [];
  renderAuth();
  showToast('👋 Desligado do Discord');
}

async function discordApi(path, token) {
  const resp = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Discord API: ${resp.status}`);
  return resp.json();
}

async function handleOAuthRedirect() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const token = hash.get('access_token');
  if (!token) return;
  const state = hash.get('state');
  const expected = safeGet('orbita-rush/oauth-state');
  safeSet('orbita-rush/oauth-state', null);
  // tira o token da barra de endereço
  history.replaceState(null, '', window.location.pathname + window.location.search);
  if (!state || state !== expected) {
    showToast('❌ Login do Discord recusado (state inválido)');
    return;
  }
  const expires = Date.now() + Number(hash.get('expires_in') || 604800) * 1000;
  safeSet('orbita-rush/oauth', JSON.stringify({ token, expires }));
  showToast('✅ Ligado ao Discord!');
}

async function loadDiscordUser() {
  let saved = null;
  try { saved = JSON.parse(safeGet('orbita-rush/oauth') || 'null'); } catch { saved = null; }
  if (!saved || !saved.token) return;
  if (saved.expires < Date.now()) {
    safeSet('orbita-rush/oauth', null);
    return;
  }
  try {
    auth.token = saved.token;
    auth.user = await discordApi('/users/@me', saved.token);
    if (CONFIG.guildId) {
      auth.guilds = await discordApi('/users/@me/guilds', saved.token);
    }
  } catch {
    auth.user = null;
    showToast('⚠️ Sessão do Discord expirada — liga outra vez');
  }
}

function isServerMember() {
  return !!CONFIG.guildId && auth.guilds.some((g) => String(g.id) === String(CONFIG.guildId));
}

function renderAuth() {
  const loginBtn = $('btn-discord-login');
  const logoutBtn = $('btn-discord-logout');
  if (!loginBtn || !logoutBtn) return;
  const nome = auth.user ? (auth.user.global_name || auth.user.username) : '';
  loginBtn.hidden = !!auth.user;
  logoutBtn.hidden = !auth.user;
  if (auth.user) logoutBtn.textContent = `🚪 Sair (${nome})`;

  if (discord.mode === 'browser') {
    if (auth.user) {
      $('discord-badge').dataset.state = 'discord';
      $('discord-text').textContent = `👋 ${nome}`;
    } else {
      setBadge('browser', 'Modo navegador');
    }
  }
}

function applyMemberSkin() {
  if (!isServerMember() || !game) return;
  game.glowMat.color.setHex(0xffc94d);
  game.glowMat.emissive.setHex(0xffc94d);
  showToast('⭐ Skin de membro do servidor ativada!');
}

async function initAuth() {
  await handleOAuthRedirect();
  await loadDiscordUser();
  renderAuth();
  applyMemberSkin();
}

/* ════════════════════════════════════════════════════════════════
   UI
   ════════════════════════════════════════════════════════════════ */

const ui = {
  hud: $('hud'),
  menu: $('menu'),
  pause: $('pause'),
  gameover: $('gameover'),
  score: $('score'),
  best: $('best'),
  speed: $('speed'),
  lives: document.querySelectorAll('#lives .life'),
  finalScore: $('final-score'),
  finalBest: $('final-best'),
  finalStats: $('final-stats'),
  finalLeaderboard: $('final-leaderboard'),
  leaderboard: $('leaderboard'),
  menuBest: $('menu-best'),
  achievements: $('achievements'),
  combo: $('combo'),
  comboMult: $('combo-mult'),
  powerups: $('powerups'),
  toast: $('toast'),
  banner: $('achievement-banner'),
};

let toastTimer = null;
function showToast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 900);
}

let bannerTimer = null;
function showAchievement(info) {
  $('ab-title').textContent = `🏆 ${info.nome}`;
  $('ab-desc').textContent = info.desc;
  ui.banner.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { ui.banner.hidden = true; }, 3600);
}

function renderLeaderboard(listEl, highlightScore = null) {
  if (!listEl) return;
  if (store.top.length === 0) {
    listEl.innerHTML = '<li><span>Ainda sem pontuações</span></li>';
    return;
  }
  listEl.innerHTML = store.top
    .slice(0, 5)
    .map((entry, i) => {
      const me = highlightScore !== null && entry.score === highlightScore;
      return `<li class="${me ? 'me' : ''}"><span>${i + 1}º</span><b>${entry.score}</b></li>`;
    })
    .join('');
}

function renderAchievements() {
  ui.achievements.innerHTML = Object.entries(ACHIEVEMENTS)
    .map(([id, info]) => {
      const done = !!store.ach[id];
      return `<li class="${done ? 'done' : ''}">` +
        `<span class="${done ? 'ok' : 'no'}">${done ? '✓' : '○'}</span>` +
        `<span>${info.nome}</span></li>`;
    })
    .join('');
}

function renderPowerups(game) {
  const chips = [];
  if (game.shieldCharges > 0) {
    chips.push(`<span class="powerup-chip pu-shield"><span class="pudot"></span>🛡️ ×${game.shieldCharges}</span>`);
  }
  if (game.slowTimer > 0) {
    chips.push(`<span class="powerup-chip pu-slow"><span class="pudot"></span>⏱️ ${Math.ceil(game.slowTimer)}s</span>`);
  }
  if (game.x2Timer > 0) {
    chips.push(`<span class="powerup-chip pu-x2"><span class="pudot"></span>×2 ${Math.ceil(game.x2Timer)}s</span>`);
  }
  if (game.magnetTimer > 0) {
    chips.push(`<span class="powerup-chip pu-magnet"><span class="pudot"></span>🧲 ${Math.ceil(game.magnetTimer)}s</span>`);
  }
  ui.powerups.innerHTML = chips.join('');
}

function renderFinalStats(stats, wave) {
  const items = [
    [Math.floor(stats.distance), 'distância'],
    [stats.orbs, 'orbes'],
    [stats.gates, 'portões'],
    [wave, 'onda'],
  ];
  ui.finalStats.innerHTML = items
    .map(([v, l]) => `<div class="stat"><span class="v">${v}</span><span class="l">${l}</span></div>`)
    .join('');
}

/* ════════════════════════════════════════════════════════════════
   ARRANQUE
   ════════════════════════════════════════════════════════════════ */

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(WAVE_COLORS[0]);
scene.fog = new THREE.FogExp2(WAVE_COLORS[0], 0.0105);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 420);
camera.position.set(0, 3.4, 15);

scene.add(new THREE.HemisphereLight(10336511, 659230, 0.55));
const sun = new THREE.DirectionalLight(12571903, 1.15);
sun.position.set(4, 8, 6);
scene.add(sun);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.9, 0.55, 0.8,
));
composer.addPass(new OutputPass());

const audio = new AudioSys();
const startAudio = () => {
  audio.unlock();
  audio.startMusic();
};
window.addEventListener('pointerdown', startAudio, { once: true });
window.addEventListener('keydown', startAudio, { once: true });
if (store.muted) $('btn-mute').style.opacity = 0.5;

const game = new Game({
  scene,
  camera,
  audio,
  onUi: {
    onScore(value, force = false) {
      const n = Math.floor(value);
      if (force || n !== Number(ui.score.textContent)) ui.score.textContent = n;
      ui.best.textContent = Math.max(store.best, n);
      const speed = Math.round(game.speed);
      if (speed !== Number(ui.speed.textContent)) ui.speed.textContent = speed;
      // Presença no Discord muda a cada 250 pontos
      const milestone = Math.floor(n / 250);
      if (milestone > game.milestone) {
        game.milestone = milestone;
        setPresence(`Pontuação: ${n}`, `A desviar de asteroides — onda ${game.wave}`);
      }
    },
    onLives(lives) {
      ui.lives.forEach((el, i) => el.classList.toggle('lost', i >= lives));
    },
    onToast: showToast,
    onCombo(mult, combo = 0) {
      if (mult > 1) {
        ui.combo.hidden = false;
        ui.comboMult.textContent = `x${mult}`;
        ui.combo.title = `Combo: ${combo} coletas seguidas`;
      } else {
        ui.combo.hidden = true;
      }
    },
    onPowerups: renderPowerups,
    onWave(wave, nome) {
      showToast(`Onda ${wave} — ${nome}`);
    },
    onAchievement: showAchievement,
    onAchievements: renderAchievements,
    onGameOver(score, best, stats, wave) {
      ui.finalScore.textContent = score;
      ui.finalBest.textContent = `Recorde: ${best}`;
      renderFinalStats(stats, wave);

      // orbes/portões/power-ups são contados em tempo real; aqui só as partidas
      store.totals.runs += 1;
      store.top.push({ score, date: new Date().toISOString().slice(0, 10) });
      store.top.sort((a, b) => b.score - a.score);
      store.top = store.top.slice(0, 5);
      saveStore();
      renderLeaderboard(ui.finalLeaderboard, score);
      renderAchievements();

      ui.gameover.hidden = false;
      ui.hud.hidden = true;
      setPresence('Nave destruída — fim de jogo', `Pontuação final: ${score}`);
    },
  },
});

/* ── botões e teclado ── */

function goMenu() {
  ui.menu.hidden = false;
  ui.pause.hidden = true;
  ui.gameover.hidden = true;
  ui.hud.hidden = true;
  game.toMenu();
  renderLeaderboard(ui.leaderboard);
  renderAchievements();
  ui.menuBest.textContent = `Recorde: ${store.best}`;
  setPresence('No menu', 'A escolher a nave');
}

function startGame() {
  audio.unlock();
  audio.playStart();
  ui.menu.hidden = true;
  ui.gameover.hidden = true;
  ui.pause.hidden = true;
  ui.hud.hidden = false;
  game.start();
  setPresence('A jogar', 'Onda 1 — Órbita Baixa');
}

function togglePause() {
  const phase = game.togglePause();
  ui.pause.hidden = phase !== 'paused';
}

$('btn-start').addEventListener('click', startGame);
$('btn-restart').addEventListener('click', startGame);
$('btn-menu').addEventListener('click', goMenu);
$('btn-resume').addEventListener('click', togglePause);
$('btn-quit').addEventListener('click', goMenu);
$('btn-pause').addEventListener('click', togglePause);
$('btn-mute').addEventListener('click', () => {
  const muted = audio.toggleMute();
  $('btn-mute').style.opacity = muted ? 0.5 : 1;
  $('btn-mute').setAttribute('aria-label', muted ? 'Ativar som' : 'Silenciar');
});
$('btn-discord-login').addEventListener('click', discordLogin);
$('btn-discord-logout').addEventListener('click', discordLogout);

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (key === ' ' || key === 'enter') {
    if (!ui.menu.hidden || !ui.gameover.hidden) {
      e.preventDefault();
      startGame();
    }
  } else if (key === 'p' || key === 'escape') {
    if (game.phase === 'playing' || game.phase === 'paused') togglePause();
  } else if (key === 'm') {
    $('btn-mute').click();
  }
});

// Pausa automática quando se perde o foco ou se esconde a aba (bug antigo)
window.addEventListener('blur', () => {
  if (game.phase === 'playing') togglePause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.phase === 'playing') togglePause();
});

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  game.updateBounds();
}
window.addEventListener('resize', onResize);

/* ── loop principal ── */

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  game.update(dt);
  composer.render();
});

/* ── arranque ── */

renderAchievements();
renderLeaderboard(ui.leaderboard);
ui.menuBest.textContent = `Recorde: ${store.best}`;
ui.best.textContent = store.best;
initDiscord();
initAuth();

window.__orbitaReady = true;
if (window.__orbitaBoot) clearTimeout(window.__orbitaBoot);
