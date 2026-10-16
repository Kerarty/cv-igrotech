/* =========================================================================
   UI.JS — HUD, слои дизайна, панели терминалов, отчёт и документ.

   Весь текст берётся из content.js. Здесь только структура и события.
   ========================================================================= */

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const fmtTime = (s) => {
  const m = Math.floor(s / 60);
  return m + ":" + String(Math.floor(s % 60)).padStart(2, "0");
};

/* =========================================================================
   СЛОИ ДИЗАЙНА — то, что обычно видно только в редакторе
   ========================================================================= */

let designLayer = 0; // 0 — выключено, 1..3 — слои

function drawDesignLayer() {
  if (!designLayer) return;
  const s = cam.scale;
  ctx.save();
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.lineWidth = 1;

  if (designLayer === 1) drawLayerBlockout();
  if (designLayer === 2) drawLayerVision();
  if (designLayer === 3) drawLayerMetrics();

  ctx.restore();
}

function drawLayerBlockout() {
  const s = cam.scale;

  // сетка 2 м
  ctx.strokeStyle = "rgba(120,200,255,0.16)";
  ctx.beginPath();
  const x0 = Math.floor((cam.x - canvas.clientWidth / 2 / s) / CELL) * CELL;
  const y0 = Math.floor((cam.y - canvas.clientHeight / 2 / s) / CELL) * CELL;
  for (let x = x0; x < cam.x + canvas.clientWidth / 2 / s; x += CELL) {
    const [px] = worldToScreen(x, 0);
    ctx.moveTo(px, 0); ctx.lineTo(px, canvas.clientHeight);
  }
  for (let y = y0; y < cam.y + canvas.clientHeight / 2 / s; y += CELL) {
    const [, py] = worldToScreen(0, y);
    ctx.moveTo(0, py); ctx.lineTo(canvas.clientWidth, py);
  }
  ctx.stroke();

  // крупная сетка 10 м
  ctx.strokeStyle = "rgba(120,200,255,0.34)";
  ctx.beginPath();
  for (let x = Math.floor(x0 / 10) * 10; x < cam.x + canvas.clientWidth / 2 / s; x += 10) {
    const [px] = worldToScreen(x, 0);
    ctx.moveTo(px, 0); ctx.lineTo(px, canvas.clientHeight);
  }
  for (let y = Math.floor(y0 / 10) * 10; y < cam.y + canvas.clientHeight / 2 / s; y += 10) {
    const [, py] = worldToScreen(0, y);
    ctx.moveTo(0, py); ctx.lineTo(canvas.clientWidth, py);
  }
  ctx.stroke();

  // контуры зон с буквами
  ZONES.forEach((z) => {
    const [ax, ay, bx, by] = z.box;
    const [x1, y1] = worldToScreen(ax * CELL, ay * CELL);
    const [x2, y2] = worldToScreen((bx + 1) * CELL, (by + 1) * CELL);
    ctx.strokeStyle = "rgba(127,227,255,0.55)";
    ctx.setLineDash([6, 5]);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(127,227,255,0.85)";
    ctx.font = "bold 22px ui-monospace, monospace";
    ctx.fillText(z.id, x1 + 8, y1 + 26);
  });

  // точки спавна
  Object.entries(SPAWNS).forEach(([k, list]) => {
    list.forEach((sp, i) => {
      const [wx, wy] = cellToWorld(sp.cell[0], sp.cell[1]);
      const [px, py] = worldToScreen(wx, wy);
      ctx.strokeStyle = "#ff9c5a";
      ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px - 10, py); ctx.lineTo(px + 10, py);
      ctx.moveTo(px, py - 10); ctx.lineTo(px, py + 10);
      ctx.stroke();
      ctx.fillStyle = "#ffcf9a";
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText(k + "." + (i + 1), px + 10, py - 8);
    });
  });

  // точки интереса
  TERMINALS.forEach((t) => {
    const [wx, wy] = cellToWorld(t.cell[0], t.cell[1]);
    const [px, py] = worldToScreen(wx, wy);
    ctx.fillStyle = "#57e39b";
    ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillText(t.title.split(" ")[0], px + 8, py + 14);
  });

  // маршрут: терминалы по порядку прохождения
  const pts = [cellToWorld(...MAP.meta.start), ...TERMINALS.map((t) => cellToWorld(t.cell[0], t.cell[1]))];
  ctx.setLineDash([9, 7]);
  ctx.strokeStyle = "rgba(87,227,155,0.6)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const [px, py] = worldToScreen(p[0], p[1]);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  });
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawLayerVision() {
  const v = playerVisibility();

  // конусы видимости дронов
  for (const e of enemies) {
    if (e.dead || e.spawnT > 0) continue;
    const [ex, ey] = worldToScreen(e.x, e.y);
    const r = e.T.range * cam.scale;
    const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, r);
    g.addColorStop(0, "rgba(255,120,70,0.22)");
    g.addColorStop(1, "rgba(255,120,70,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.arc(ex, ey, r, e.angle - 0.85, e.angle + 0.85);
    ctx.closePath();
    ctx.fill();
  }

  // конус фонаря игрока
  const [px, py] = worldToScreen(v.x, v.y);
  const rg = ctx.createRadialGradient(px, py, 0, px, py, v.range * cam.scale);
  rg.addColorStop(0, "rgba(140,215,255,0.2)");
  rg.addColorStop(1, "rgba(140,215,255,0)");
  ctx.fillStyle = rg;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.arc(px, py, v.range * cam.scale, v.a - v.half, v.a + v.half);
  ctx.closePath();
  ctx.fill();

  // лучи видимости от игрока к каждому дрону
  for (const e of enemies) {
    if (e.dead || e.spawnT > 0) continue;
    const vis = canSee(player.x, player.y, e.x, e.y);
    const len = castRay(player.x, player.y, e.x, e.y);
    const [ex, ey] = worldToScreen(
      player.x + Math.cos(Math.atan2(e.y - player.y, e.x - player.x)) * len,
      player.y + Math.sin(Math.atan2(e.y - player.y, e.x - player.x)) * len
    );
    ctx.strokeStyle = vis ? "rgba(87,227,155,0.9)" : "rgba(255,92,92,0.85)";
    ctx.lineWidth = vis ? 2 : 1.5;
    ctx.setLineDash(vis ? [] : [5, 4]);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!vis) {
      const [ax, ay] = worldToScreen(e.x, e.y);
      ctx.strokeStyle = "rgba(255,92,92,0.9)";
      ctx.beginPath(); ctx.arc(ax, ay, 9, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // зоны света плафонов
  for (const L of LIGHTS) {
    const [lx, ly] = worldToScreen(L.x, L.y);
    ctx.strokeStyle = "rgba(255,186,110,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(lx, ly, L.r * cam.scale, 0, Math.PI * 2); ctx.stroke();
  }

  ctx.fillStyle = "#ffd08a";
  ctx.font = "11px ui-monospace, monospace";
  // подпись уходит в центр низа: слева снизу живёт переключатель слоёв
  ctx.fillText("зелёный луч — враг виден · красный — за стеной", 430, canvas.clientHeight - 46);
}

function drawLayerMetrics() {
  // расстояния между последовательными точками маршрута — с пересчётом в секунды.
  // Это тот аргумент, который обычно и звучит в споре: не «так короче»,
  // а «на этой дистанции игрок тратит столько-то секунд».
  const pts = [cellToWorld(...MAP.meta.start), ...TERMINALS.map((t) => cellToWorld(t.cell[0], t.cell[1]))];
  const names = ["старт", ...TERMINALS.map((t) => t.title.split(" ")[0])];
  ctx.setLineDash([4, 4]);
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = worldToScreen(pts[i][0], pts[i][1]);
    const [x2, y2] = worldToScreen(pts[i + 1][0], pts[i + 1][1]);
    const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    ctx.strokeStyle = "rgba(255,140,255,0.6)";
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ff9cff";
    ctx.fillText(Math.round(d) + " м · " + (d / TUNE.player.sprint).toFixed(1) + " с · " + names[i] + " → " + names[i + 1],
      (x1 + x2) / 2 + 8, (y1 + y2) / 2 - 8);
    ctx.setLineDash([4, 4]);
  }
  ctx.setLineDash([]);

  // площади зон прямо на плане
  ZONES.forEach((z) => {
    const [x0, y0, x1, y1] = z.box;
    const [px, py] = worldToScreen(x0 * CELL, y0 * CELL);
    ctx.fillStyle = "rgba(255,200,120,0.95)";
    ctx.font = "bold 12px ui-monospace, monospace";
    const m = METRICS;
    ctx.fillText(
      z.id + " · " + z.name + " · " + m.area[z.id] + " м² · укрытий " + m.cover[z.id],
      px + 10, py + 46
    );
  });

  // глобальные цифры: панель уходит в левый нижний угол, где HUD не занимает
  // ничего выше полосы слоёв, — иначе она наезжает на индикатор здоровья
  const bw = 268, bh = 118;
  const bx = 12, by = canvas.clientHeight - bh - 46;
  ctx.fillStyle = "rgba(10,14,20,0.86)";
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = "rgba(255,156,255,0.5)";
  ctx.strokeRect(bx, by, bw, bh);
  ctx.fillStyle = "#ffc8ff";
  ctx.font = "12px ui-monospace, monospace";
  const m = METRICS;
  const lines = [
    "Площадь пола: " + m.floorTotal + " м²",
    "Стен: " + m.walls + " · укрытий: " + m.coverTotal,
    "Источников света: " + m.lights,
    "Плотность: " + m.density.toFixed(2) + " врага / 100 м²",
    "Ср. дистанция спавн → цель: " + m.avgSight.toFixed(0) + " м",
    "Прямая видимость спавн → цель: " + Math.round(m.sightOpenRatio * 100) + "%",
    "Переход уровня на скорости бега: ~" + m.crossTime.toFixed(0) + " с",
  ];
  lines.forEach((l, i) => ctx.fillText(l, bx + 10, by + 20 + i * 14));
}

/* =========================================================================
   HUD
   ========================================================================= */

const minimap = { c: null, x: null, size: 180 };

function drawMinimap() {
  if (!minimap.c) return;
  const c = minimap.c, g = minimap.x;
  const s = c.width / MAP_PX_W;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = "#080c11";
  g.fillRect(0, 0, c.width, c.height);

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const t = tileAt(x, y);
      if (t === TILE.WALL) g.fillStyle = "#28323d";
      else if (t === TILE.COVER) g.fillStyle = "#3c4a58";
      else continue;
      g.fillRect(x * CELL * s, y * CELL * s, CELL * s, CELL * s);
    }
  }
  const box = (z, col) => {
    const [a, b, c2, d] = z.box;
    g.strokeStyle = col;
    g.strokeRect(a * CELL * s, b * CELL * s, (c2 - a + 1) * CELL * s, (d - b + 1) * CELL * s);
  };
  box(ZONES[0], "rgba(127,227,255,0.4)");
  box(ZONES[1], "rgba(127,227,255,0.4)");
  box(ZONES[2], "rgba(127,227,255,0.4)");
  box(ZONES[3], "rgba(127,227,255,0.4)");

  for (const w of WAVES) {
    if (waves[w.id].done) continue;
    const s2 = waves[w.id];
    w.spawns.forEach((sp, i) => {
      if (i < s2.spawned) return;
      if (!s2.active && s2.armedAt === null) return;
      g.fillStyle = s2.active ? "#ff6b6b" : "rgba(255,156,90,0.45)";
      g.beginPath();
      g.arc((sp.cell[0] * CELL + 1) * s, (sp.cell[1] * CELL + 1) * s, 3.4, 0, Math.PI * 2);
      g.fill();
    });
  }

  TERMINALS.forEach((t) => {
    const read = readSet.has(t.id);
    const locked = t.locked && t.locked();
    g.fillStyle = locked ? "#5a6270" : read ? "#57e39b" : "#7fe3ff";
    g.fillRect(t.cell[0] * CELL * s - 1.5, t.cell[1] * CELL * s - 1.5, 5, 5);
  });

  for (const e of enemies) {
    if (e.dead) continue;
    g.fillStyle = "#ff8a5a";
    g.beginPath();
    g.arc(e.x * s, e.y * s, e.elite ? 4 : 2.4, 0, Math.PI * 2);
    g.fill();
  }

  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(player.x * s, player.y * s, 3, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#ffffff";
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(player.x * s, player.y * s);
  g.lineTo(player.x * s + Math.cos(player.angle) * 8, player.y * s + Math.sin(player.angle) * 8);
  g.stroke();
}

