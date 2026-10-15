/* =========================================================================
   GAME.JS — игрок, враги, оружие, волны и отрисовка.

   Слой намеренно без зависимостей и без сборки: страница должна открыться
   двойным кликом, потому что рекрутер не должен ничего ставить.
   ========================================================================= */

const TUNE = {
  player: {
    speed: 6.2, sprint: 9.0, accel: 46, friction: 14,
    radius: 0.45,
    hp: 100, regenDelay: 3.6, regenRate: 11,
    dashSpeed: 26, dashTime: 0.17, dashCd: 1.6,
  },
  gun: {
    damage: 9, rate: 0.115, mag: 24, reload: 1.25,
    speed: 46, life: 0.85, spread: 0.035,
  },
  nade: { speed: 15, fuse: 1.4, radius: 4.6, damage: 78, cd: 5.5 },
  grunt: {
    hp: 45, speed: 3.5, radius: 0.5, damage: 8,
    telegraph: 0.6, rate: 1.35, range: 17, prefer: 9,
    bulletSpeed: 21, accuracy: 0.17, aggro: 19, turn: 5.0,
  },
  elite: {
    hp: 260, speed: 3.9, radius: 0.95, damage: 11,
    telegraph: 0.9, rate: 1.9, range: 21, prefer: 11,
    bulletSpeed: 24, accuracy: 0.13, aggro: 26, turn: 3.2, burst: 3,
  },
  cam: { scale: 13, minScale: 8, maxScale: 22 },
};

let canvas, ctx, shadow, shadowCtx;
let player, enemies, bullets, nades, parts, snow;
let waves, readCount, playerZone, runTime;
let cam = { x: 0, y: 0, scale: TUNE.cam.scale, shake: 0 };

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const angTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/* --- статистика прохождения: это и есть данные для отчёта -------------- */
const stats = {
  shots: 0, hits: 0, damageTaken: 0, kills: 0, deaths: 0,
  firstContactAt: null, lastZoneAt: null,
  zoneEnter: {}, zoneSeconds: {},
  intensity: [], intensityAcc: 0,
  nadesUsed: 0, dashesUsed: 0,
};

function resetRun() {
  const [sx, sy] = MAP.meta.start || [4, 18];
  const [wx, wy] = cellToWorld(sx, sy);
  player = {
    x: wx, y: wy, vx: 0, vy: 0, angle: -Math.PI / 2,
    hp: TUNE.player.hp, sinceHit: 99, dashT: 0, dashCd: 0, dashDx: 0, dashDy: 0,
    ammo: TUNE.gun.mag, reloadT: 0, fireCd: 0, nadeCd: 0,
    lastZone: null, moving: 0,
  };
  enemies = []; bullets = []; nades = []; parts = [];
  waves = { B: blank(), C: blank(), C2: blank(), D: blank(), D2: blank() };
  readCount = 0;
  playerZone = "A";
  runTime = 0;

  snow = Array.from({ length: 150 }, () => ({
    x: Math.random() * MAP_PX_W, y: Math.random() * MAP_PX_H,
    z: rnd(0.25, 1), r: rnd(0.5, 1.9),
  }));

  stats.shots = 0; stats.hits = 0; stats.damageTaken = 0; stats.kills = 0;
  stats.deaths = 0; stats.firstContactAt = null; stats.lastZoneAt = null;
  stats.zoneEnter = {}; stats.zoneSeconds = { A: 0, B: 0, C: 0, D: 0 };
  stats.intensity = []; stats.intensityAcc = 0; stats.nadesUsed = 0; stats.dashesUsed = 0;
  readSet = new Set();

  cam.x = player.x; cam.y = player.y; cam.shake = 0;
  refreshDoors();
}
const blank = () => ({ armedAt: null, active: false, done: false, killed: 0, spawned: 0, t0: 0 });
let readSet = new Set();

const LIGHTS = buildLights();

/* --- столкновения ------------------------------------------------------- */
/** Движение по сетке: шаг режется на подшаги, иначе игрок проходит сквозь
    стену на большой скорости. Это самая частая ошибка в таком коде.       */
function moveWithCollision(e, dx, dy) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.25));
  const sx = dx / steps, sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    const [cx, cy] = worldToCell(e.x + sx, e.y);
    if (!blocksMove(cx, cy)) e.x += sx;
    const [dx2, dy2] = worldToCell(e.x, e.y + sy);
    if (!blocksMove(dx2, dy2)) e.y += sy;
  }
}

