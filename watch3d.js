// Механические часы, собранные кодом: корпус, циферблат, стрелки, платина,
// колесная передача с настоящим зацеплением, баланс, мосты, ротор.
// Прокрутка секции (или ползунок) разбирает часы по слоям.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  TAU, clamp01, lerp, smoothstep, layerProgress, explodeFromScroll, scrollFromExplode,
  trainBases, trainAngles, escapeAngle, balanceAngle, handAngles, fitDistance,
} from "./mechanics.js";

const section = document.getElementById("explode");
const canvas = document.getElementById("watch-canvas");
const slider = document.getElementById("explode-range");
const sliderVal = document.getElementById("explode-value");
const labelsEl = document.getElementById("part-labels");
const introEl = document.querySelector(".stage-copy.intro");
const outroEl = document.querySelector(".stage-copy.outro");

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
} catch (err) {
  document.documentElement.classList.add("no-webgl");
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const maxAniso = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);

// Студия для отражений: темная комната и несколько софтбоксов —
// металл получает контрастные блики, как на предметной съемке.
function studioEnvironment() {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.MeshBasicMaterial({ color: 0x121419, side: THREE.BackSide })));
  const panel = (w, h, pos, color, power) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(16, 5, [0, 12, 3], 0xffffff, 3.2);    // верхний софтбокс
  panel(2.5, 14, [-12, 2, 4], 0xffffff, 2.4); // левая полоса
  panel(2.5, 14, [12, 1, -3], 0xfff0dc, 2.2); // правая полоса
  panel(10, 3, [3, -7, 10], 0xffc680, 1.2);   // теплый снизу
  panel(7, 7, [-5, 4, -12], 0x9fb4ff, 1.8);   // холодный контровой
  panel(6, 4, [2, 3, 13], 0xffffff, 1.1);     // мягкий фронтальный
  return pmrem.fromScene(env, 0.02).texture;
}
scene.environment = studioEnvironment();

const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 200);

const key = new THREE.DirectionalLight(0xfff1dc, 2.2);
key.position.set(4, 6, 8);
const rim = new THREE.DirectionalLight(0x8fa6ff, 2.4);
rim.position.set(-6, 3, -5);
const warm = new THREE.PointLight(0xffb45a, 18, 20);
warm.position.set(3.5, -2.5, 3);
scene.add(key, rim, warm);

// ---------- процедурные текстуры ----------
function canvasTex(size, draw, { srgb = true, repeat = null } = {}) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
  }
  return t;
}

// Женевские полосы на мостах.
function genevaDraw(ctx, s) {
  ctx.fillStyle = "#b9bec6";
  ctx.fillRect(0, 0, s, s);
  const band = s / 4;
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.rotate(-Math.PI / 4);
  for (let x = -s; x < s; x += band) {
    const g = ctx.createLinearGradient(x, 0, x + band, 0);
    g.addColorStop(0, "#8e949d");
    g.addColorStop(0.5, "#eef1f5");
    g.addColorStop(1, "#8e949d");
    ctx.fillStyle = g;
    ctx.fillRect(x, -s, band, s * 2);
  }
  ctx.restore();
}