function updateHud() {
  const p = player;
  $("#hpFill").style.width = clamp(p.hp, 0, 100) + "%";
  $("#hpNum").textContent = Math.max(0, Math.round(p.hp));

  $("#ammo").textContent = p.reloadT > 0 ? "ПЕРЕЗАРЯДКА" : p.ammo + " / " + TUNE.gun.mag;
  $("#ammo").classList.toggle("warn", p.reloadT > 0);

  $("#dashFill").style.width = (100 - (p.dashCd / TUNE.player.dashCd) * 100) + "%";
  $("#nadeFill").style.width = (100 - (p.nadeCd / TUNE.nade.cd) * 100) + "%";
  $("#nadeCd").textContent = p.nadeCd <= 0 ? "ПКМ" : p.nadeCd.toFixed(1);

  $("#clock").textContent = fmtTime(runTime);
  $("#kills").textContent = stats.kills;

  const z = ZONES.find((zz) => zz.id === playerZone);
  $("#zone").textContent = z ? "Зона " + z.id + " · " + z.name : "Вне зон";

  const act = WAVES.filter((w) => waves[w.id].active && !waves[w.id].done);
  $("#wave").textContent = act.length ? act.map((w) => w.label).join(" · ") : "контактов нет";

  const list = $("#objList");
  list.innerHTML = "";
  TERMINALS.forEach((t) => {
    const read = readSet.has(t.id);
    const locked = t.locked && t.locked();
    const li = el("li", "obj" + (read ? " done" : "") + (locked ? " locked" : ""));
    li.appendChild(el("span", "obj-dot"));
    li.appendChild(el("span", "obj-tx", t.title));
    li.appendChild(el("span", "obj-s", read ? "прочитано" : locked ? "закрыто" : "не прочитано"));
    list.appendChild(li);
  });
  $("#objCount").textContent = readCount + "/" + TERMINALS.length;

  const layerName = ["выключен", "1 · блокаут и навигация", "2 · свет и видимость", "3 · метрики"][designLayer];
  $("#layer").textContent = layerName;

  // прицел едет за мышью, а не стоит в центре: в виде сверху игрок всегда
  // в середине кадра, и центральный прицел соврал бы направление
  const ch = $(".crosshair");
  ch.style.left = input.mouse.x + "px";
  ch.style.top = input.mouse.y + "px";
  ch.style.opacity = resting() ? "0" : "0.55";

  // Плашка над уровнем. Причины две, и они выглядят по-разному: пауза по esc
  // продолжается пробелом, режим документа — только кнопкой.
  const lock = $("#gameLock");
  lock.classList.toggle("on", resting());
  lock.classList.toggle("soft", paused && !gameLocked);
  $("#lockBig").textContent = paused && !gameLocked ? "ПРОДОЛЖИТЬ" : "В ИГРУ";
  $("#lockSub").textContent = paused && !gameLocked
    ? "пауза · листайте вниз, там интерактивное резюме"
    : "локация на паузе, пока вы читаете документ";

  // Кнопка в шапке нужна, когда плашка уехала из поля зрения вместе с уровнем
  $("#btnResumeGame").hidden = !resting();

  minimap.c.style.display = showMini ? "block" : "none";
  drawMinimap();
}