function circleBlocked(x, y, r) {
  for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
    if (blocksMove(...worldToCell(x + ox, y + oy))) return true;
  }
  return false;
}

/* --- создание сущностей -------------------------------------------------- */
function makeEnemy(spawn, elite, waveId) {
  const T = elite ? TUNE.elite : TUNE.grunt;
  const [wx, wy] = cellToWorld(spawn.cell[0], spawn.cell[1]);
  return {
    x: wx, y: wy, vx: 0, vy: 0, angle: 0,
    hp: T.hp, maxHp: T.hp, radius: T.radius, T, elite, waveId,
    state: "hunt", tel: 0, fireCd: rnd(0.4, 1.1), burstLeft: 0, burstT: 0,
    strafe: Math.random() < 0.5 ? 1 : -1, strafeT: rnd(0.6, 1.6),
    flash: 0, spawnT: 0.45, vel: 0,
  };
}

function spawnEnemy(spawn, wave) {
  const e = makeEnemy(spawn, wave.elite, wave.id);
  enemies.push(e);
  burst(e.x, e.y, e.elite ? 22 : 12, e.elite ? "#ffb347" : "#7fe3ff", 3);
}

/* --- частицы -------------------------------------------------------------- */
function burst(x, y, n, color, speed, life) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = rnd(speed * 0.3, speed);
    parts.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: life || rnd(0.25, 0.6), max: life || 0.6, color, r: rnd(1, 2.6),
    });
  }
}

/* --- стрельба -------------------------------------------------------------- */
function firePlayer() {
  if (player.reloadT > 0 || player.fireCd > 0 || player.ammo <= 0) return;
  player.ammo--;
  player.fireCd = TUNE.gun.rate;
  stats.shots++;
  const a = player.angle + rnd(-TUNE.gun.spread, TUNE.gun.spread);
  bullets.push({
    x: player.x + Math.cos(a) * 0.8, y: player.y + Math.sin(a) * 0.8,
    vx: Math.cos(a) * TUNE.gun.speed, vy: Math.sin(a) * TUNE.gun.speed,
    life: TUNE.gun.life, dmg: TUNE.gun.damage, owner: "p", trail: [],
  });
  burst(player.x + Math.cos(a), player.y + Math.sin(a), 4, "#ffe6a8", 4, 0.18);
  cam.shake = Math.min(cam.shake + 1.1, 5);
}

function fireEnemy(e) {
  const T = e.T;
  const a = e.angle + rnd(-T.accuracy, T.accuracy);
  bullets.push({
    x: e.x + Math.cos(a) * (e.radius + 0.25), y: e.y + Math.sin(a) * (e.radius + 0.25),
    vx: Math.cos(a) * T.bulletSpeed, vy: Math.sin(a) * T.bulletSpeed,
    life: 1.5, dmg: T.damage, owner: "e", trail: [],
  });
  burst(e.x + Math.cos(a), e.y + Math.sin(a), 3, "#ff9c5a", 3, 0.16);
}

function throwNade() {
  if (player.nadeCd > 0) return;
  player.nadeCd = TUNE.nade.cd;
  stats.nadesUsed++;
  nades.push({
    x: player.x + Math.cos(player.angle) * 1.1,
    y: player.y + Math.sin(player.angle) * 1.1,
    vx: Math.cos(player.angle) * TUNE.nade.speed,
    vy: Math.sin(player.angle) * TUNE.nade.speed,
    fuse: TUNE.nade.fuse,
  });
}

function detonate(x, y) {
  burst(x, y, 40, "#ffb347", 12, 0.7);
  burst(x, y, 22, "#fff2cf", 6, 0.4);
  cam.shake = Math.min(cam.shake + 8, 14);
  for (const e of enemies) {
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < TUNE.nade.radius) hurtEnemy(e, TUNE.nade.damage * (1 - d / TUNE.nade.radius));
  }
}

/* --- урон ------------------------------------------------------------------ */
function hurtEnemy(e, dmg) {
  e.hp -= dmg;
  e.flash = 0.12;
  stats.hits++;
  burst(e.x, e.y, 4, e.elite ? "#ffd28a" : "#9fe8ff", 3.5, 0.3);
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  e.dead = true;
  stats.kills++;
  const w = waves[e.waveId];
  if (w) w.killed++;
  burst(e.x, e.y, e.elite ? 60 : 22, e.elite ? "#ffb347" : "#7fe3ff", e.elite ? 11 : 6, 0.75);
  if (e.elite) { cam.shake = Math.min(cam.shake + 9, 16); }
}

