// Чистая математика сцены: без three.js и DOM, поэтому покрыта тестами.

export const TAU = Math.PI * 2;

export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const mod = (x, m) => ((x % m) + m) % m;

export function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

// ---------- прокрутка <-> степень разборки ----------
// Первые HOLD_START секции часы стоят собранными (читается заголовок),
// к EXPLODE_END разобраны полностью, дальше — пауза с подписями деталей.
export const HOLD_START = 0.1;
export const EXPLODE_END = 0.72;

export function explodeFromScroll(p) {
  return clamp01((p - HOLD_START) / (EXPLODE_END - HOLD_START));
}

export function scrollFromExplode(e) {
  return HOLD_START + clamp01(e) * (EXPLODE_END - HOLD_START);
}

// Слой с порядком order (0 — уходит первым) из count групп.
// Окна слоев перекрываются — детали расходятся волной, а не по очереди.
export function layerProgress(e, order, count, win = 0.5) {
  if (count <= 1) return smoothstep(0, 1, e);
  const step = (1 - win) / (count - 1);
  const start = order * step;
  return smoothstep(start, start + win, e);
}

// ---------- зубчатая передача ----------
// Колесо 1 (n1 зубьев, зубья на углах a1 + k*2π/n1) касается колеса 2
// в направлении phi. Возвращает угол колеса 2, при котором зуб одного
// входит во впадину другого.
export function meshPhase(a1, n1, phi, n2) {
  const p1 = TAU / n1;
  const p2 = TAU / n2;
  const f1 = mod((phi - a1) / p1, 1);
  return phi + Math.PI - p2 * mod(0.5 - f1, 1);
}

// Начальные углы цепочки колес: teeth[i] — число зубьев,
// dirs[i] — направление от колеса i к колесу i+1.
export function trainBases(teeth, dirs) {
  const bases = [0];
  for (let i = 0; i < teeth.length - 1; i++) {
    bases.push(meshPhase(bases[i], teeth[i], dirs[i], teeth[i + 1]));
  }
  return bases;
}

// Углы всей цепочки, когда последнее колесо (спуск) повернулось на drive.
// Соседние колеса крутятся в разные стороны, скорость обратна числу зубьев.
export function trainAngles(drive, teeth, bases) {
  const last = teeth.length - 1;
  return teeth.map((n, i) => {
    const sign = (last - i) % 2 === 0 ? 1 : -1;
    return bases[i] + sign * drive * (teeth[last] / n);
  });
}

// Спуск «тикает»: на каждый полупериод баланса колесо делает быстрый
// скачок на полшага зуба и замирает — так идут настоящие механические часы.
export function escapeAngle(t, beatHz, teeth) {
  const beats = t * beatHz;
  const k = Math.floor(beats);
  const jump = smoothstep(0, 0.22, beats - k);
  return (TAU / teeth / 2) * (k + jump);
}

// Угол баланса: проходит ноль ровно в момент тика спуска.
export function balanceAngle(t, beatHz, amplitude) {
  return amplitude * Math.sin(Math.PI * beatHz * t);
}

// ---------- время на стрелках ----------
// Секундная идет шагами beatHz в секунду, как у механики, а не плавно.
export function handAngles(date, beatHz = 5) {
  const ms = date.getMilliseconds();
  const s = date.getSeconds() + Math.floor((ms / 1000) * beatHz) / beatHz;
  const m = date.getMinutes() + s / 60;
  const h = (date.getHours() % 12) + m / 60;
  return { hour: (h / 12) * TAU, minute: (m / 60) * TAU, second: (s / 60) * TAU };
}

// ---------- камера ----------
// Дистанция, с которой объект w×h целиком входит в кадр.
export function fitDistance(w, h, fovDeg, aspect, margin = 1.1) {
  const tanHalf = Math.tan((fovDeg * Math.PI) / 360);
  return Math.max(h / 2 / tanHalf, w / 2 / (tanHalf * aspect)) * margin;
}