/* =========================================================================
   ПАНЕЛИ ТЕРМИНАЛОВ
   ========================================================================= */

const SECTIONS = {};

SECTIONS.about = () => {
  const f = document.createDocumentFragment();
  f.appendChild(h2("Обо мне"));
  f.appendChild(p(ABOUT.lead));
  ABOUT.body.forEach((t) => f.appendChild(p(t)));

  f.appendChild(h3("Что ищу в работе"));
  const ul = el("ul", "bullets");
  ABOUT.want.forEach((w) => ul.appendChild(el("li", null, w)));
  f.appendChild(ul);

  f.appendChild(h3(ABOUT.gaps.title));
  const box = el("div", "gaps");
  ABOUT.gaps.items.forEach((g) => {
    const d = el("div", "gap");
    d.appendChild(el("div", "gap-t", g.t));
    d.appendChild(el("div", "gap-d", g.d));
    box.appendChild(d);
  });
  f.appendChild(box);
  return f;
};

SECTIONS.education = () => {
  const f = document.createDocumentFragment();
  f.appendChild(h2("Образование"));
  EDUCATION.courses.forEach((c) => {
    const d = el("div", "entry");
    d.appendChild(el("div", "entry-h", c.name));
    d.appendChild(el("div", "entry-s", c.org));
    d.appendChild(el("div", "entry-y", c.years));
    d.appendChild(p(c.note));
    f.appendChild(d);
  });

  f.appendChild(h3("Инструменты"));
  const grid = el("div", "tools");
  EDUCATION.tools.forEach((t) => {
    const d = el("div", "tool");
    d.appendChild(el("div", "tool-n", t.name));
    d.appendChild(el("div", "tool-l", t.level));
    grid.appendChild(d);
  });
  f.appendChild(grid);

  f.appendChild(h3("Языки"));
  const langs = el("div", "langs");
  EDUCATION.languages.forEach((l) => {
    const d = el("div", "lang");
    d.appendChild(el("span", "lang-n", l.label));
    d.appendChild(el("span", "lang-l", l.level));
    langs.appendChild(d);
  });
  f.appendChild(langs);
  return f;
};