function hurtPlayer(dmg) {
  if (player.dashT > 0) return; // рывок спасает: это не неуязвимость, а тайминг
  player.hp -= dmg;
  player.sinceHit = 0;
  stats.damageTaken += dmg;
  cam.shake = Math.min(cam.shake + 4, 12);
  burst(player.x, player.y, 8, "#ff6b6b", 5, 0.4);
  if (player.hp <= 0) die();
}

function die() {
  stats.deaths++;
  burst(player.x, player.y, 40, "#ff5a5a", 9, 0.9);
  cam.shake = 14;
  onDeath();
}

/* --- волны ----------------------------------------------------------------- */
function updateWaves(dt) {
  for (const w of WAVES) {
    const s = waves[w.id];
    if (s.done) continue;
    if (!s.active) {
      let cond = false;
      try { cond = w.cond(); } catch (e) { cond = false; }
      if (!cond) { s.armedAt = null; continue; }
      if (s.armedAt === null) s.armedAt = runTime;
      if (runTime - s.armedAt >= w.delay) {
        s.active = true; s.t0 = runTime;
        onWaveStart(w);
      }
    }
    if (s.active) {
      const t = runTime - s.t0;
      while (s.spawned < w.spawns.length && w.spawns[s.spawned].delay <= t) {
        spawnEnemy(w.spawns[s.spawned], w);
        s.spawned++;
      }
      const live = enemies.filter((e) => e.waveId === w.id && !e.dead).length;
      if (s.spawned >= w.spawns.length && live === 0) {
        s.done = true;
        onWaveDone(w);
      }
    }
  }
}

/* --- ИИ -------------------------------------------------------------------- */
function updateEnemy(e, dt) {
  if (e.dead) return;
  const T = e.T;
  if (e.spawnT > 0) { e.spawnT -= dt; return; }
  e.flash = Math.max(0, e.flash - dt);

  const dx = player.x - e.x, dy = player.y - e.y;
  const dist = Math.hypot(dx, dy);
  const want = Math.atan2(dy, dx);
  const sees = dist < T.aggro && canSee(e.x, e.y, player.x, player.y);

  // доворот корпуса: дрон тяжёлый, он не может мгновенно развернуться
  e.angle += clamp(angDiff(e.angle, want), -T.turn * dt, T.turn * dt);

  let mvx = 0, mvy = 0;

  if (!sees) {
    // патруль: короткие рывки в сторону последней замеченной цели
    if (e.state !== "patrol") { e.state = "patrol"; e.vel = T.speed * 0.45; }
    const a = e.angle + Math.PI / 2;
    mvx = Math.cos(a) * e.vel; mvy = Math.sin(a) * e.vel;
  } else {
    if (e.state === "patrol") { e.state = "hunt"; onFirstContact(); }
    e.tel = Math.min(e.tel + dt, T.telegraph);

    e.strafeT -= dt;
    if (e.strafeT <= 0) { e.strafe = Math.random() < 0.5 ? 1 : -1; e.strafeT = rnd(0.7, 1.8); }

    // держит дистанцию и кружит: «танцевать» проще, чем стоять на линии
    const err = dist - T.prefer;
    const radial = clamp(err / 6, -1, 1);
    const tang = e.strafe * 0.75;
    const a = Math.atan2(dy, dx);
    mvx = (Math.cos(a) * radial + Math.cos(a + Math.PI / 2) * tang) * T.speed;
    mvy = (Math.sin(a) * radial + Math.sin(a + Math.PI / 2) * tang) * T.speed;

    if (dist < 4 && !e.elite) { // вблизи отходит, чтобы не слипаться
      mvx = -Math.cos(a) * T.speed; mvy = -Math.sin(a) * T.speed;
    }

    // залп у элиты
    if (e.burstLeft > 0) {
      e.burstT -= dt;
      if (e.burstT <= 0) { fireEnemy(e); e.burstLeft--; e.burstT = 0.16; }
    } else {
      e.fireCd -= dt;
      if (e.fireCd <= 0 && e.tel >= T.telegraph) {
        if (e.elite) { e.burstLeft = T.burst - 1; e.burstT = 0; }
        else { fireEnemy(e); }
        e.fireCd = T.rate + rnd(0, 0.3);
        e.tel = 0;
      }
    }
  }

  moveWithCollision(e, mvx * dt, mvy * dt);

  // контактный урон: если подошёл вплотную
  if (dist < e.radius + TUNE.player.radius + 0.15 && e.spawnT <= 0) {
    hurtPlayer(T.damage * dt * 1.4);
  }
}

