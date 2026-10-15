/* =========================================================================
   LEVEL.JS — блокаут локации «Объект Кадрис».

   Карта собрана из трёх вертикальных сегментов, чтобы её можно было
   править по зонам, а не искать в одной простыне. Размер сегмента
   проверяется при загрузке: если строка стала длиннее или короче, уровень
   не запустится, а не поедет молча.

   Обозначения карты:
     .  пол
     #  стена              — блокирует движение и взгляд
     c  контейнер / ящик   — блокирует движение, НЕ блокирует взгляд
     l  плафон              — источник света
     D  дверь               — открывается по условию
     T  терминал            — секция резюме
     P  старт игрока
   ========================================================================= */

const TILE = {
  FLOOR: 0,
  WALL: 1,
  COVER: 2,
  LIGHT: 3,
  DOOR: 4,
  TERM: 5,
  START: 6,
};

const MAP_W = 56;
const MAP_H = 38;
const CELL = 2; // метров в клетке

/* --- сегмент A: дверной док, x 2..18 ----------------------------------- */
const SEG_A = [
  "........l........", // 4
  ".................", // 5
  "..T..............", // 6
  ".................", // 7
  "...cc............", // 8
  ".................", // 9
  "..cc.....c.......", // 10
  "........l........", // 11
  ".......c.........", // 12
  ".................", // 13
  "...ccc...........", // 14
  "................l", // 15
  ".................", // 16
  "...cc....c.......", // 17
  "....P.l..........", // 18
  ".................", // 19
  "..cc.............", // 20
  "................l", // 21
  "......c..........", // 22
  ".................", // 23
  "..ccc......c.....", // 24
  "..........l......", // 25
  "...c.............", // 26
  "................l", // 27
  "..cc......c......", // 28
  ".................", // 29
  ".......T.........", // 30
  "........l........", // 31
  "..cc.............", // 32
];

/* --- сегмент B/C: техблок и насосная, x 21..34 -------------------------- */
const SEG_BC = [
  "..............", // 4   верх техблока
  ".........T....", // 5
  "..##.....##...", // 6
  "..##.....##...", // 7
  "..............", // 8
  "..l..........l", // 9
  "..l..........l", // 10
  "....ccc.......", // 11
  "..............", // 12
  ".###.....###..", // 13
  "..............", // 14
  "..ccc....ccc..", // 15
  "..............", // 16
  "#####.D..#####", // 17  проход техблок → насосная, D — дверь
  "#####.ll.#####", // 18
  "#####....#####", // 19
  "..............", // 20  верх насосной
  "..##.....###..", // 21
  "..##.....###..", // 22
  "..............", // 23
  "....l.........", // 24
  "..............", // 25
  "..ccc....ccc..", // 26
  "..............", // 27
  "..##.....###..", // 28
  "..##.....###..", // 29
  "..............", // 30
  "T...ccc.......", // 31  терминал кейсов
  "...ccc........", // 32
];

/* --- сегмент D: командный отсек и антенная мачта, x 37..52 -------------- */
const SEG_D = [
  "................", // 4
  "T...............", // 5
  "..##......##....", // 6
  "..##......##....", // 7
  "...............l", // 8
  "....ccc.........", // 9
  "................", // 10
  ".####.......####", // 11
  "................", // 12
  "......cccc......", // 13
  "...............l", // 14
  "..##........##..", // 15
  "..##........##..", // 16
  "................", // 17
  ".....l..........", // 18
  ".......ccc......", // 19
  "................", // 20
  "..####....####..", // 21
  "................", // 22
  ".......####.....", // 23
  "...............l", // 24
  "..ccc...........", // 25
  "...............T", // 26  финальный терминал
  "................", // 27
  "......####......", // 28
  "................", // 29
  "..ccc......ccc..", // 30
  "...............l", // 31
  "................", // 32
];