SECTIONS.skills = () => {
  const f = document.createDocumentFragment();
  f.appendChild(h2("Навыки"));
  const grid = el("div", "cols2");
  SKILLS.forEach((g) => {
    const d = el("div", "card");
    d.appendChild(el("div", "card-t", g.title));
    const ul = el("ul", "bullets");
    g.items.forEach((i) => ul.appendChild(el("li", null, i)));
    d.appendChild(ul);
    grid.appendChild(d);
  });
  f.appendChild(grid);
  return f;
};

SECTIONS.cases = () => {
  const f = document.createDocumentFragment();
  f.appendChild(h2("Кейсы: задача → решение → результат"));
  f.appendChild(p("Каждый кейс разложен по одной схеме, чтобы было видно не «что делал», а что из этого получилось."));
  CASES.forEach((c) => {
    const d = el("article", "case");
    const h = el("header", "case-h");
    h.appendChild(el("span", "tag", c.tag));
    h.appendChild(el("h4", null, c.title));
    h.appendChild(el("div", "case-sub", c.subtitle));
    d.appendChild(h);
    const psr = el("div", "psr");
    [["Задача", c.problem], ["Решение", c.solution], ["Результат", c.result]].forEach(([k, v]) => {
      const r = el("div", "psr-row");
      r.appendChild(el("div", "psr-k", k));
      r.appendChild(el("div", "psr-v", v));
      psr.appendChild(r);
    });
    d.appendChild(psr);
    const tags = el("div", "tags");
    c.tags.forEach((t) => tags.appendChild(el("span", "tag sm", t)));
    d.appendChild(tags);
    f.appendChild(d);
  });
  return f;
};