/* --- обновление ------------------------------------------------------------ */
/** Только движка: снег, частицы, камера. Идёт и после смерти игрока. */
function updateAmbient(dt) {
  for (const q of parts) {
    q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt;
    q.vx *= 0.9; q.vy *= 0.9;
  }
  parts = parts.filter((q) => q.life > 0);
  for (const b of bullets) b.life -= dt;
  bullets = bullets.filter((b) => b.life > 0);
  for (const s of snow) {
    s.y += (10 + s.z * 26) * dt;
    s.x += Math.sin(runTime * 0.6 + s.z * 9) * 9 * dt;
    if (s.y > MAP_PX_H) { s.y = -2; s.x = Math.random() * MAP_PX_W; }
  }
  cam.x = lerp(cam.x, player.x, clamp(4 * dt, 0, 1));
  cam.y = lerp(cam.y, player.y, clamp(4 * dt, 0, 1));
  cam.shake *= 0.9;
}

function update(dt) {
  runTime += dt;
  refreshDoors();

  const p = player;

  // после смерти управление отдаётся движению частиц: игрок уже не может
  // стрелять, но взрыв должен долететь, а экран отчёта — появиться позже
  if (p.hp <= 0) { updateAmbient(dt); return; }

  p.fireCd -= dt;
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.nadeCd = Math.max(0, p.nadeCd - dt);
  p.sinceHit += dt;

  // восстановление: не сразу, иначе бой превращается в стоянку
  if (p.sinceHit > TUNE.player.regenDelay && p.hp < TUNE.player.hp) {
    p.hp = Math.min(TUNE.player.hp, p.hp + TUNE.player.regenRate * dt);
  }

  // цель: ближайший терминал в зоне действия
  const aim = inputAimWorld();
  p.angle = aim.angle;

  // Клавиши читаются по e.code, а не по e.key: code не зависит от раскладки,
  // поэтому WASD работает и на кириллице.
  let ax = 0, ay = 0;
  if (keys.KeyW || keys.ArrowUp) ay -= 1;
  if (keys.KeyS || keys.ArrowDown) ay += 1;
  if (keys.KeyA || keys.ArrowLeft) ax -= 1;
  if (keys.KeyD || keys.ArrowRight) ax += 1;
  const mag = Math.hypot(ax, ay);
  if (mag > 0) { ax /= mag; ay /= mag; }
  p.moving = mag;

  if (p.dashT > 0) {
    p.dashT -= dt;
    p.vx = p.dashDx * TUNE.player.dashSpeed;
    p.vy = p.dashDy * TUNE.player.dashSpeed;
  } else {
    const sprinting = (keys.ShiftLeft || keys.ShiftRight) && mag > 0;
    const max = sprinting ? TUNE.player.sprint : TUNE.player.speed;
    p.vx = lerp(p.vx, ax * max, clamp(TUNE.player.accel * dt, 0, 1));
    p.vy = lerp(p.vy, ay * max, clamp(TUNE.player.accel * dt, 0, 1));
    if (mag === 0) {
      p.vx = lerp(p.vx, 0, clamp(TUNE.player.friction * dt, 0, 1));
      p.vy = lerp(p.vy, 0, clamp(TUNE.player.friction * dt, 0, 1));
    }
  }
  moveWithCollision(p, p.vx * dt, p.vy * dt);

  if (p.reloadT > 0) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) p.ammo = TUNE.gun.mag;
  } else if (p.ammo === 0) {
    p.reloadT = TUNE.gun.reload;
  }
  if (inputFire) firePlayer();

  for (const e of enemies) updateEnemy(e, dt);
  updateWaves(dt);

  // зона игрока и её время — идёт в отчёт
  const [pcx, pcy] = worldToCell(p.x, p.y);
  const z = zoneAtCell(pcx, pcy);
  const zid = z ? z.id : playerZone;
  if (zid !== playerZone) {
    if (stats.zoneEnter[zid] === undefined) stats.zoneEnter[zid] = runTime;
    playerZone = zid;
  }
  if (stats.zoneSeconds[zid] !== undefined) stats.zoneSeconds[zid] += dt;
  stats.lastZoneAt = runTime;

  // кривая темпа: считаем «давление» — сколько врагов рядом и стреляют
  let pressure = 0;
  for (const e of enemies) {
    if (e.dead || e.spawnT > 0) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    pressure += (e.elite ? 1.6 : 1) * clamp(1 - d / 26, 0, 1);
  }
  // интенсивность — «давление» на игрока: сколько врагов рядом и насколько близко
  const inst = clamp(pressure / 3.2, 0, 1);
  stats.intensityAcc += inst * dt;
  if (stats.intensityAcc >= 0.5) {
    stats.intensityAcc -= 0.5;
    stats.intensity.push({ t: runTime, v: inst });
  }

  // снаряды
  for (const b of bullets) {
    b.life -= dt;
    b.trail.push(b.x, b.y);
    if (b.trail.length > 12) b.trail.splice(0, 2);
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      b.x += b.vx * dt / steps; b.y += b.vy * dt / steps;
      const [cx, cy] = worldToCell(b.x, b.y);
      if (blocksSight(cx, cy)) {
        b.life = 0;
        burst(b.x, b.y, 5, "#cfd8e3", 3.5, 0.25);
        break;
      }
      if (b.owner === "p") {
        for (const e of enemies) {
          if (e.dead || e.spawnT > 0) continue;
          if (Math.hypot(e.x - b.x, e.y - b.y) < e.radius) {
            hurtEnemy(e, b.dmg); b.life = 0; break;
          }
        }
      } else if (Math.hypot(p.x - b.x, p.y - b.y) < TUNE.player.radius) {
        hurtPlayer(b.dmg); b.life = 0;
      }
      if (b.life <= 0) break;
    }
  }
  bullets = bullets.filter((b) => b.life > 0);

  // гранаты
  for (const n of nades) {
    n.x += n.vx * dt; n.y += n.vy * dt;
    n.vx *= 0.9; n.vy *= 0.9;
    n.fuse -= dt;
    if (circleBlocked(n.x, n.y, 0.3)) { n.vx *= -0.55; n.vy *= -0.55; n.x += n.vx * dt; n.y += n.vy * dt; }
    if (n.fuse <= 0) { n.done = true; detonate(n.x, n.y); }
  }
  nades = nades.filter((n) => !n.done);

  // частицы
  for (const q of parts) {
    q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt;
    q.vx *= 0.9; q.vy *= 0.9;
  }
  parts = parts.filter((q) => q.life > 0);
  enemies = enemies.filter((e) => !e.dead);

  // снег
  for (const s of snow) {
    s.y += (10 + s.z * 26) * dt;
    s.x += Math.sin(runTime * 0.6 + s.z * 9) * 9 * dt;
    if (s.y > MAP_PX_H) { s.y = -2; s.x = Math.random() * MAP_PX_W; }
  }

  // камера
  cam.x = lerp(cam.x, p.x, clamp(7 * dt, 0, 1));
  cam.y = lerp(cam.y, p.y, clamp(7 * dt, 0, 1));
  cam.shake *= 0.86;
}