// Перляж на платине — перекрывающиеся «завитки».
function perlageDraw(ctx, s) {
  ctx.fillStyle = "#9aa0a8";
  ctx.fillRect(0, 0, s, s);
  const r = s / 9;
  const step = r * 1.25;
  for (let row = -1, y = 0; y < s + r; row++, y = row * step * 0.87) {
    for (let x = (row % 2) * step * 0.5 - step; x < s + r; x += step) {
      const g = ctx.createConicGradient ? ctx.createConicGradient(x * 0.01, x, y) : null;
      if (g) {
        g.addColorStop(0, "#c9cdd3");
        g.addColorStop(0.25, "#7d838c");
        g.addColorStop(0.5, "#d9dde2");
        g.addColorStop(0.75, "#80868f");
        g.addColorStop(1, "#c9cdd3");
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = "#b0b5bc";
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
  }
}

// Циферблат + минутная дорожка + надписи.
function dialDraw(ctx, s) {
  const c = s / 2;
  const bg = ctx.createRadialGradient(c, c, 0, c, c, c);
  bg.addColorStop(0, "#23365e");
  bg.addColorStop(0.7, "#101c38");
  bg.addColorStop(1, "#070d1d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, s, s);
  // лучи
  ctx.save();
  ctx.translate(c, c);
  for (let i = 0; i < 720; i++) {
    ctx.rotate(TAU / 720);
    ctx.fillStyle = `rgba(255,255,255,${0.012 + 0.02 * Math.random()})`;
    ctx.fillRect(0, -1, c, 2);
  }
  ctx.restore();
  // «блик» солнечной обработки — светлее в двух противоположных секторах
  if (ctx.createConicGradient) {
    const sh = ctx.createConicGradient(-0.6, c, c);
    sh.addColorStop(0, "rgba(140,170,255,0.22)");
    sh.addColorStop(0.18, "rgba(0,0,0,0)");
    sh.addColorStop(0.5, "rgba(140,170,255,0.18)");
    sh.addColorStop(0.68, "rgba(0,0,0,0)");
    sh.addColorStop(1, "rgba(140,170,255,0.22)");
    ctx.fillStyle = sh;
    ctx.fillRect(0, 0, s, s);
  }
  // минутная дорожка
  ctx.save();
  ctx.translate(c, c);
  for (let i = 0; i < 60; i++) {
    const big = i % 5 === 0;
    ctx.fillStyle = big ? "rgba(236,200,130,0.95)" : "rgba(230,232,240,0.7)";
    const w = big ? s * 0.006 : s * 0.0028;
    const len = big ? s * 0.035 : s * 0.02;
    ctx.fillRect(-w / 2, -c * 0.965, w, len);
    ctx.rotate(TAU / 60);
  }
  ctx.restore();
  ctx.textAlign = "center";
  ctx.fillStyle = "#f1ead8";
  ctx.font = `700 ${s * 0.062}px Oswald, 'Arial Narrow', sans-serif`;
  ctx.fillText("LUMEN", c, c - s * 0.2);
  ctx.fillStyle = "rgba(236,200,130,0.95)";
  ctx.font = `600 ${s * 0.022}px Oswald, 'Arial Narrow', sans-serif`;
  ctx.fillText("A U T O M A T I C", c, c - s * 0.155);
  ctx.fillStyle = "rgba(230,232,240,0.75)";
  ctx.font = `600 ${s * 0.024}px Oswald, 'Arial Narrow', sans-serif`;
  ctx.fillText("CALIBRE 01  ·  21 JEWELS", c, c + s * 0.215);
}

// ---------- материалы ----------
const M = {
  steel: new THREE.MeshPhysicalMaterial({ color: 0xc9cdd3, metalness: 1, roughness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.06 }),
  brushed: new THREE.MeshPhysicalMaterial({ color: 0xb8bdc4, metalness: 1, roughness: 0.3 }),
  gold: new THREE.MeshPhysicalMaterial({ color: 0xe9b96a, metalness: 1, roughness: 0.2 }),
  goldMirror: new THREE.MeshPhysicalMaterial({ color: 0xf0c47a, metalness: 1, roughness: 0.08, clearcoat: 0.6 }),
  rotor: new THREE.MeshPhysicalMaterial({ color: 0xd8a85c, metalness: 1, roughness: 0.26 }),
  bridge: new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 1, roughness: 0.28,
    map: canvasTex(512, genevaDraw, { repeat: 1.4 }),
    roughnessMap: canvasTex(512, genevaDraw, { srgb: false, repeat: 1.4 }),
  }),
  plate: new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 1, roughness: 0.4,
    map: canvasTex(512, perlageDraw, { repeat: 3.2 }),
    roughnessMap: canvasTex(512, perlageDraw, { srgb: false, repeat: 3.2 }),
  }),
  ruby: new THREE.MeshPhysicalMaterial({ color: 0xd0142f, metalness: 0, roughness: 0.04, clearcoat: 1, sheen: 0.4, emissive: 0x3a0008 }),
  blued: new THREE.MeshPhysicalMaterial({ color: 0x2f55e0, metalness: 1, roughness: 0.25 }),
  // Стекло без transmission: на прозрачном фоне страницы проход преломления
  // заливал диск молочно-белым. Прозрачность + блики окружения выглядят чище.
  glass: new THREE.MeshPhysicalMaterial({
    color: 0xc6d6ff, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.14,
    clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6, depthWrite: false,
  }),
  lume: new THREE.MeshStandardMaterial({ color: 0xe8f3df, emissive: 0x7fe2a0, emissiveIntensity: 0.35, roughness: 0.6 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x0b1224, roughness: 0.6, metalness: 0.2 }),
  dial: null,
};

// ---------- геометрия-помощники ----------
function ext(shape, depth, bevel = 0.004) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 20,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

function lathe(profile, segments = 160) {
  const g = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), segments);
  g.rotateX(Math.PI / 2); // ось вращения — Z (к зрителю)
  return g;
}

function cyl(r, h, mat, seg = 48) {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  g.rotateX(Math.PI / 2);
  return new THREE.Mesh(g, mat);
}