SECTIONS.method = () => {
  const f = document.createDocumentFragment();
  f.appendChild(h2("Метод: от идеи до приёмки"));
  f.appendChild(p("Шесть шагов. На каждом есть конкретный артефакт, а не «поговорили с командой»."));
  const wrap = el("div", "steps");
  PROCESS.forEach((s) => {
    const d = el("div", "step");
    d.appendChild(el("div", "step-n", s.n));
    d.appendChild(el("div", "step-t", s.t));
    d.appendChild(p(s.text));
    d.appendChild(el("div", "step-o", "артефакт: " + s.out));
    wrap.appendChild(d);
  });
  f.appendChild(wrap);

  f.appendChild(h3("Четыре правила, которые я не нарушаю"));
  const g = el("div", "cols2");
  RULES.forEach((r) => {
    const d = el("div", "card");
    d.appendChild(el("div", "card-t", r.t));
    d.appendChild(p(r.d));
    g.appendChild(d);
  });
  f.appendChild(g);
  return f;
};

SECTIONS.igrotech = () => {
  const f = document.createDocumentFragment();
  f.appendChild(h2("Про «Игро Тэк»"));
  f.appendChild(p(IGROTECH.lead));
  const g = el("div", "cols2");
  IGROTECH.cards.forEach((c) => {
    const d = el("div", "card");
    const t = el("div", "card-h");
    t.appendChild(el("div", "card-t", c.title));
    t.appendChild(el("span", "tag sm", c.tag));
    d.appendChild(t);
    d.appendChild(el("div", "card-k", c.kicker));
    d.appendChild(p(c.text));
    d.appendChild(el("div", "card-m", c.mine));
    g.appendChild(d);
  });
  f.appendChild(g);

  f.appendChild(h3("Что сделаю в первую неделю"));
  const ul = el("ul", "bullets");
  IGROTECH.week1.forEach((w) => ul.appendChild(el("li", null, w)));
  f.appendChild(ul);
  f.appendChild(el("div", "honest", IGROTECH.honest));

  f.appendChild(h3("Контакты"));
  const c = el("div", "contacts");
  PROFILE.contacts.forEach((x) => {
    const a = el("a", "contact");
    a.href = x.href;
    a.target = "_blank";
    a.rel = "noopener";
    a.appendChild(el("span", "c-l", x.label));
    a.appendChild(el("span", "c-v", x.value));
    c.appendChild(a);
  });
  f.appendChild(c);
  f.appendChild(el("div", "sign", SIGN.line));
  return f;
};