/* =========================================================================
   ОТРИСОВКА
   ========================================================================= */

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // карта теней рисуется в половинном разрешении: радиальные градиенты
  // — самая дорогая операция, а разницы глаз не замечает
  shadow.width = Math.max(2, Math.floor(w / 2));
  shadow.height = Math.max(2, Math.floor(h / 2));
}

function worldToScreen(wx, wy) {
  const s = cam.scale;
  return [(wx - cam.x) * s + canvas.clientWidth / 2, (wy - cam.y) * s + canvas.clientHeight / 2];
}

function inputAimWorld() {
  // input.mouse уже хранится в координатах канваса: обработчик mousemove
  // сам вычитает положение канваса. Вычитать второй раз нельзя — прицел
  // уезжает на высоту шапки, и стрелять приходится мимо.
  const [sx, sy] = worldToScreen(player.x, player.y);
  return { angle: Math.atan2(input.mouse.y - sy, input.mouse.x - sx) };
}

/** Зона видимости игрока: конус фонаря плюс ближний круг. */
function playerVisibility() {
  return { half: 0.75, range: 26, near: 4.2, x: player.x, y: player.y, a: player.angle };
}

function drawFloor() {
  const [sx0, sy0] = [Math.floor((cam.x - canvas.clientWidth / 2 / cam.scale) / CELL) - 2,
                      Math.floor((cam.y - canvas.clientHeight / 2 / cam.scale) / CELL) - 2];
  const cols = Math.ceil(canvas.clientWidth / cam.scale / CELL) + 4;
  const rows = Math.ceil(canvas.clientHeight / cam.scale / CELL) + 4;
  const s = cam.scale;

  for (let cy = sy0; cy < sy0 + rows; cy++) {
    for (let cx = sx0; cx < sx0 + cols; cx++) {
      const t = tileAt(cx, cy);
      if (t === TILE.WALL) continue;
      const [x, y] = worldToScreen(cx * CELL, cy * CELL);
      const z = zoneAtCell(cx, cy);
      let col = "#131a22";
      if (z) col = z.id === "A" ? "#151d26" : z.id === "B" ? "#17202a" : z.id === "C" ? "#131c24" : "#1a1f2b";
      ctx.fillStyle = col;
      ctx.fillRect(x, y, s * CELL + 1, s * CELL + 1);

      // тонкая сетка блокаута: 2 м
      if (s * CELL > 14) {
        ctx.strokeStyle = "rgba(120,160,190,0.045)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, s * CELL, s * CELL);
      }
    }
  }
}