/* --- сборка карты ------------------------------------------------------- */
function buildMap() {
  const grid = new Uint8Array(MAP_W * MAP_H).fill(TILE.FLOOR);
  const meta = { walls: [], covers: [], lights: [], terms: [], doors: [], start: null };

  const check = (seg, want, name) => {
    if (seg.length !== 29) throw new Error(name + ": ожидается 29 строк, получено " + seg.length);
    seg.forEach((row, i) => {
      if (row.length !== want) {
        throw new Error(name + ", строка " + (i + 4) + ": ожидается " + want + " символов, получено " + row.length);
      }
    });
  };
  check(SEG_A, 17, "SEG_A");
  check(SEG_BC, 14, "SEG_BC");
  check(SEG_D, 16, "SEG_D");

  const WALL_ROWS = 4;
  const put = (x, y, ch) => {
    if (ch === "#") { grid[y * MAP_W + x] = TILE.WALL; meta.walls.push([x, y]); }
    else if (ch === "c") { grid[y * MAP_W + x] = TILE.COVER; meta.covers.push([x, y]); }
    else if (ch === "l") { grid[y * MAP_W + x] = TILE.LIGHT; meta.lights.push([x, y]); }
    else if (ch === "D") { grid[y * MAP_W + x] = TILE.DOOR; meta.doors.push([x, y]); }
    else if (ch === "T") { grid[y * MAP_W + x] = TILE.TERM; meta.terms.push([x, y]); }
    else if (ch === "P") { grid[y * MAP_W + x] = TILE.START; meta.start = [x, y]; }
  };

  // верх и низ — сплошная стена
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (y < WALL_ROWS || y >= 33) { grid[y * MAP_W + x] = TILE.WALL; meta.walls.push([x, y]); }
    }
  }
  // левый и правый край
  for (let y = 0; y < MAP_H; y++) {
    for (const x of [0, 1, 53, 54, 55]) { grid[y * MAP_W + x] = TILE.WALL; meta.walls.push([x, y]); }
  }

  for (let i = 0; i < 29; i++) {
    const y = i + WALL_ROWS;
    for (let k = 0; k < SEG_A[i].length; k++) put(2 + k, y, SEG_A[i][k]);
    for (let k = 0; k < SEG_BC[i].length; k++) put(21 + k, y, SEG_BC[i][k]);
    for (let k = 0; k < SEG_D[i].length; k++) put(37 + k, y, SEG_D[i][k]);

    // разделительные колонки с проходами
    const openAB = (y === 8 || y === 9 || y === 10);       // док → техблок
    const openCD = (y === 26 || y === 27 || y === 28);     // насосная → отсек
    if (!openAB) { put(19, y, "#"); put(20, y, "#"); }
    else { put(19, y, y === 9 ? "#" : "."); put(20, y, "."); }

    if (!openCD) { put(35, y, "#"); put(36, y, "#"); }
    else { put(35, y, y === 27 ? "D" : "."); put(36, y, "."); }
  }

  return { grid, meta };
}

const MAP = buildMap();

/* --- геометрия ---------------------------------------------------------- */
const worldToCell = (wx, wy) => [Math.floor(wx / CELL), Math.floor(wy / CELL)];
const cellToWorld = (cx, cy) => [cx * CELL + CELL / 2, cy * CELL + CELL / 2];
const MAP_PX_W = MAP_W * CELL;
const MAP_PX_H = MAP_H * CELL;

const tileAt = (cx, cy) => {
  if (cx < 0 || cy < 0 || cx >= MAP_W || cy >= MAP_H) return TILE.WALL;
  return MAP.grid[cy * MAP_W + cx];
};

/** Состояние дверей. Обновляется каждый кадр: блокировка двери — это функция
    от прогресса, и без неё гейтинг задач был бы только картинкой. */
const doorOpen = {};

// Вызов — из игрового цикла: DOORS объявлен ниже, звать его на этапе
// загрузки модуля рано.
function refreshDoors() {
  for (const d of DOORS) doorOpen[d.id] = !!d.opens();
}

/** Закрывает ли клетка движение. */
function blocksMove(cx, cy) {
  const t = tileAt(cx, cy);
  if (t === TILE.WALL || t === TILE.COVER) return true;
  if (t === TILE.DOOR) {
    for (const d of DOORS) {
      if (d.cell[0] === cx && d.cell[1] === cy) return !doorOpen[d.id];
    }
  }
  return false;
}

/** Закрывает ли клетка взгляд и пулю. Стены — да, низкое укрытие — нет. */
function blocksSight(cx, cy) {
  return tileAt(cx, cy) === TILE.WALL;
}

/**
 * Луч между двумя точками по клеткам (DDA). Возвращает длину видимого
 * отрезка в метрах. Используется и для ИИ, и для оверлея линий видимости.
 */
function castRay(x0, y0, x1, y1) {
  let cx = Math.floor(x0 / CELL), cy = Math.floor(y0 / CELL);
  const ex = Math.floor(x1 / CELL), ey = Math.floor(y1 / CELL);
  if (cx === ex && cy === ey) return Math.hypot(x1 - x0, y1 - y0);

  const dx = x1 - x0, dy = y1 - y0;
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(CELL / dy) : Infinity;
  let tMaxX = dx !== 0 ? ((dx > 0 ? (cx + 1) * CELL - x0 : x0 - cx * CELL) / Math.abs(dx)) : Infinity;
  let tMaxY = dy !== 0 ? ((dy > 0 ? (cy + 1) * CELL - y0 : y0 - cy * CELL) / Math.abs(dy)) : Infinity;

  let t = 0, guard = 0;
  while (guard++ < 256) {
    if (tMaxX < tMaxY) { t = tMaxX; tMaxX += tDeltaX; cx += stepX; }
    else { t = tMaxY; tMaxY += tDeltaY; cy += stepY; }
    if (cx === ex && cy === ey) return Math.hypot(x1 - x0, y1 - y0);
    if (blocksSight(cx, cy)) return Math.min(t, Math.hypot(x1 - x0, y1 - y0));
  }
  return 0;
}