function h2(t) { return el("h2", "sec-h", t); }
function h3(t) { return el("h3", "sec-h3", t); }
function p(t) { return el("p", null, t); }

/**
 * Прокрутка страницы под модальными окнами.
 *
 * Пробел и колесо мыши в терминале уезжали вниз по документу: страница
 * прокручивалась под открытой панелью, и её закрытие возвращало игрока
 * совсем в другое место. Поэтому позиция запоминается и возвращается
 * явно — полагаться на браузер здесь нельзя.
 */
let scrollMemo = 0;

function syncScrollLock() {
  const modal = !!document.querySelector(".screen.open") ||
    $("#termPanel").classList.contains("open");
  const locked = document.documentElement.classList.contains("modal-open");

  if (modal && !locked) {
    scrollMemo = window.scrollY;
    document.documentElement.classList.add("modal-open");
    document.body.classList.add("modal-open");
  } else if (!modal && locked) {
    document.documentElement.classList.remove("modal-open");
    document.body.classList.remove("modal-open");
    // именно мгновенно: со smooth анимацией страница продолжала ехать
    // к старой позиции уже после того, как панель закрылась
    window.scrollTo({ top: scrollMemo, left: 0, behavior: "instant" });
  }
}

function openTerminal(id) {
  const t = termById[id];
  if (!t) return;
  if (t.locked && t.locked()) {
    flash(t.lockedWhy);
    return;
  }
  if (!readSet.has(id)) { readSet.add(id); readCount = readSet.size; }

  const body = $("#termBody");
  body.innerHTML = "";
  const sec = SECTIONS[id];
  if (sec) body.appendChild(sec());
  $("#termTitle").textContent = t.title;
  $("#termSub").textContent = t.sub + " · прочитано: " + readCount + " из " + TERMINALS.length;
  $("#termPanel").classList.add("open");
  state = "panel";
  syncScrollLock();
}

function closeTerminal() {
  $("#termPanel").classList.remove("open");
  state = restingState();
  syncScrollLock();
}

function flash(msg) {
  const n = $("#flash");
  n.textContent = msg;
  n.classList.remove("show");
  void n.offsetWidth;
  n.classList.add("show");
}

/* =========================================================================
   ЭКРАНЫ: брифинг, смерть, победа, отчёт
   ========================================================================= */

function showScreen(id) {
  $$(".screen").forEach((n) => n.classList.remove("open"));
  if (id) $("#" + id).classList.add("open");

  // Закрытие экрана не должно незаметно возвращать игру в бой: если игрок
  // на паузе или читает документ, состояние «стоит» держится до esc, пробела
  // или кнопки «в игру».
  state = id ? "screen" : restingState();
  syncScrollLock();

  // графики рисуются по фактической ширине контейнера, а он появляется
  // только сейчас — до этого размер нулевой и кривая вышла бы пустой
  if (id === "report") {
    setTimeout(() => drawPacingChart($("#pacingCompare"), stats.intensity, true), 60);
  }
}