function drawWallsAndCovers() {
  const s = cam.scale, h = Math.max(3, s * 0.5);
  const [sx0, sy0] = [Math.floor((cam.x - canvas.clientWidth / 2 / cam.scale) / CELL) - 2,
                      Math.floor((cam.y - canvas.clientHeight / 2 / cam.scale) / CELL) - 2];
  const cols = Math.ceil(canvas.clientWidth / cam.scale / CELL) + 4;
  const rows = Math.ceil(canvas.clientHeight / cam.scale / CELL) + 4;

  // сначала «крыши» стен со смещением — иллюзия высоты на виде сверху
  for (let cy = sy0; cy < sy0 + rows; cy++) {
    for (let cx = sx0; cx < sx0 + cols; cx++) {
      if (tileAt(cx, cy) !== TILE.WALL) continue;
      const [x, y] = worldToScreen(cx * CELL, cy * CELL);
      const edge = tileAt(cx, cy - 1) !== TILE.WALL;
      ctx.fillStyle = "#1e2833";
      ctx.fillRect(x, y - (edge ? h : 0), s * CELL + 1, s * CELL + 1 + (edge ? h : 0));
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(x, y - (edge ? h : 0), s * CELL + 1, Math.max(1, h * 0.4));
    }
  }
  for (let cy = sy0; cy < sy0 + rows; cy++) {
    for (let cx = sx0; cx < sx0 + cols; cx++) {
      if (tileAt(cx, cy) !== TILE.COVER) continue;
      const [x, y] = worldToScreen(cx * CELL, cy * CELL);
      ctx.fillStyle = "#2b3540";
      ctx.fillRect(x, y, s * CELL + 1, s * CELL + 1);
      ctx.fillStyle = "#39454f";
      ctx.fillRect(x + 1, y + 1, s * CELL - 1, s * CELL * 0.32);
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, s * CELL, s * CELL);
    }
  }
}