// Колесо с зубьями (модуль задается радиусом делительной окружности)
// и спицами-окнами, как у настоящих часовых колес.
function gearShape(n, r, { hub = 0.09, spokes = 5, rim = 0.07, hole = 0.025 } = {}) {
  const m = (2 * r) / n;
  const ra = r + m * 0.9;
  const rr = r - m * 1.15;
  const p = TAU / n;
  const s = new THREE.Shape();
  const pt = (rad, a) => [rad * Math.cos(a), rad * Math.sin(a)];
  for (let i = 0; i < n; i++) {
    const a = i * p;
    const pts = [
      pt(rr, a - 0.5 * p), pt(rr, a - 0.26 * p), pt(ra * 0.97, a - 0.14 * p),
      pt(ra, a - 0.06 * p), pt(ra, a + 0.06 * p), pt(ra * 0.97, a + 0.14 * p), pt(rr, a + 0.26 * p),
    ];
    pts.forEach(([x, y], k) => (i === 0 && k === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
  }
  s.closePath();
  const h = new THREE.Path();
  h.absarc(0, 0, hole, 0, TAU, true);
  s.holes.push(h);
  const rimR = rr - rim;
  if (spokes > 0 && rimR > hub + 0.06) {
    const sw = Math.min(0.05, r * 0.12);
    for (let k = 0; k < spokes; k++) {
      const a0 = (k / spokes) * TAU;
      const a1 = ((k + 1) / spokes) * TAU;
      const w = new THREE.Path();
      const go = sw / 2 / rimR;
      const gi = sw / 2 / hub;
      w.moveTo(...pt(rimR, a0 + go));
      w.absarc(0, 0, rimR, a0 + go, a1 - go, false);
      w.lineTo(...pt(hub, a1 - gi));
      w.absarc(0, 0, hub, a1 - gi, a0 + gi, true);
      w.closePath();
      s.holes.push(w);
    }
  }
  return s;
}

function gear(n, r, depth, mat, opts) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(ext(gearShape(n, r, opts), depth, 0.003), mat));
  // ось и трибка
  const arbor = cyl(0.028, 0.22, M.steel, 20);
  g.add(arbor);
  if (r > 0.25) {
    const pinion = new THREE.Mesh(ext(gearShape(8, 0.075, { spokes: 0, hole: 0.02 }), 0.05, 0.002), M.steel);
    pinion.position.z = depth / 2 + 0.03;
    g.add(pinion);
  }
  return g;
}

function capsule(ax, ay, bx, by, w) {
  const s = new THREE.Shape();
  const ang = Math.atan2(by - ay, bx - ax);
  const h = w / 2;
  s.absarc(bx, by, h, ang - Math.PI / 2, ang + Math.PI / 2, false);
  s.absarc(ax, ay, h, ang + Math.PI / 2, ang + (3 * Math.PI) / 2, false);
  s.closePath();
  return s;
}

// ---------- сборка часов ----------
const watch = new THREE.Group();
scene.add(watch);
const layers = [];
let partCount = 0;

function layer(key, group, cfg) {
  watch.add(group);
  layers.push({ key, group, ...cfg, t: 0 });
  group.traverse((o) => { if (o.isMesh) partCount++; });
  return group;
}

// Координаты осей колесной передачи (в плоскости платины).
const TRAIN = [
  { n: 56, r: 0.7, x: -0.6, y: 0.55 },  // барабан
  { n: 36, r: 0.45 },                    // центральное
  { n: 28, r: 0.35 },                    // промежуточное
  { n: 24, r: 0.3 },                     // секундное
  { n: 16, r: 0.2 },                     // спусковое
];
const TRAIN_DIRS = [-0.52, 0.7, -1.22, -2.27];
for (let i = 1; i < TRAIN.length; i++) {
  const a = TRAIN[i - 1];
  const b = TRAIN[i];
  const d = a.r + b.r;
  b.x = a.x + d * Math.cos(TRAIN_DIRS[i - 1]);
  b.y = a.y + d * Math.sin(TRAIN_DIRS[i - 1]);
}
const TEETH = TRAIN.map((w) => w.n);
const BASES = trainBases(TEETH, TRAIN_DIRS);
const BALANCE = { x: 0.2, y: -1.02 };
const BEAT_HZ = 5;

// 1. Задняя крышка с сапфировым окном
{
  const g = new THREE.Group();
  g.add(new THREE.Mesh(lathe([[1.42, -0.4], [2.0, -0.4], [2.03, -0.44], [1.96, -0.52], [1.5, -0.53], [1.42, -0.47], [1.42, -0.4]]), M.steel));
  const win = cyl(1.44, 0.04, M.glass, 96);
  win.position.z = -0.46;
  g.add(win);
  layer("back", g, { dz: -4.2, order: 0, label: "Крышка с сапфировым окном", anchor: [0, -1.9, -0.46] });
}

// 2. Ротор автоподзавода
const rotor = new THREE.Group();
{
  const s = new THREE.Shape();
  s.absarc(0, 0, 1.55, Math.PI * 0.02, Math.PI * 0.98, false);
  s.absarc(0, 0, 0.16, Math.PI * 0.98, Math.PI * 0.02, true);
  s.closePath();
  for (const [a0, a1] of [[0.14, 0.44], [0.56, 0.86]]) {
    const w = new THREE.Path();
    w.absarc(0, 0, 1.3, Math.PI * a0, Math.PI * a1, false);
    w.absarc(0, 0, 0.45, Math.PI * a1, Math.PI * a0, true);
    w.closePath();
    s.holes.push(w);
  }
  const m = new THREE.Mesh(ext(s, 0.05), M.rotor);
  m.position.z = -0.34;
  rotor.add(m);
  const weight = new THREE.Mesh(new THREE.TorusGeometry(1.43, 0.07, 12, 64, Math.PI * 0.94), M.goldMirror);
  weight.rotation.z = Math.PI * 0.03;
  weight.position.z = -0.34;
  rotor.add(weight);
  const bearing = cyl(0.18, 0.08, M.steel, 40);
  bearing.position.z = -0.34;
  rotor.add(bearing);
  // ротор крутится внутри неподвижной группы — подпись к нему не уплывает
  layer("rotor", new THREE.Group().add(rotor), { dz: -3.3, order: 1, label: "Ротор автоподзавода", anchor: [0, 1.5, -0.34] });
}

