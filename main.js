/* =========================================================================
   MAIN.JS — запуск, ввод, игровой цикл и сборка дизайн-документа.
   ========================================================================= */

let state = "boot";
let gameLocked = false;
let paused = false;
const keys = {};
const input = { mouse: { x: 0, y: 0 } };
let inputFire = false;
let showMini = true;

const G = () => $("#game");

/**
 * Клавиша для обработчика.
 *
 * Основной источник — e.code: он не зависит от раскладки, поэтому WASD
 * работает и на кириллице. Но в некоторых окружениях (удалённый рабочий
 * стол, часть экранных читалок) code приходит пустым, и игра целиком
 * перестаёт отвечать. Для таких случаев есть запасной путь через e.key.
 */
const KEY_FALLBACK = {
  Escape: "Escape", Enter: "Enter", " ": "Space", Spacebar: "Space", Space: "Space",
  ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
  PageUp: "PageUp", PageDown: "PageDown", Home: "Home", End: "End",
  Shift: "ShiftLeft",
  w: "KeyW", a: "KeyA", s: "KeyS", d: "KeyD",
  e: "KeyE", q: "KeyQ", r: "KeyR",
  1: "Digit1", 2: "Digit2", 3: "Digit3", 4: "Digit4",
  W: "KeyW", A: "KeyA", S: "KeyS", D: "KeyD",
  E: "KeyE", Q: "KeyQ", R: "KeyR",
};

const keyOf = (e) => e.code || KEY_FALLBACK[e.key] || "";

/* --- состояние покоя ---------------------------------------------------- */
/** Состояние, в котором локация стоит, а страница листается свободно. */
const resting = () => paused || gameLocked;
const restingState = () => (paused ? "paused" : gameLocked ? "locked" : "play");

/* --- три входа со стартового экрана ----------------------------------- */