function drawDoorsAndTerms() {
  const s = cam.scale;
  for (const d of DOORS) {
    const open = d.opens();
    const [x, y] = worldToScreen(d.cell[0] * CELL, d.cell[1] * CELL);
    ctx.save();
    ctx.globalAlpha = open ? 0.22 : 0.9;
    ctx.fillStyle = open ? "#7fe3ff" : "#ff9c5a";
    ctx.fillRect(x, y, s * CELL + 1, s * CELL + 1);
    if (!open) {
      ctx.strokeStyle = "#ffcf9a";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 3, y + 3, s * CELL - 6, s * CELL - 6);
    }
    ctx.restore();
  }
  for (const t of TERMINALS) {
    const [x, y] = worldToScreen(t.cell[0] * CELL, t.cell[1] * CELL);
    const read = readSet.has(t.id);
    const locked = t.locked && t.locked();
    const pulse = 0.5 + 0.5 * Math.sin(runTime * 3 + t.cell[0]);
    ctx.save();
    ctx.fillStyle = "#0e1a1f";
    ctx.fillRect(x + 2, y + 2, s * CELL - 4, s * CELL - 4);
    ctx.strokeStyle = locked ? "#5a6270" : read ? "#57e39b" : "#7fe3ff";
    ctx.lineWidth = 2;
    ctx.globalAlpha = read ? 0.75 : locked ? 0.5 : 0.7 + pulse * 0.3;
    ctx.strokeRect(x + 3, y + 3, s * CELL - 6, s * CELL - 6);
    ctx.globalAlpha = 1;
    ctx.fillStyle = locked ? "#5a6270" : read ? "#57e39b" : "#7fe3ff";
    const c = s * CELL / 2;
    ctx.beginPath(); ctx.arc(x + c, y + c, Math.max(2, s * 0.14), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function drawEntities() {
  const s = cam.scale;
  for (const e of enemies) {
    if (e.dead) continue;
    const [x, y] = worldToScreen(e.x, e.y);
    const r = e.radius * s;
    if (e.spawnT > 0) {
      const k = 1 - e.spawnT / 0.45;
      ctx.save();
      ctx.globalAlpha = k;
      ctx.strokeStyle = "#ff9c5a"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r * (2.4 - k * 1.4), 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(e.angle);
    // корпус
    ctx.fillStyle = e.flash > 0 ? "#ffffff" : e.elite ? "#4a3a2a" : "#2c3d4a";
    ctx.beginPath();
    ctx.moveTo(r * 1.15, 0);
    ctx.lineTo(-r * 0.75, r * 0.8);
    ctx.lineTo(-r * 0.35, 0);
    ctx.lineTo(-r * 0.75, -r * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = e.elite ? "#b98a4a" : "#5b7285";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // глаз-телеграф: жёлтый — заметили, белый — сейчас выстрел
    const tel = clamp(e.tel / e.T.telegraph, 0, 1);
    ctx.fillStyle = tel > 0.98 ? "#ffffff" : tel > 0.05 ? `rgb(255,${Math.floor(190 - tel * 120)},60)` : "#3b4d5c";
    ctx.beginPath(); ctx.arc(r * 0.42, 0, Math.max(2, r * 0.3), 0, Math.PI * 2); ctx.fill();
    if (tel > 0.05) {
      ctx.strokeStyle = "rgba(255,190,110,0.8)";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, r * (1.9 - tel * 0.5), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();

    // полоска здоровья, только если дрон ранен
    if (e.hp < e.maxHp) {
      const w = r * 1.6;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(x - w / 2, y - r - 8, w, 3);
      ctx.fillStyle = e.elite ? "#ffb347" : "#7fe3ff";
      ctx.fillRect(x - w / 2, y - r - 8, w * clamp(e.hp / e.maxHp, 0, 1), 3);
    }
  }

  // гранаты
  for (const n of nades) {
    const [x, y] = worldToScreen(n.x, n.y);
    ctx.fillStyle = "#ffd28a";
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
  }

  // игрок
  const [px, py] = worldToScreen(player.x, player.y);
  const pr = TUNE.player.radius * s;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(player.angle);
  ctx.globalAlpha = player.dashT > 0 ? 0.55 : 1;
  ctx.fillStyle = "#8ad7ff";
  ctx.beginPath();
  ctx.moveTo(pr * 1.2, 0); ctx.lineTo(-pr * 0.8, pr * 0.85);
  ctx.lineTo(-pr * 0.3, 0); ctx.lineTo(-pr * 0.8, -pr * 0.85);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#d8f4ff"; ctx.lineWidth = 1.3; ctx.stroke();
  // ствол
  ctx.strokeStyle = "#e8f6ff"; ctx.lineWidth = Math.max(2, s * 0.12);
  ctx.beginPath(); ctx.moveTo(pr * 0.9, 0); ctx.lineTo(pr * 1.85, 0); ctx.stroke();
  ctx.restore();
}

function drawBullets() {
  const s = cam.scale;
  for (const b of bullets) {
    const col = b.owner === "p" ? "#ffe6a8" : "#ff8a5a";
    if (b.trail.length >= 4) {
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = Math.max(1, s * 0.08);
      ctx.beginPath();
      ctx.moveTo(...worldToScreen(b.trail[b.trail.length - 2], b.trail[b.trail.length - 1]));
      ctx.lineTo(...worldToScreen(b.x, b.y));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const [x, y] = worldToScreen(b.x, b.y);
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1.6, s * 0.08), 0, Math.PI * 2); ctx.fill();
  }
  for (const q of parts) {
    const [x, y] = worldToScreen(q.x, q.y);
    ctx.globalAlpha = clamp(q.life / q.max, 0, 1);
    ctx.fillStyle = q.color;
    ctx.beginPath(); ctx.arc(x, y, q.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * Темнота с прожжёнными источниками света.
 *
 * Именно этот слой делает темноту ограничением уровня, а не фильтром:
 * игрок видит ровно то, что освещено, и вынужден двигаться по свету.
 */
function drawDarkness() {
  const w = shadow.width, h = shadow.height;
  const sx = shadowCtx;
  sx.setTransform(1, 0, 0, 1, 0, 0);
  sx.clearRect(0, 0, w, h);
  sx.fillStyle = "rgba(3,6,11,0.955)";
  sx.fillRect(0, 0, w, h);
  sx.globalCompositeOperation = "destination-out";

  const scale = 0.5;
  const toSh = (wx, wy) => [(wx - cam.x) * cam.scale * scale + w / 2, (wy - cam.y) * cam.scale * scale + h / 2];

  // вспышки выстрелов — свет на долю секунды
  for (const b of bullets) {
    if (b.owner !== "p") continue;
    const [x, y] = toSh(b.x, b.y);
    const g = sx.createRadialGradient(x, y, 0, x, y, 26);
    g.addColorStop(0, "rgba(0,0,0,0.35)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    sx.fillStyle = g;
    sx.beginPath(); sx.arc(x, y, 26, 0, Math.PI * 2); sx.fill();
  }

  // плафоны
  for (const L of LIGHTS) {
    const [x, y] = toSh(L.x, L.y);
    const rr = L.r * cam.scale * scale;
    const g = sx.createRadialGradient(x, y, 0, x, y, rr);
    g.addColorStop(0, "rgba(0,0,0,0.98)");
    g.addColorStop(0.55, "rgba(0,0,0,0.7)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    sx.fillStyle = g;
    sx.beginPath(); sx.arc(x, y, rr, 0, Math.PI * 2); sx.fill();
  }

  // фонарь игрока: конус + ближний круг
  const v = playerVisibility();
  const [px, py] = toSh(v.x, v.y);
  sx.save();
  sx.translate(px, py);
  sx.rotate(v.a);
  const rg = sx.createRadialGradient(0, 0, 0, 0, 0, v.range * cam.scale * scale);
  rg.addColorStop(0, "rgba(0,0,0,0.99)");
  rg.addColorStop(0.7, "rgba(0,0,0,0.6)");
  rg.addColorStop(1, "rgba(0,0,0,0)");
  sx.fillStyle = rg;
  sx.beginPath();
  sx.moveTo(0, 0);
  sx.arc(0, 0, v.range * cam.scale * scale, -v.half, v.half);
  sx.closePath();
  sx.fill();
  sx.restore();
  const ng = sx.createRadialGradient(px, py, 0, px, py, v.near * cam.scale * scale);
  ng.addColorStop(0, "rgba(0,0,0,0.95)");
  ng.addColorStop(1, "rgba(0,0,0,0)");
  sx.fillStyle = ng;
  sx.beginPath(); sx.arc(px, py, v.near * cam.scale * scale, 0, Math.PI * 2); sx.fill();

  // дроны светятся: без этого в темноте бой превращается в лотерею
  for (const e of enemies) {
    if (e.dead || e.spawnT > 0) continue;
    const [x, y] = toSh(e.x, e.y);
    const rr = (e.elite ? 3.4 : 2.2) * cam.scale * scale;
    const g = sx.createRadialGradient(x, y, 0, x, y, rr);
    g.addColorStop(0, "rgba(0,0,0,0.9)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    sx.fillStyle = g;
    sx.beginPath(); sx.arc(x, y, rr, 0, Math.PI * 2); sx.fill();
  }
  sx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(shadow, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  // тёплая подсветка поверх: плафоны дают не только видимость, но и цвет
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.16;
  for (const L of LIGHTS) {
    const [x, y] = worldToScreen(L.x, L.y);
    const g = ctx.createRadialGradient(x, y, 0, x, y, L.r * cam.scale);
    g.addColorStop(0, "rgba(255,186,110,0.55)");
    g.addColorStop(1, "rgba(255,140,60,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, L.r * cam.scale, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawSnow() {
  ctx.save();
  ctx.fillStyle = "rgba(200,225,245,0.22)";
  for (const s of snow) {
    const [x, y] = worldToScreen(s.x, s.y);
    ctx.globalAlpha = 0.12 + s.z * 0.22;
    ctx.beginPath(); ctx.arc(x, y, s.r * s.z * cam.scale / 8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function render() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#070a0e";
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  if (cam.shake > 0.3) {
    ctx.translate(rnd(-cam.shake, cam.shake) * 0.5, rnd(-cam.shake, cam.shake) * 0.5);
  }
  drawFloor();
  drawWallsAndCovers();
  drawDoorsAndTerms();
  drawDarkness();
  drawBullets();
  drawSnow();
  drawEntities();
  ctx.restore();
}