// 3. Мосты с женевскими полосами, рубинами и воронеными винтами
const ratchet = gear(40, 0.46, 0.04, M.steel, { spokes: 0, hole: 0.06 });
{
  const g = new THREE.Group();
  const z = -0.25;
  const W = TRAIN;
  const shapes = [
    capsule(W[1].x, W[1].y, W[2].x, W[2].y, 0.34),
    capsule(W[2].x, W[2].y, W[3].x, W[3].y, 0.3),
    capsule(W[3].x, W[3].y, W[4].x, W[4].y, 0.28),
    capsule(BALANCE.x, BALANCE.y, -0.55, -1.25, 0.3),
  ];
  const barrelBridge = new THREE.Shape();
  barrelBridge.absarc(W[0].x, W[0].y, 0.78, 0, TAU, false);
  shapes.push(barrelBridge);
  shapes.forEach((s, i) => {
    const m = new THREE.Mesh(ext(s, 0.05), M.bridge);
    m.position.z = z - i * 0.004;
    g.add(m);
  });
  ratchet.position.set(W[0].x, W[0].y, z - 0.05);
  g.add(ratchet);
  for (const p of [W[1], W[2], W[3], W[4], BALANCE]) {
    const j = cyl(0.055, 0.02, M.ruby, 24);
    j.position.set(p.x, p.y, z - 0.035);
    g.add(j);
    const chaton = cyl(0.08, 0.012, M.goldMirror, 32);
    chaton.position.set(p.x, p.y, z - 0.03);
    g.add(chaton);
  }
  const screwAt = [[-0.05, 0.05], [1.25, 0.3], [0.62, -0.62], [-0.6, -1.3], [-1.2, 0.95], [0.0, 1.05]];
  for (const [x, y] of screwAt) {
    const sc = cyl(0.06, 0.03, M.blued, 24);
    sc.position.set(x, y, z - 0.04);
    g.add(sc);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.014, 0.01), M.dark);
    slot.position.set(x, y, z - 0.056);
    slot.rotation.z = Math.random() * Math.PI;
    g.add(slot);
  }
  layer("bridges", g, { dz: -2.45, order: 2, label: "Мосты · 21 камень", anchor: [-1.1, 1.2, -0.25] });
}

// 4. Колесная передача и баланс
const wheels = [];
const balance = new THREE.Group();
const hairspring = new THREE.Group();
{
  const g = new THREE.Group();
  const z = -0.15;
  TRAIN.forEach((w, i) => {
    const mat = i === 0 ? M.brushed : M.gold;
    const wheel = gear(w.n, w.r, i === 0 ? 0.05 : 0.035, mat, { spokes: w.r > 0.25 ? 5 : 4, hub: w.r > 0.3 ? 0.1 : 0.06 });
    wheel.position.set(w.x, w.y, z);
    if (i === 0) {
      const drum = cyl(0.6, 0.14, M.brushed, 96);
      drum.position.z = 0.09;
      wheel.add(drum);
    }
    g.add(wheel);
    wheels.push(wheel);
  });
  // баланс: обод, перекладина, винты
  balance.add(new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.035, 16, 96), M.gold));
  for (const rot of [0, Math.PI / 2]) {
    const arm = new THREE.Mesh(new RoundedBoxGeometry(0.88, 0.05, 0.03, 2, 0.01), M.gold);
    arm.rotation.z = rot;
    balance.add(arm);
  }
  for (let k = 0; k < 10; k++) {
    const sc = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), M.goldMirror);
    const a = (k / 10) * TAU;
    sc.position.set(Math.cos(a) * 0.48, Math.sin(a) * 0.48, 0);
    balance.add(sc);
  }
  balance.add(cyl(0.05, 0.12, M.steel, 24));
  const pts = [];
  for (let i = 0; i <= 600; i++) {
    const t = i / 600;
    const a = t * TAU * 9;
    const rad = 0.06 + t * 0.28;
    pts.push(new THREE.Vector3(Math.cos(a) * rad, Math.sin(a) * rad, -0.035));
  }
  hairspring.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 900, 0.005, 5), M.blued));
  balance.position.set(BALANCE.x, BALANCE.y, z);
  hairspring.position.set(BALANCE.x, BALANCE.y, z);
  g.add(balance, hairspring);
  layer("train", g, { dz: -1.65, order: 3, label: "Колеса и баланс 2,5 Гц", anchor: [1.5, 0.5, -0.15] });
}