const canSee = (x0, y0, x1, y1) =>
  castRay(x0, y0, x1, y1) >= Math.hypot(x1 - x0, y1 - y0) - 0.05;

/* --- двери и условия ---------------------------------------------------- */
const DOORS = [
  {
    id: "AB", cell: [19, 9],
    opens: () => readCount >= 2,
    label: "Дверь в техблок",
    why: "Открывается, когда прочитаны оба терминала дока",
  },
  {
    id: "BC", cell: [27, 17],
    opens: () => readCount >= 3 && waveCleared("B"),
    label: "Дверь в насосную",
    why: "Открывается, когда прочитан терминал навыков и зачищен техблок",
  },
  {
    id: "CD", cell: [35, 27],
    opens: () => readCount >= 4 && waveCleared("C"),
    label: "Дверь в командный отсек",
    why: "Открывается, когда прочитан терминал кейсов и зачищена насосная",
  },
];

/* --- терминалы ---------------------------------------------------------- */
const TERMINALS = [
  {
    id: "about", cell: [4, 6], zone: "A",
    title: "О СЕБЕ", sub: "раздел 01",
  },
  {
    id: "education", cell: [9, 30], zone: "A",
    title: "ОБРАЗОВАНИЕ И ИНСТРУМЕНТЫ", sub: "раздел 02",
  },
  {
    id: "skills", cell: [30, 5], zone: "B",
    title: "НАВЫКИ", sub: "раздел 03",
  },
  {
    id: "cases", cell: [21, 31], zone: "C",
    title: "КЕЙСЫ", sub: "раздел 04",
  },
  {
    id: "method", cell: [37, 5], zone: "D",
    title: "МЕТОД РАБОТЫ", sub: "раздел 05",
  },
  {
    id: "igrotech", cell: [52, 26], zone: "D",
    title: "«ИГРО ТЭК» И КОНТАКТЫ", sub: "раздел 06",
    locked: () => !waveCleared("D"),
    lockedWhy: "Открывается после зачистки командного отсека",
  },
];

const termById = {};
TERMINALS.forEach((t) => { termById[t.id] = t; });

/* --- зоны --------------------------------------------------------------- */
const ZONES = [
  { id: "A", name: "Док",            box: [2, 4, 18, 32] },
  { id: "B", name: "Техблок",        box: [21, 4, 34, 16] },
  { id: "C", name: "Насосная",       box: [21, 20, 34, 32] },
  { id: "D", name: "Командный отсек", box: [37, 4, 52, 32] },
];

function zoneAtCell(cx, cy) {
  for (const z of ZONES) {
    const [x0, y0, x1, y1] = z.box;
    if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) return z;
  }
  return null;
}

/* --- точки спавна ------------------------------------------------------- */
/* Спавны перечислены явно, а не разбросаны по карте: их количество и место —
   это и есть бюджет волны, а не деталь планировки.                        */
const SPAWNS = {
  B: [
    { cell: [23, 5], delay: 0.0 },
    { cell: [32, 12], delay: 1.8 },
    { cell: [25, 15], delay: 3.6 },
  ],
  C1: [
    { cell: [23, 31], delay: 0.0 },
    { cell: [27, 25], delay: 0.9 },
    { cell: [32, 31], delay: 1.8 },
  ],
  C2: [
    { cell: [22, 21], delay: 0.0 },
    { cell: [34, 21], delay: 0.8 },
    { cell: [34, 30], delay: 1.6 },
  ],
  D1: [
    { cell: [39, 8], delay: 0.0 },
    { cell: [50, 8], delay: 1.0 },
    { cell: [39, 20], delay: 2.0 },
    { cell: [50, 24], delay: 3.0 },
  ],
  D2: [{ cell: [45, 18], delay: 0.0 }],
};

/* --- волны ------------------------------------------------------------- */
/* Условие проверяется каждый кадр. Как только оно стало истинным, волна
   «взводится»: стартует отсчёт задержки, и только потом враги появляются.
   Так же, как в игре: условие триггера и момент спавна — разные вещи.      */