function buildBriefing() {
  const host = $("#briefBody");
  host.innerHTML = "";
  host.appendChild(el("p", "brief-lead", LORE.title + ". " + LORE.rows[0][1] + "."));

  const t = el("table", "tbl");
  LORE.rows.forEach((r) => {
    const tr = el("tr");
    tr.appendChild(el("th", null, r[0]));
    tr.appendChild(el("td", null, r[1]));
    t.appendChild(tr);
  });
  host.appendChild(t);

  const goals = el("div", "brief-goals");
  TERMINALS.forEach((tm) => {
    const d = el("div", "goal");
    d.appendChild(el("div", "goal-n", tm.title));
    d.appendChild(el("div", "goal-z", "зона " + tm.zone));
    goals.appendChild(d);
  });
  host.appendChild(goals);

  const ctl = el("div", "ctl");
  CONTROLS.forEach((r) => {
    const d = el("div", "ctl-row");
    d.appendChild(el("kbd", null, r[0]));
    d.appendChild(el("span", null, r[1]));
    ctl.appendChild(d);
  });
  host.appendChild(ctl);

  host.appendChild(el("p", "brief-note", LORE.designNote));
}

function reportData() {
  const ttFirst = stats.firstContactAt;
  const perZone = ZONES.map((z) => ({
    id: z.id, name: z.name,
    enter: stats.zoneEnter[z.id],
    seconds: stats.zoneSeconds[z.id] || 0,
    area: METRICS.area[z.id],
    cover: METRICS.cover[z.id],
  }));
  return {
    ttFirstContact: ttFirst,
    ttClear: ttFirst ? runTime - ttFirst : null,
    accuracy: stats.shots ? stats.hits / stats.shots : 0,
    avgTtk: stats.kills ? runTime / Math.max(1, stats.kills) : 0,
    damageTaken: stats.damageTaken,
    deaths: stats.deaths,
    timeToKill: runTime,
    kills: stats.kills,
    nades: stats.nadesUsed,
    perZone,
  };
}

function buildReport(win) {
  const r = reportData();
  const host = $("#reportBody");
  host.innerHTML = "";

  host.appendChild(el("p", "rep-lead", win
    ? "Прохождение завершено. Ниже — то, что я умею снимать с плейтеста: не ощущение, а цифры."
    : "Смерть на объекте. Отчёт собирается в любом случае — в этом и смысл плейтеста."));

  const m = el("div", "metrics");
  const add = (k, v, hint, good) => {
    const c = el("div", "metric" + (good === undefined ? "" : good ? " good" : " warn"));
    c.appendChild(el("div", "m-v", v));
    c.appendChild(el("div", "m-k", k));
    if (hint) c.appendChild(el("div", "m-h", hint));
    m.appendChild(c);
  };
  add("время до первого контакта", r.ttFirstContact === null ? "не было" : r.ttFirstContact.toFixed(1) + " с",
    REPORT_HELP.ttFirstContact, r.ttFirstContact === null ? true : r.ttFirstContact >= 40 && r.ttFirstContact <= 110);
  add("время на зачистку", r.ttClear === null ? "—" : fmtTime(r.ttClear), REPORT_HELP.ttClear);
  add("время до финала", fmtTime(r.timeToKill), REPORT_HELP.timeToKill);
  add("точность", Math.round(r.accuracy * 100) + "%", REPORT_HELP.accuracy, r.accuracy >= 0.25);
  add("убито / всего", stats.kills + " / " + stats.kills, "счётчик дронов");
  add("урон по игроку", Math.round(r.damageTaken) + " / " + TUNE.player.hp, REPORT_HELP.damageTaken, r.damageTaken <= 50);
  add("смертей", String(stats.deaths), REPORT_HELP.deaths);
  add("гранат использовано", String(stats.nadesUsed), "проверка утилиты в тесноте");
  host.appendChild(m);

  host.appendChild(el("h3", null, "Время по зонам"));
  const t = el("table", "tbl");
  const head = el("tr");
  ["зона", "площадь", "вход", "время", "плотность времени"].forEach((x) => head.appendChild(el("th", null, x)));
  t.appendChild(head);
  r.perZone.forEach((z) => {
    const tr = el("tr");
    tr.appendChild(el("td", null, z.id + " · " + z.name));
    tr.appendChild(el("td", null, z.area + " м²"));
    tr.appendChild(el("td", null, z.enter === undefined ? "не посещена" : fmtTime(z.enter)));
    tr.appendChild(el("td", null, z.seconds.toFixed(1) + " с"));
    tr.appendChild(el("td", null, (z.seconds / Math.max(1, z.area) * 100).toFixed(2) + " с / 100 м²"));
    t.appendChild(tr);
  });
  host.appendChild(t);

  host.appendChild(el("h3", null, "Твой темп против задуманного"));
  const cmp = el("canvas", "chart");
  cmp.id = "pacingCompare";
  cmp.height = 220;
  host.appendChild(cmp);
  host.appendChild(el("p", "rep-note",
    "Сплошная — то, что задумано в дизайн-документе. Пунктирная — то, что получилось у тебя. " +
    "Если кривые не совпадают, это и есть материал для следующей итерации."));

  host.appendChild(el("h3", null, "Одна гипотеза"));
  const hyp = el("div", "hypothesis");
  hyp.appendChild(el("div", "hyp-t", "Что я поменяю по этому прогону"));
  hyp.appendChild(el("div", "hyp-d", hypothesis(r)));
  host.appendChild(hyp);

  host.appendChild(el("div", "honest", SIGN.honest));
}