// 5. Платина с перляжем
{
  const s = new THREE.Shape();
  s.absarc(0, 0, 1.66, 0, TAU, false);
  for (const p of [...TRAIN, BALANCE]) {
    const h = new THREE.Path();
    h.absarc(p.x, p.y, 0.05, 0, TAU, true);
    s.holes.push(h);
  }
  const m = new THREE.Mesh(ext(s, 0.06), M.plate);
  m.position.z = -0.06;
  layer("plate", new THREE.Group().add(m), { dz: -0.85, order: 4, label: "Платина с перляжем", anchor: [-1.66, 0, -0.06] });
}

// 6. Корпус и ушки
{
  const g = new THREE.Group();
  g.add(new THREE.Mesh(lathe([
    [1.78, -0.4], [1.99, -0.41], [2.07, -0.33], [2.11, -0.15], [2.12, 0], [2.11, 0.15],
    [2.07, 0.3], [1.99, 0.38], [1.78, 0.38], [1.78, -0.4],
  ]), M.steel));
  // Ушко: изогнутый «рог», профиль в плоскости (z, y), вытянут по x.
  const prof = new THREE.Shape();
  prof.moveTo(-0.34, 1.7);
  prof.quadraticCurveTo(-0.3, 2.3, -0.1, 2.46);
  prof.quadraticCurveTo(0.08, 2.52, 0.14, 2.36);
  prof.quadraticCurveTo(0.26, 2.0, 0.32, 1.7);
  prof.closePath();
  const lugGeo = new THREE.ExtrudeGeometry(prof, {
    depth: 0.32, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 4, curveSegments: 24,
  });
  lugGeo.translate(0, 0, -0.16);
  lugGeo.rotateY(-Math.PI / 2); // профиль x -> мировая z
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const lug = new THREE.Mesh(lugGeo, M.steel);
    // низ ушек зеркалим поворотом на 180° вокруг оси z
    if (sy < 0) lug.rotation.z = Math.PI;
    lug.position.x = sy < 0 ? -sx * 1.06 : sx * 1.06;
    g.add(lug);
  }
  layer("case", g, { dz: 0, order: 4, label: "Корпус 41 мм", anchor: [-1.5, -1.5, 0] });
}

// 7. Заводная головка — выезжает вбок
{
  const g = new THREE.Group();
  const cg = new THREE.CylinderGeometry(0.22, 0.22, 0.3, 96, 1);
  const pos = cg.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const zz = pos.getZ(i);
    const rad = Math.hypot(x, zz);
    if (rad > 0.2) {
      const a = Math.atan2(zz, x);
      const k = 1 + 0.045 * Math.cos(a * 30);
      pos.setX(i, x * k);
      pos.setZ(i, zz * k);
    }
  }
  cg.computeVertexNormals();
  cg.rotateZ(Math.PI / 2);
  const crown = new THREE.Mesh(cg, M.steel);
  crown.position.x = 2.34;
  g.add(crown);
  const cap = cyl(0.16, 0.02, M.goldMirror, 40);
  cap.rotation.y = Math.PI / 2;
  cap.position.x = 2.5;
  g.add(cap);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 16).rotateZ(Math.PI / 2), M.steel);
  stem.position.x = 1.95;
  g.add(stem);
  layer("crown", g, { dz: 0, dx: 1.1, order: 3, label: "Заводная головка", anchor: [2.5, 0.25, 0] });
}

// 8. Циферблат с накладными индексами
{
  const g = new THREE.Group();
  const base = cyl(1.78, 0.03, M.dark, 128);
  base.position.z = 0.055;
  g.add(base);
  M.dial = new THREE.MeshPhysicalMaterial({ map: canvasTex(2048, dialDraw), metalness: 0.35, roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const face = new THREE.Mesh(new THREE.CircleGeometry(1.78, 128), M.dial);
  face.position.z = 0.071;
  g.add(face);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const bars = i === 0 ? [-0.055, 0.055] : [0];
    for (const off of bars) {
      const idx = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.3, 0.035, 2, 0.012), M.goldMirror);
      idx.position.set(Math.sin(a) * 1.3 + Math.cos(a) * off, Math.cos(a) * 1.3 - Math.sin(a) * off, 0.09);
      idx.rotation.z = -a;
      g.add(idx);
      const dot = cyl(0.028, 0.012, M.lume, 16);
      dot.position.set(Math.sin(a) * 1.49 + Math.cos(a) * off, Math.cos(a) * 1.49 - Math.sin(a) * off, 0.085);
      g.add(dot);
    }
  }
  layer("dial", g, { dz: 1.3, order: 3, label: "Циферблат", anchor: [-1.2, 1.3, 0.07] });
}