const WAVES = [
  {
    id: "B", zone: "B", delay: 0, elite: false, spawns: SPAWNS.B,
    label: "B1 · техблок, 3 инспектора",
    cond: () => playerZone === "B" && distToCell(27, 8) < 22,
  },
  {
    id: "C", zone: "C", delay: 0, elite: false, spawns: SPAWNS.C1,
    label: "C1 · насосная, фронт",
    cond: () => playerZone === "C" && distToCell(27, 26) < 24,
  },
  {
    id: "C2", zone: "C", delay: 5.5, elite: false, spawns: SPAWNS.C2,
    label: "C2 · боковой заход",
    cond: () => waves.C.done,
  },
  {
    id: "D", zone: "D", delay: 0, elite: false, spawns: SPAWNS.D1,
    label: "D1 · отсек, 4 инспектора",
    cond: () => playerZone === "D" && distToCell(40, 14) < 20,
  },
  {
    id: "D2", zone: "D", delay: 3.5, elite: true, spawns: SPAWNS.D2,
    label: "D2 · надзиратель",
    cond: () => waves.D.done,
  },
];

/* Волны, от которых зависят двери, считаются вместе со своими продолжениями:
   пока не зачищена и вторая волна насосной, дверь в отсек закрыта.        */
function waveCleared(id) {
  if (id === "C") return waves.C.done && waves.C2.done;
  return waves[id] && waves[id].done;
}

const WAVES_BY_ID = {};
WAVES.forEach((w) => { WAVES_BY_ID[w.id] = w; });

function distToCell(cx, cy) {
  const p = player;
  const [wx, wy] = cellToWorld(cx, cy);
  return Math.hypot(wx - p.x, wy - p.y);
}

/* --- свет --------------------------------------------------------------- */
/* Радиус плафона 9 м. Ночью это почти вся видимость в зоне, поэтому свет
   расставлен неравномерно: тёмные коридоры — это часть маршрута.           */
function buildLights() {
  return MAP.meta.lights.map(([cx, cy]) => {
    const [wx, wy] = cellToWorld(cx, cy);
    return { x: wx, y: wy, r: 9 * 2.2, warm: true, flicker: false };
  });
}

/* --- метрики локации ---------------------------------------------------- */
/* Считаются из геометрии, а не вписываются руками.                        */
function computeMetrics() {
  const area = { A: 0, B: 0, C: 0, D: 0 };
  const cover = { A: 0, B: 0, C: 0, D: 0 };
  const walk = { A: 0, B: 0, C: 0, D: 0 };

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const z = zoneAtCell(x, y);
      if (!z) continue;
      const t = tileAt(x, y);
      if (t !== TILE.WALL) area[z.id] += CELL * CELL;
      if (t === TILE.COVER) cover[z.id]++;
      if (t === TILE.COVER || t === TILE.FLOOR || t === TILE.LIGHT) walk[z.id] += CELL * CELL;
    }
  }

  const floorTotal = Object.values(area).reduce((a, b) => a + b, 0);
  const coverTotal = Object.values(cover).reduce((a, b) => a + b, 0);

  // линии видимости: из каждой точки спавна во все точки интереса
  const poI = TERMINALS.map((t) => cellToWorld(t.cell[0], t.cell[1]));
  let sightSum = 0, sightCount = 0, sightOpen = 0;
  for (const key of ["B", "C1", "D2"]) {
    for (const sp of SPAWNS[key]) {
      const [sx, sy] = cellToWorld(sp.cell[0], sp.cell[1]);
      for (const [px, py] of poI) {
        const d = Math.hypot(px - sx, py - sy);
        if (castRay(sx, sy, px, py) >= d - 0.05) sightOpen++;
        sightSum += d; sightCount++;
      }
    }
  }

  const enemiesTotal = Object.values(SPAWNS).reduce((n, arr) => n + arr.length, 0);

  return {
    area, cover, walk,
    floorTotal: Math.round(floorTotal),
    coverTotal,
    lights: MAP.meta.lights.length,
    walls: MAP.meta.walls.length,
    // плотность = врагов на 100 м² игровой площади
    density: enemiesTotal / (floorTotal / 100),
    // средняя дистанция от спавна до ближайшей точки интереса
    avgSight: sightCount ? sightSum / sightCount : 0,
    // доля прямых линий видимости между спавнами и точками интереса
    sightOpenRatio: sightCount ? sightOpen / sightCount : 0,
    enemiesTotal,
    // время перехода при скорости бега 5,4 м/с по оси X — грубая верхняя оценка
    crossTime: (MAP_PX_W * 0.78) / 5.4,
  };
}

const METRICS = computeMetrics();