function hypothesis(r) {
  const live = WAVES.filter((w) => waves[w.id].done).length;
  if (r.damageTaken > 60) {
    return "Урон по игроку " + Math.round(r.damageTaken) + " при точности " +
      Math.round(r.accuracy * 100) + "%: враг попадает чаще, чем игрок. Увеличу телеграф " +
      "дрона в зоне C с 0,6 до 0,8 с и добавлю одно точечное укрытие на выходе из насосной.";
  }
  if (r.ttFirstContact !== null && r.ttFirstContact < 40) {
    return "Первый контакт случился на " + r.ttFirstContact.toFixed(0) +
      "-й секунде — раньше, чем игрок освоил движение. Сдвину триггер волны B с 22 м до 30 м.";
  }
  if (live < 3) {
    return "Пройдено " + live + " из 5 волн: игрок не дошёл до конца объекта. Проверю, " +
      "читается ли направление дальше по свету без миникарты.";
  }
  if (r.accuracy < 0.25) {
    return "Точность " + Math.round(r.accuracy * 100) + "% — цель меньше зоны попадания. " +
      "Увеличу размер силуэта дрона на 15% и уберу одно подёргивание при рывке.";
  }
  return "Зачищено " + live + " из 5 волн за " + fmtTime(r.timeToKill) +
    ". Кривая темпа идёт выше задуманной во второй половине — следующим шагом разрежу волну D2 " +
    "на две фазы с паузой на сбор.";
}

/* =========================================================================
   ГРАФИК КРИВОЙ ТЕМПА
   ========================================================================= */

function drawPacingChart(cv, actual, withActual) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth || 900, h = cv.clientHeight || 220;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const pad = { l: 34, r: 14, t: 16, b: 26 };
  const maxT = Math.max(380, withActual && actual.length ? actual[actual.length - 1].t + 20 : 0);
  const X = (t) => pad.l + (t / maxT) * (w - pad.l - pad.r);
  const Y = (v) => h - pad.b - v * (h - pad.t - pad.b);

  g.strokeStyle = "rgba(255,255,255,0.08)";
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.font = "10px ui-monospace, monospace";
  g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const v = i / 4;
    g.beginPath(); g.moveTo(pad.l, Y(v)); g.lineTo(w - pad.r, Y(v)); g.stroke();
    g.fillText(v.toFixed(2), 6, Y(v) + 3);
  }
  for (let t = 0; t <= maxT; t += 60) {
    g.beginPath(); g.moveTo(X(t), pad.t); g.lineTo(X(t), h - pad.b); g.stroke();
    g.fillText(t + "с", X(t) - 8, h - 8);
  }

  const curve = (pts, color, dash) => {
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.setLineDash(dash || []);
    g.beginPath();
    pts.forEach((p, i) => (i === 0 ? g.moveTo(X(p.t), Y(p.v)) : g.lineTo(X(p.t), Y(p.v))));
    g.stroke();
    g.setLineDash([]);
  };
  curve(PACING, "#7fe3ff", []);

  if (withActual && actual.length > 1) {
    curve(actual, "#ffb347", [5, 4]);
  }

  // события
  g.fillStyle = "rgba(255,255,255,0.45)";
  g.font = "10px ui-monospace, monospace";
  PACING.forEach((p) => {
    if (!p.note) return;
    g.fillText(p.note, Math.min(X(p.t) + 4, w - 110), pad.t + 10);
  });
}