// 9. Стрелки с люминесцентом
const hands = {};
{
  const g = new THREE.Group();
  function hand(len, w, tail, z, lume) {
    const hg = new THREE.Group();
    const s = new THREE.Shape();
    s.moveTo(-w * 0.7, -tail);
    s.lineTo(-w, len * 0.72);
    s.lineTo(0, len);
    s.lineTo(w, len * 0.72);
    s.lineTo(w * 0.7, -tail);
    s.closePath();
    hg.add(new THREE.Mesh(ext(s, 0.014, 0.003), M.goldMirror));
    if (lume) {
      const l = new THREE.Shape();
      l.moveTo(-w * 0.42, len * 0.12);
      l.lineTo(-w * 0.6, len * 0.68);
      l.lineTo(0, len * 0.86);
      l.lineTo(w * 0.6, len * 0.68);
      l.lineTo(w * 0.42, len * 0.12);
      l.closePath();
      const lm = new THREE.Mesh(ext(l, 0.006, 0), M.lume);
      lm.position.z = 0.01;
      hg.add(lm);
    }
    hg.add(cyl(0.075, 0.02, M.goldMirror, 32));
    hg.position.z = z;
    g.add(hg);
    return hg;
  }
  hands.hour = hand(0.9, 0.075, 0.16, 0.115, true);
  hands.minute = hand(1.36, 0.055, 0.2, 0.14, true);
  const sec = new THREE.Group();
  const bar = new THREE.Mesh(new RoundedBoxGeometry(0.018, 1.9, 0.01, 1, 0.004), M.goldMirror);
  bar.position.y = 0.55;
  sec.add(bar);
  const cw = cyl(0.055, 0.012, M.goldMirror, 32);
  cw.position.y = -0.24;
  sec.add(cw);
  const tip = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.14, 0.012, 1, 0.005), M.lume);
  tip.position.set(0, 1.32, 0.004);
  sec.add(tip);
  sec.add(cyl(0.045, 0.03, M.goldMirror, 32));
  sec.position.z = 0.165;
  g.add(sec);
  hands.second = sec;
  layer("hands", g, { dz: 2.1, order: 2, label: "Стрелки", anchor: [0.4, 1.2, 0.14] });
}

// 10. Безель
{
  const m = new THREE.Mesh(lathe([[1.7, 0.36], [2.05, 0.36], [2.09, 0.42], [2.03, 0.51], [1.82, 0.54], [1.7, 0.5], [1.7, 0.36]]), M.steel);
  layer("bezel", new THREE.Group().add(m), { dz: 2.85, order: 1, label: "Безель", anchor: [1.5, 1.45, 0.45] });
}

// 11. Сапфировое стекло
{
  const prof = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    prof.push([1.74 * t, 0.56 - 0.08 * t * t]);
  }
  for (let i = 12; i >= 0; i--) {
    const t = i / 12;
    prof.push([1.74 * t, 0.5 - 0.08 * t * t]);
  }
  const m = new THREE.Mesh(lathe(prof, 128), M.glass);
  layer("crystal", new THREE.Group().add(m), { dz: 3.6, order: 0, label: "Сапфировое стекло", anchor: [-1.3, 1.0, 0.5] });
}

const ORDER_COUNT = 5;
const DZ_SCALE = 0.78; // насколько далеко расходятся слои

// ---------- метки деталей ----------
const labelNodes = layers.map((l) => {
  const el = document.createElement("div");
  el.className = "part-label";
  el.innerHTML = `<span class="pl-dot"></span><span class="pl-line"></span><span class="pl-text">${l.label}</span>`;
  labelsEl.appendChild(el);
  return el;
});

// ---------- прокрутка, ползунок, курсор ----------
let target = 0;    // целевая степень разборки
let current = 0;   // сглаженная
let scrollP = 0;
let dragging = false;

function sectionProgress() {
  const r = section.getBoundingClientRect();
  const total = section.offsetHeight - window.innerHeight;
  return total > 0 ? clamp01(-r.top / total) : 0;
}

function onScroll() {
  scrollP = sectionProgress();
  if (!dragging) target = explodeFromScroll(scrollP);
}
window.addEventListener("scroll", onScroll, { passive: true });

slider.addEventListener("input", () => {
  dragging = true;
  target = slider.value / 1000;
  const total = section.offsetHeight - window.innerHeight;
  const top = section.getBoundingClientRect().top + window.scrollY;
  window.scrollTo({ top: top + scrollFromExplode(target) * total, behavior: "instant" });
});
const endDrag = () => { dragging = false; };
slider.addEventListener("change", endDrag);
slider.addEventListener("pointerup", endDrag);

const pointer = { x: 0, y: 0 };
window.addEventListener("pointermove", (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
});