/** «Интерактивное резюме»: уходим в документ и запираем локацию. */
function openDocument() {
  gameLocked = true;
  paused = false;
  showScreen(null);
  document.querySelector(".doc").scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Esc во время игры: пауза без модального окна, чтобы можно было листать. */
function pauseGame() {
  paused = true;
  showScreen(null);
}

/** Кнопка «в игру»: снимает и паузу, и замок, и возвращает к уровню. */
function resumeGame() {
  paused = false;
  gameLocked = false;
  showScreen(null);
  document.querySelector(".stage").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* --- события уровня ------------------------------------------------------ */
function onFirstContact() {
  if (stats.firstContactAt === null) stats.firstContactAt = runTime;
}

function onWaveStart(w) {
  flash("Волна: " + w.label);
}

function onWaveDone(w) {
  flash("Зона зачищена · " + w.label);
}

function onDeath() {
  setTimeout(() => {
    if (state === "panel" || state === "screen") return;
    buildReport(false);
    $("#reportTitle").textContent = "Отчёт по плейтесту · прервано";
    showScreen("report");
  }, 900);
}

/* --- взаимодействие ------------------------------------------------------- */
function nearestTerm() {
  let best = null, bd = 2.8;
  for (const t of TERMINALS) {
    const [wx, wy] = cellToWorld(t.cell[0], t.cell[1]);
    const d = Math.hypot(wx - player.x, wy - player.y);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

function tryInteract() {
  const t = nearestTerm();
  if (!t) { flash("Рядом нет терминала"); return; }
  openTerminal(t.id);
}

function doDash() {
  if (player.dashCd > 0) return;
  let dx = 0, dy = 0;
  if (keys.KeyW || keys.ArrowUp) dy -= 1;
  if (keys.KeyS || keys.ArrowDown) dy += 1;
  if (keys.KeyA || keys.ArrowLeft) dx -= 1;
  if (keys.KeyD || keys.ArrowRight) dx += 1;
  if (!dx && !dy) { dx = Math.cos(player.angle); dy = Math.sin(player.angle); }
  const m = Math.hypot(dx, dy);
  player.dashDx = dx / m; player.dashDy = dy / m;
  player.dashT = TUNE.player.dashTime;
  player.dashCd = TUNE.player.dashCd;
  stats.dashesUsed++;
  burst(player.x, player.y, 10, "#9fe0ff", 5, 0.3);
}

/* --- подсказка у терминала ------------------------------------------------ */
function drawPrompt() {
  const t = nearestTerm();
  if (!t || state !== "play") return;
  const locked = t.locked && t.locked();
  const read = readSet.has(t.id);
  const [x, y] = worldToScreen(player.x, player.y);
  const label = locked ? "ЗАКРЫТО" : read ? "E — перечитать" : "E — прочитать";
  ctx.save();
  ctx.font = "12px ui-monospace, monospace";
  const wtxt = ctx.measureText(t.title + " · " + label).width;
  const bx = x - wtxt / 2 - 12, by = y + 26;
  ctx.fillStyle = "rgba(8,12,18,0.85)";
  ctx.fillRect(bx, by, wtxt + 24, 24);
  ctx.strokeStyle = locked ? "#5a6270" : "#7fe3ff";
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, wtxt + 24, 24);
  ctx.fillStyle = locked ? "#7b8494" : "#cdefff";
  ctx.fillText(t.title + " · " + label, bx + 12, by + 16);
  ctx.restore();
}

/* --- игровой цикл --------------------------------------------------------- */
let last = 0;
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (state === "play") {
    update(dt);
    checkWin();
  }
  render();
  drawPrompt();
  drawDesignLayer();
  updateHud();
  requestAnimationFrame(loop);
}

function checkWin() {
  if (readSet.has("igrotech") && waves.D2.done && state === "play") {
    buildReport(true);
    $("#reportTitle").textContent = "Отчёт по плейтесту · объект пройден";
    showScreen("report");
  }
}

function restart() {
  resetRun();
  paused = false;
  gameLocked = false;
  showScreen(null);
  document.querySelector(".stage").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* --- ввод ------------------------------------------------------------------ */
function bindInput() {
  const cv = G();

  // Пробел и стрелки прокручивают страницу. В игре и в открытой панели
  // это ломает чтение: страница уезжает под модальным окном. Документ при
  // этом прокручивается как обычно — иначе его нельзя было бы читать.
  const SCROLL_KEYS = {
    Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
    PageUp: 1, PageDown: 1, Home: 1, End: 1,
  };

  window.addEventListener("keydown", (e) => {
    const k = keyOf(e);
    if (!k) return;
    keys[k] = true;

    const modal = !!document.querySelector(".screen.open") ||
      $("#termPanel").classList.contains("open");

    // Пробел и стрелки прокручивают страницу. В игре и в открытой панели это
    // ломает управление, там гасим всё. На паузе гасим только пробел — он
    // снимает паузу, а стрелки и PageDown нужны, чтобы листать резюме.
    const block = state === "play" || modal || (state === "paused" && k === "Space");
    if (SCROLL_KEYS[k] && block) e.preventDefault();

    if (k === "Escape") {
      e.preventDefault();
      if (state === "panel") closeTerminal();
      else if (state === "screen") showScreen(null);
      else if (resting()) resumeGame();
      else if (state === "play") pauseGame();
      else { buildBriefing(); showScreen("brief"); }
      return;
    }
    if (state !== "play") {
      // Пробел на паузе продолжает игру — так же, как на стартовом экране
      // запускал бой. Не привыкать к тому, что после паузы надо искать кнопку.
      if (k === "Space" && (state === "screen" || state === "panel" || resting())) {
        e.preventDefault();
        if (state === "panel") closeTerminal();
        else if (resting()) resumeGame();   // showScreen(null) тут не поможет:
        else showScreen(null);              // он пересчитывает состояние, но флаг паузы не снимает
      }
      if (k === "KeyR" && state === "screen") restart();
      return;
    }
    if (k === "Space") { e.preventDefault(); doDash(); }
    if (k === "KeyE") tryInteract();
    if (k === "KeyR") restart();
    if (k === "KeyQ") showMini = !showMini;
    if (k === "Digit1") designLayer = 0;
    if (k === "Digit2") designLayer = 1;
    if (k === "Digit3") designLayer = 2;
    if (k === "Digit4") designLayer = 3;
  });

  window.addEventListener("keyup", (e) => {
    const k = keyOf(e);
    if (k) keys[k] = false;
  });

  cv.addEventListener("mousemove", (e) => {
    const r = cv.getBoundingClientRect();
    input.mouse.x = e.clientX - r.left;
    input.mouse.y = e.clientY - r.top;
  });
  cv.addEventListener("mousedown", (e) => {
    if (e.button === 0 && state === "play") inputFire = true;
    if (e.button === 2 && state === "play") throwNade();
  });
  window.addEventListener("mouseup", (e) => { if (e.button === 0) inputFire = false; });
  cv.addEventListener("contextmenu", (e) => e.preventDefault());
  cv.addEventListener("wheel", (e) => {
    e.preventDefault();
    cam.scale = clamp(cam.scale * (e.deltaY > 0 ? 0.92 : 1.08), TUNE.cam.minScale, TUNE.cam.maxScale);
  }, { passive: false });

  // на телефоне: картинка есть, но играть в шутер с телефона смысла нет —
  // честнее показать документ, чем делать неудобные кнопки
  cv.addEventListener("touchstart", () => { if (window.innerWidth < 720) showDocSheet(); }, { once: true });

  $("#btnStart").addEventListener("click", () => {
    paused = false; gameLocked = false; showScreen(null);
  });
  $("#btnResume").addEventListener("click", openDocument);
  $("#btnBackToGame").addEventListener("click", resumeGame);
  $("#btnResumeGame").addEventListener("click", resumeGame);
  $("#btnRestart").addEventListener("click", restart);
  $("#btnDoc").addEventListener("click", () => { buildBriefing(); showScreen("brief"); });
  $("#termClose").addEventListener("click", closeTerminal);
  $("#reportClose").addEventListener("click", () => showScreen(null));

  $$(".layerbtn").forEach((b) => {
    b.addEventListener("click", () => {
      designLayer = Number(b.dataset.layer);
      $$(".layerbtn").forEach((x) => x.classList.toggle("on", Number(x.dataset.layer) === designLayer));
    });
  });

  // Навигация ведёт в документ, а не в игру: по ходу прохождения разделы
  // открываются сами, и подменять это было бы обманом ожидания.
  $$(".navlink").forEach((a) => {
    a.addEventListener("click", (e) => {
      const target = document.querySelector(a.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      // при открытом экране закрываем его, но замок уровня не трогаем:
      // выбранный «интерактивный» режим должен пережить переход по ссылке
      if (state === "screen") showScreen(null);
      setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    });
  });

  window.addEventListener("resize", () => {
    resize();
    drawPacingChart($("#pacingMain"), null, false);
    const cmp = $("#pacingCompare");
    if (cmp) drawPacingChart(cmp, stats.intensity, true);
  });
}

function showDocSheet() {
  $("#mobileNote").classList.add("show");
}

/* =========================================================================
   ДОКУМЕНТ — собирается из content.js и данных карты
   ========================================================================= */

function renderDocs() {
  // шапка
  $("#dName").textContent = PROFILE.name;
  $("#dRole").textContent = PROFILE.role;
  $("#dSub").textContent = PROFILE.sub;
  $("#dVacancy").textContent = PROFILE.vacancy;
  $("#dCity").textContent = PROFILE.city;

  const cs = $("#dContacts");
  PROFILE.contacts.forEach((c) => {
    const a = el("a", null, c.value);
    a.href = c.href; a.target = "_blank"; a.rel = "noopener";
    cs.appendChild(a);
  });

  const st = $("#dStats");
  STATS.forEach((s) => {
    const d = el("div", "stat");
    d.appendChild(el("div", "s-v", s.value));
    d.appendChild(el("div", "s-l", s.label));
    d.appendChild(el("div", "s-n", s.note));
    st.appendChild(d);
  });

  // лор
  const lore = $("#dLore");
  const lt = el("table", "tbl");
  LORE.rows.forEach((r) => {
    const tr = el("tr");
    tr.appendChild(el("th", null, r[0]));
    tr.appendChild(el("td", null, r[1]));
    lt.appendChild(tr);
  });
  lore.appendChild(lt);
  lore.appendChild(el("p", "callout", LORE.designNote));

  // сетка и метрики
  const lm = $("#dMetrics");
  ZONES.forEach((z) => {
    const tr = el("tr");
    tr.appendChild(el("td", null, z.id + " · " + z.name));
    tr.appendChild(el("td", null, METRICS.area[z.id] + " м²"));
    tr.appendChild(el("td", null, METRICS.cover[z.id] + ""));
    tr.appendChild(el("td", null, METRICS.walk[z.id] + " м²"));
    lm.appendChild(tr);
  });
  $("#dMetricTotal").textContent =
    METRICS.floorTotal + " м² игровой площади · " + METRICS.walls + " стен · " +
    METRICS.coverTotal + " укрытий · " + METRICS.lights + " источников света";

  // правила уровня
  const rules = $("#dRules");
  [
    ["Свет — это награда и направление",
     "Видимость выдаётся плафонами, а не ambient. Тёмный коридор читается как «здесь будет неприятно», " +
     "и игрок идёт туда только потому, что в конце видно следующий плафон."],
    ["Укрытие спасает от маршрута, а не от пули",
     "Контейнеры блокируют движение, но не блокируют взгляд и пулю. Это заставляет выглядывать, " +
     "а не сидеть: ошибка низкого укрытия в том, что игрок так и не увидит врага."],
    ["Враг телеграфирует всегда",
     "Глаз дрона загорается жёлтым за 0,6 с до выстрела. Смерть в этом уровне всегда была " +
     "предсказуемой — даже если игрок не заметил телеграфа, он увидел жёлтый круг."],
    ["Первый контакт не раньше 70-й секунды",
     "Игрок должен успеть освоить движение до того, как встретит врага. Иначе весь подъём кривой " +
     "темпа превращается в раздражение с первой минуты."],
  ].forEach((r) => {
    const c = el("div", "card");
    c.appendChild(el("div", "card-t", r[0]));
    c.appendChild(el("p", null, r[1]));
    rules.appendChild(c);
  });

  // сценарий
  const beats = $("#dBeats");
  BEATS.forEach((b) => {
    const d = el("div", "beat");
    const h = el("div", "beat-h");
    h.appendChild(el("span", "beat-n", b.n));
    h.appendChild(el("span", "beat-z", b.zone));
    d.appendChild(h);
    d.appendChild(el("div", "beat-t", b.title));
    d.appendChild(el("p", null, b.text));
    d.appendChild(el("div", "beat-o", b.out));
    beats.appendChild(d);
  });

  // таблица энкаунтеров
  const et = $("#dEncounters");
  const head = el("tr");
  ["id", "зона", "спавн", "телеграф", "HP", "TTK", "укрытие", "бюджет", "замысел"]
    .forEach((x) => head.appendChild(el("th", null, x)));
  et.appendChild(head);
  ENCOUNTERS.forEach((e) => {
    const tr = el("tr");
    [e.id, e.zone, e.spawn, e.telegraph, e.hp, e.ttk, e.cover, e.budget, e.idea].forEach((v, i) => {
      tr.appendChild(el("td", i === 8 ? "idea" : null, String(v)));
    });
    et.appendChild(tr);
  });

  // ТЗ
  const spec = $("#dSpec");
  SPEC.forEach((g) => {
    const d = el("div", "spec");
    d.appendChild(el("div", "spec-t", g.group));
    const ul = el("ul", "bullets");
    g.items.forEach((i) => ul.appendChild(el("li", null, i)));
    d.appendChild(ul);
    spec.appendChild(d);
  });

  // метод повторно не строим: он уже собран ниже в #dBody как раздел #method,
  // иначе один и тот же список шагов окажется на странице дважды

  // соответствие требованиям
  const mm = $("#dMatch");
  MATCH.groups.forEach((g) => {
    const d = el("div", "mgroup");
    d.appendChild(el("div", "mgroup-t", g.title));
    const ul = el("ul", "mlist");
    g.items.forEach((it) => {
      const li = el("li");
      li.appendChild(el("span", "mcheck", "✓"));
      li.appendChild(el("span", "mtxt", it.text));
      const a = el("a", "mref", it.refText);
      a.href = it.ref;
      li.appendChild(a);
      ul.appendChild(li);
    });
    d.appendChild(ul);
    mm.appendChild(d);
  });

  // О себе / образование / навыки / кейсы — зеркалим панели терминалов.
  // id здесь не для красоты: на них ссылается таблица соответствия
  // требованиям вакансии — каждый пункт ведёт в конкретный раздел.
  const host = $("#dBody");
  [["about", "О себе", SECTIONS.about],
   ["education", "Образование и инструменты", SECTIONS.education],
   ["skills", "Навыки", SECTIONS.skills],
   ["cases", "Кейсы", SECTIONS.cases],
   ["method", "Метод работы", SECTIONS.method],
   ["igrotech", "Про «Игро Тэк» и контакты", SECTIONS.igrotech]]
    .forEach((row) => {
      const sec = el("section", "doc-sec");
      sec.id = row[0];
      sec.appendChild(h2(row[1]));
      sec.appendChild(row[2]());
      host.appendChild(sec);
    });

  // контакты в подвале документа
  const box2 = el("div", "contacts");
  PROFILE.contacts.forEach((x) => {
    const a = el("a", "contact");
    a.href = x.href; a.target = "_blank"; a.rel = "noopener";
    a.appendChild(el("span", "c-l", x.label));
    a.appendChild(el("span", "c-v", x.value));
    box2.appendChild(a);
  });
  $("#dContacts2").appendChild(box2);
  $("#dSign").textContent = SIGN.line;

  // история версий
  const cl = $("#dChangelog");
  CHANGELOG.forEach((c) => {
    const d = el("div", "chg");
    d.appendChild(el("span", "chg-v", c.v));
    d.appendChild(el("span", "chg-d", c.date));
    d.appendChild(el("span", "chg-t", c.text));
    cl.appendChild(d);
  });
}

/* --- запуск ---------------------------------------------------------------- */
function boot() {
  canvas = G();
  ctx = canvas.getContext("2d");
  shadow = document.createElement("canvas");
  shadowCtx = shadow.getContext("2d");

  minimap.c = $("#minimap");
  minimap.x = minimap.c.getContext("2d");

  resetRun();
  renderDocs();
  buildBriefing();
  resize();
  bindInput();
  drawPacingChart($("#pacingMain"), null, false);
  showScreen("brief");
  last = performance.now();
  requestAnimationFrame(loop);
}

document.addEventListener("DOMContentLoaded", boot);