// ---------- размер и камера ----------
let W = 1, H = 1, portrait = false;
function resize() {
  W = canvas.clientWidth;
  H = canvas.clientHeight;
  portrait = W / H < 0.9;
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  // Подписи: на широком экране над деталями в три яруса, на узком — по бокам.
  let k = 0;
  layers.forEach((l, i) => {
    if (l.key === "crown") {
      l.side = portrait ? "right" : "bottom";
      l.len = 40;
    } else {
      l.side = portrait ? (k % 2 ? "left" : "right") : "top";
      l.len = portrait ? 22 : [30, 78, 126][k % 3];
      k++;
    }
    l.tw = 0; // ширину подписи перемерить под новый размер шрифта
    labelNodes[i].dataset.side = l.side;
    labelNodes[i].style.setProperty("--len", `${l.len}px`);
  });
}
window.addEventListener("resize", resize);

const tmpV = new THREE.Vector3();
const lookAt = new THREE.Vector3();

function placeCamera(e) {
  const aspect = W / H;
  // Собранные — вид на циферблат. При разборке камера облетает часы на сторону
  // механизма: колеса, мосты и ротор обращены к зрителю, стопка расходится веером.
  const ce = smoothstep(0, 1, e);
  // на узком экране камера заходит почти сзади — стопка встает вертикальной башней
  const az = portrait ? lerp(-0.2, 2.95, ce) : lerp(-0.34, 2.0, ce);
  const el = portrait ? lerp(0.2, 0.9, ce) : lerp(0.2, 0.36, ce);
  const dA = portrait ? fitDistance(5.2, 5.2, camera.fov, aspect, 1.4) : fitDistance(5.2 * 2.1, 5.2, camera.fov, aspect, 1.12);
  const dE = portrait ? fitDistance(5.6, 9.2, camera.fov, aspect, 1.06) : fitDistance(10.4, 7.6, camera.fov, aspect, 1.02);
  const d = lerp(dA, dE, ce);
  camera.position.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
  lookAt.set(0, 0, lerp(0, -0.25, e));
  camera.position.add(lookAt);
  camera.lookAt(lookAt);
  // на широком экране собранные часы стоят справа от заголовка,
  // разобранные — чуть ниже центра, под подписью сверху
  const shiftX = portrait ? 0 : 0.22 * (1 - smoothstep(0, 0.6, e));
  // на телефоне собранные часы стоят под заголовком, а не поверх него
  const shiftY = portrait ? -0.2 * (1 - smoothstep(0, 0.5, e)) : -0.04 * smoothstep(0.4, 1, e);
  camera.setViewOffset(W, H, -W * shiftX, H * shiftY, W, H);
}

// ---------- подписи ----------
// Точка на краю детали с той стороны, где стоит подпись (в пикселях экрана).
function anchorPoint(l, side) {
  const [ax, ay, az] = l.anchor;
  const r = Math.hypot(ax, ay);
  if (l.key === "crown") tmpV.set(ax, ay, az);
  else if (side === "top") tmpV.set(0, r, az);
  else if (side === "bottom") tmpV.set(0, -r, az);
  else tmpV.set(side === "right" ? r : -r, 0, az);
  l.group.localToWorld(tmpV);
  tmpV.project(camera);
  return { x: (tmpV.x * 0.5 + 0.5) * W, y: (-tmpV.y * 0.5 + 0.5) * H };
}

// Узкий экран: подписи по бокам, соседние по высоте — на разные стороны.
// Не влезает текст — подпись уходит на другую сторону или прижимается к краю.
const SIDE_LEN = 16;
function placeSideLabels(pts) {
  // головка тоже в общем чередовании — иначе на телефоне налезает на «Корпус»
  const idx = layers.map((_, i) => i).sort((a, b) => pts[a].y - pts[b].y);
  const placed = []; // прямоугольники уже поставленных подписей
  idx.forEach((i, rank) => {
    const l = layers[i];
    const node = labelNodes[i];
    if (!l.tw) {
      const t = node.querySelector(".pl-text");
      l.tw = t.offsetWidth;
      l.th = t.offsetHeight;
    }
    const pr = anchorPoint(l, "right");
    const pl = anchorPoint(l, "left");
    const fitsR = pr.x + SIDE_LEN + l.tw <= W - 6;
    const fitsL = pl.x - SIDE_LEN - l.tw >= 6;
    let side = rank % 2 ? "left" : "right";
    if (side === "right" && !fitsR && fitsL) side = "left";
    else if (side === "left" && !fitsL && fitsR) side = "right";
    const p = side === "right" ? pr : pl;
    // текст целиком на экране, даже если сама точка ушла за край
    const L = side === "right" ? p.x + SIDE_LEN : p.x - SIDE_LEN - l.tw;
    const tx = Math.min(Math.max(L, 6), W - 6 - l.tw) - L;
    // подписи не наезжают друг на друга (в том числе с разных сторон) — сдвигаем вниз
    const x0 = L + tx;
    let ty = 0;
    for (let guard = 0; guard < 12; guard++) {
      const top = p.y - l.th / 2 + ty;
      const hit = placed.find((r) => x0 < r.r && r.l < x0 + l.tw && top < r.b && r.t < top + l.th);
      if (!hit) break;
      ty = hit.b + 3 - (p.y - l.th / 2);
    }
    placed.push({ l: x0, r: x0 + l.tw, t: p.y - l.th / 2 + ty, b: p.y - l.th / 2 + ty + l.th });
    pts[i] = p;
    node.dataset.side = side;
    node.style.setProperty("--len", `${SIDE_LEN}px`);
    node.style.setProperty("--tx", `${tx.toFixed(0)}px`);
    node.style.setProperty("--ty", `${ty.toFixed(0)}px`);
  });
}

// ---------- кадр ----------
let visible = true;
new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(section);

const clock = new THREE.Clock();
let lastLabels = -1;

function frame() {
  requestAnimationFrame(frame);
  if (!visible) return;
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  current += (target - current) * (1 - Math.exp(-dt * 7));
  if (Math.abs(target - current) < 1e-4) current = target;

  // механизм идет
  const esc = escapeAngle(t, BEAT_HZ, TEETH[TEETH.length - 1]);
  trainAngles(esc, TEETH, BASES).forEach((a, i) => { wheels[i].rotation.z = a; });
  ratchet.rotation.z = wheels[0].rotation.z * 0.9;
  const ba = balanceAngle(t, BEAT_HZ, 1.9);
  balance.rotation.z = ba;
  hairspring.rotation.z = ba * 0.55;
  hairspring.scale.setScalar(1 + 0.03 * Math.sin(Math.PI * BEAT_HZ * t));
  rotor.rotation.z = Math.sin(t * 0.35) * 2.2;
  const ha = handAngles(new Date(), BEAT_HZ);
  hands.hour.rotation.z = -ha.hour;
  hands.minute.rotation.z = -ha.minute;
  hands.second.rotation.z = -ha.second;

  // разборка по слоям
  for (const l of layers) {
    l.t = layerProgress(current, l.order, ORDER_COUNT);
    l.group.position.z = l.dz * (portrait ? 0.95 : DZ_SCALE) * l.t;
    l.group.position.x = (l.dx || 0) * l.t;
  }
  hands.second.position.z = 0.165 + 0.45 * layers.find((l) => l.key === "hands").t;
  hands.minute.position.z = 0.14 + 0.22 * layers.find((l) => l.key === "hands").t;

  // легкий наклон за курсором + медленное «дыхание»
  watch.rotation.y += (pointer.x * 0.18 - watch.rotation.y) * 0.05;
  watch.rotation.x += (pointer.y * 0.12 - watch.rotation.x) * 0.05;
  watch.position.y = Math.sin(t * 0.8) * 0.04;

  placeCamera(current);
  renderer.render(scene, camera);

  // UI
  if (!dragging) slider.value = String(Math.round(current * 1000));
  sliderVal.textContent = `${Math.round(current * 100)}%`;
  introEl.style.opacity = String(1 - smoothstep(0.02, 0.1, scrollP));
  introEl.style.transform = `translateY(${-40 * smoothstep(0.02, 0.1, scrollP)}px)`;
  outroEl.style.opacity = String(smoothstep(0.76, 0.86, scrollP));

  const labelAlpha = smoothstep(0.72, 0.95, current);
  if (labelAlpha > 0 || lastLabels > 0) {
    watch.updateMatrixWorld();
    const pts = layers.map((l) => anchorPoint(l, l.side));
    if (portrait) placeSideLabels(pts);
    // Верхние подписи выстраиваются в три ряда по порядку слева направо,
    // линии тянутся от ряда вниз к своей детали — как на техническом чертеже.
    const tops = layers.map((_, i) => i).filter((i) => layers[i].side === "top").sort((a, b) => pts[a].x - pts[b].x);
    if (tops.length) {
      const minY = Math.min(...tops.map((i) => pts[i].y));
      tops.forEach((i, rank) => {
        const rowY = Math.max(96, minY - 34 - (rank % 3) * 40);
        labelNodes[i].style.setProperty("--len", `${Math.max(12, pts[i].y - rowY).toFixed(0)}px`);
      });
    }
    layers.forEach((l, i) => {
      const node = labelNodes[i];
      node.style.transform = `translate3d(${pts[i].x.toFixed(1)}px, ${pts[i].y.toFixed(1)}px, 0)`;
      node.style.opacity = String(labelAlpha);
    });
  }
  lastLabels = labelAlpha;
}

// Надписи на циферблате рисуются шрифтом Oswald — дождаться его.
async function start() {
  try {
    await Promise.race([document.fonts.load("700 100px Oswald"), new Promise((r) => setTimeout(r, 1500))]);
  } catch (_) { /* шрифт не обязателен */ }
  M.dial.map.image.getContext("2d").clearRect(0, 0, 1, 1);
  dialDraw(M.dial.map.image.getContext("2d"), M.dial.map.image.width);
  M.dial.map.needsUpdate = true;
  resize();
  onScroll();
  current = target;
  document.querySelectorAll("[data-count-parts]").forEach((el) => { el.dataset.count = String(partCount); });
  document.documentElement.classList.add("webgl-ready");
  window.__watchReady = { parts: partCount, layers: layers.length };
  frame();
}
start();
