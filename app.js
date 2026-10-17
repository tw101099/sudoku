"use strict";

const DEFAULT_SETTINGS = { markErrors: false, hints: false, autoNotes: false, showTimer: true };

function readStore(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {   }
}
const settings = { ...DEFAULT_SETTINGS, ...readStore("sudoku.settings", {}) };
const saveSettings = () => writeStore("sudoku.settings", settings);

const banks = {};
async function loadBank(level) {
  if (!banks[level]) {
    const res = await fetch(`bank/${level}.txt`);
    if (!res.ok) throw new Error(`題庫載入失敗（${res.status}），請檢查網路後再試一次。`);
    banks[level] = (await res.text()).split("\n").map((s) => s.trim()).filter(Boolean);
  }
  return banks[level];
}
async function puzzleFor(code) {
  const bank = await loadBank(code.level);
  if (code.n > Math.min(bank.length, MAX_N)) return null;
  const puzzle = bank[code.n - 1];
  return { ...code, code: formatCode(code.level, code.n), puzzle, solution: solve(puzzle) };
}

const worker = (() => { try { return new Worker("steps.js"); } catch { return null; } })();
let reqId = 0;
const waiting = new Map();
if (worker) worker.onmessage = (e) => { const cb = waiting.get(e.data.id); waiting.delete(e.data.id); if (cb) cb(e.data); };
function ask(msg) {
  return new Promise((resolve) => {
    if (!worker) { resolve(SUDOKU.answer(msg)); return; }
    const id = ++reqId;
    waiting.set(id, resolve);
    worker.postMessage({ ...msg, id });
  });
}

const playKey = (code) => `sudoku.play.${code}`;
function loadPlay(code) {
  const s = readStore(playKey(code), null);
  return {
    entries: s && s.entries ? s.entries.split("").map((c) => (c === "." ? 0 : +c)) : new Array(81).fill(0),
    notes: s && s.notes ? s.notes.slice() : new Array(81).fill(0),
    elapsed: (s && s.elapsed) || 0,
    done: !!(s && s.done),
    started: !!(s && s.started),
    marked: !!(s && s.marked),
  };
}
function savePlay() {
  if (!current) return;
  tick();
  writeStore(playKey(current.code), {
    entries: play.entries.map((v) => v || ".").join(""),
    notes: play.notes,
    elapsed: Math.round(play.elapsed),
    done: play.done,
    started: play.started,
    marked: play.marked,
  });
}
function remember(code) {
  const list = readStore("sudoku.history", []).filter((h) => h.code !== code);
  list.unshift({ code, at: Date.now() });
  writeStore("sudoku.history", list.slice(0, 500));
}

const $ = (id) => document.getElementById(id);
let current = null;
let play = null;
let mode = "play";
let modeBeforeView = "play";
let sel = -1;
let noteMode = false;
let undoStack = [];
let runningSince = null;
let analysis = null;
let view = null;
let level = +readStore("sudoku.level", 2);
if (!LEVEL_NAMES[level]) level = 2;

const isGiven = (i) => current.puzzle[i] !== ".";
const valueAt = (i) => (isGiven(i) ? +current.puzzle[i] : play.entries[i]);
const bit = (d) => 1 << (d - 1);
const hasEntries = () => play.entries.some((v) => v);

function tick() {
  if (runningSince != null) {
    const now = performance.now();
    play.elapsed += now - runningSince;
    runningSince = now;
  }
}
function syncTimer() {
  const run = play && play.started && !play.done && mode === "play" && !$("game").hidden && !document.hidden;
  if (run) { if (runningSince == null) runningSince = performance.now(); } else { tick(); runningSince = null; }
}
function fmt(ms) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
function renderTimer() {
  if (!play) return;
  tick();
  $("timer").hidden = !play.started || !settings.showTimer;
  $("timer-text").textContent = fmt(play.elapsed);
  $("more-timer-label").textContent = settings.showTimer ? "隱藏計時" : "顯示計時";
}
setInterval(() => { if (runningSince != null && settings.showTimer) renderTimer(); }, 1000);

let toastTimer = null;
function toast(text, ms = 2600) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

let fitPending = false;
const refit = () => { if (fitPending) return; fitPending = true; requestAnimationFrame(() => { fitPending = false; fitBoard(); }); };
const stageObserver = new ResizeObserver(refit);
for (const el of [$("stage"), $("dock"), document.querySelector(".topbar")]) stageObserver.observe(el);
window.addEventListener("resize", refit);
function fitBoard() {
  const st = $("stage");
  const cs = getComputedStyle(st);
  const w = st.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const h = st.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const size = Math.max(200, Math.floor(Math.min(w, h, 760)));
  if (size > 0) $("board-wrap").style.setProperty("--board", `${size}px`);

  const g = $("game");
  if (window.matchMedia("(orientation: landscape) and (min-width: 560px)").matches) {
    const cur = parseFloat(g.style.getPropertyValue("--side-pad")) || 0;

    const target = Math.min(h, 760);
    const next = Math.max(0, cur + (w - target) / 2);
    if (Math.abs(next - cur) > 1) { g.style.setProperty("--side-pad", `${Math.floor(next)}px`); refit(); }
  } else if (g.style.getPropertyValue("--side-pad")) { g.style.removeProperty("--side-pad"); refit(); }
}

function autoCand(i) {
  let m = 0x1FF;
  for (const j of SUDOKU.PEERS[i]) { const v = valueAt(j); if (v) m &= ~bit(v); }
  return m;
}
function noteGrid(mask, key, struck) {
  const wrap = document.createElement("div");
  wrap.className = "notes";
  for (let d = 1; d <= 9; d++) {
    const s = document.createElement("span");
    if (mask & bit(d)) {
      s.textContent = d;
      if (struck && struck.includes(d)) s.className = "x";
      else if (key && key.includes(d)) s.className = "k";
    }
    wrap.appendChild(s);
  }
  return wrap;
}
function newCell(i) {
  const c = document.createElement("div");
  c.className = "cell";
  c.setAttribute("role", "gridcell");
  c.dataset.i = i;
  return c;
}

function renderBoard() {
  if (view) return renderView();
  const board = $("board");
  board.classList.remove("viewing");
  board.textContent = "";
  $("marks").textContent = "";
  const showAns = mode === "answer";
  const selVal = sel >= 0 ? valueAt(sel) : 0;
  for (let i = 0; i < 81; i++) {
    const c = newCell(i);
    const sol = current.solution ? +current.solution[i] : 0;
    if (isGiven(i)) {
      c.textContent = current.puzzle[i];
      c.classList.add("given");
    } else if (showAns) {
      c.textContent = sol;
      c.classList.add(play.entries[i] === sol ? "mine" : "answer");
    } else if (play.entries[i]) {
      c.textContent = play.entries[i];
      c.classList.add("mine");
      if (settings.markErrors && play.entries[i] !== sol) c.classList.add("wrong");
    } else if (mode === "play" || mode === "done") {
      const m = play.notes[i] || (settings.autoNotes && mode === "play" ? autoCand(i) : 0);
      if (m) c.appendChild(noteGrid(m));
    }
    if (mode === "play" && sel >= 0) {
      if (i === sel) c.classList.add("sel");
      else if (SUDOKU.SEES[sel][i]) c.classList.add("peer");
      if (selVal && i !== sel && valueAt(i) === selVal) c.classList.add("same");
    }
    board.appendChild(c);
  }
}

function renderView() {
  const fr = view.frames[view.idx];
  const board = $("board");
  board.classList.add("viewing");
  board.textContent = "";
  const color = new Map();
  for (const k of fr.units) for (const i of SUDOKU.UNITS[k]) color.set(i, "u");
  for (const i of fr.clue) color.set(i, "clue");
  for (const i of fr.clue2) color.set(i, "clue2");
  for (const i of fr.target) color.set(i, "target");
  for (let i = 0; i < 81; i++) {
    const c = newCell(i);
    const v = view.before.val[i];
    if (v) {
      c.textContent = v;
      c.classList.add(view.puzzle[i] !== "." ? "given" : "solved");
    } else if (fr.placed && fr.placed[0] === i) {
      c.textContent = fr.placed[1];
      c.classList.add("placed");
    } else if (fr.fills.some(([j]) => j === i)) {
      c.textContent = fr.fills.find(([j]) => j === i)[1];
      c.classList.add("placed");
    } else if (fr.cand.includes(i)) {
      c.appendChild(noteGrid(view.before.cand[i], fr.key, fr.struck[i]));
    }
    if (color.has(i)) c.classList.add("on");
    if (fr.cross.includes(i)) c.classList.add("cross");
    if (fr.focus.includes(i)) c.classList.add("focus");
    board.appendChild(c);
  }
  const svg = $("marks");
  svg.textContent = "";
  const NS = "http://www.w3.org/2000/svg";
  const rect = (x, y, w, h, cls) => {
    const r = document.createElementNS(NS, "rect");
    r.setAttribute("x", x); r.setAttribute("y", y); r.setAttribute("width", w); r.setAttribute("height", h);
    r.setAttribute("class", cls);
    svg.appendChild(r);
  };

  svg.insertAdjacentHTML("beforeend",
    '<defs><pattern id="hatch" patternUnits="userSpaceOnUse" width=".22" height=".22" patternTransform="rotate(45)">' +
    '<line class="hatch-line" x1="0" y1="0" x2="0" y2=".22"/></pattern></defs>');
  for (const [i, cls] of color) {
    const x = i % 9, y = Math.floor(i / 9);

    rect(x, y, 1, 1, cls);
    if (cls === "target") rect(x, y, 1, 1, "hatch");
  }

  for (const k of fr.units) {
    const [x, y, w, h] = k < 9 ? [0, k, 9, 1] : k < 18 ? [k - 9, 0, 1, 9] : [((k - 18) % 3) * 3, Math.floor((k - 18) / 3) * 3, 3, 3];
    rect(x, y, w, h, "ring");
  }
  for (const [a, b, kind] of fr.lines) {
    let x1 = (a % 9) + 0.5, y1 = Math.floor(a / 9) + 0.5, x2 = (b % 9) + 0.5, y2 = Math.floor(b / 9) + 0.5;
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len > 0.8) {
      const t = 0.3 / len;
      [x1, y1, x2, y2] = [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, x2 - (x2 - x1) * t, y2 - (y2 - y1) * t];
    }
    const ln = document.createElementNS(NS, "line");
    ln.setAttribute("x1", x1); ln.setAttribute("y1", y1); ln.setAttribute("x2", x2); ln.setAttribute("y2", y2);
    if (kind !== "strong") ln.setAttribute("class", "weak");
    svg.appendChild(ln);
  }
  $("explain-tech").textContent = `${view.title}・${view.name}`;
  $("explain-count").textContent = view.frames.length > 1 ? `${view.idx + 1}／${view.frames.length}` : "";
  $("explain-text").textContent = fr.text;
  $("explain-text").scrollTop = 0;
  $("prev-frame").disabled = view.idx === 0;
  const last = view.idx === view.frames.length - 1;
  $("next-label").textContent = last ? "看完了" : "下一步";
  $("next-icon").setAttribute("href", last ? "#i-check" : "#i-next");
}

function render() {
  if (!current) return;
  $("code").textContent = current.code;
  const ln = $("level-name");
  ln.textContent = "";
  const dot = document.createElement("span");
  dot.className = "lv-dot";
  dot.dataset.level = current.level;
  ln.append(dot, ` ${LEVEL_NAMES[current.level]}`);
  const dock = $("dock");
  dock.dataset.mode = view ? "explain" : mode;
  dock.classList.toggle("noting", noteMode && mode === "play");
  $("note-mode").setAttribute("aria-pressed", String(noteMode));
  $("hint").hidden = !settings.hints;

  $("back-label").textContent = view ? "結束解說" : "首頁";
  $("back-icon").innerHTML = `<use href="${view ? "#i-close" : "#i-back"}"/>`;
  $("peek").hidden = !!view || !(mode === "play" || mode === "done");

  const timed = play.done && play.started && !play.marked && play.elapsed > 0;
  $("done-msg").textContent = play.done ? `拄拄好！獨獨好！${timed ? `
用時 ${fmt(play.elapsed)}` : ""}` : "";
  $("mark-done").hidden = play.done;
  renderBoard();
  renderTimer();
}

function setMode(m) {
  mode = m;
  if (m !== "play") sel = -1;
  syncTimer();
  render();
}

let wakeLock = null;
async function keepAwake(on) {

  try {
    if (on && "wakeLock" in navigator && !wakeLock && !document.hidden) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}
function showHome() {
  if (current) { tick(); runningSince = null; savePlay(); }
  view = null;
  for (const d of document.querySelectorAll("dialog[open]")) d.close();
  $("game").hidden = true;
  $("home").hidden = false;
  document.title = "獨獨好｜家己的數獨家己解";
  keepAwake(false);
  renderHistory();
  renderInstall();
}
function showGame() {
  $("home").hidden = true;
  $("game").hidden = false;
  document.title = `${current.code}・獨獨好`;
  keepAwake(true);
  fitBoard();
  syncTimer();
  render();
}

async function openPuzzle(p, how, { push = true } = {}) {
  if (current) { tick(); runningSince = null; savePlay(); }
  current = p;
  play = loadPlay(p.code);
  sel = -1;
  noteMode = false;
  undoStack = [];
  analysis = null;
  view = null;
  if (play.done) mode = "done";
  else if (how === "code" && !play.started) mode = "check";
  else mode = "play";
  remember(p.code);
  const state = { screen: "game", code: p.code };
  if (push) history.pushState(state, "", `#${p.code}`);
  else history.replaceState(state, "", `#${p.code}`);
  showGame();
  if (how === "new") showCopyCard();
}

async function openCode(text, how = "code", opts) {
  const msg = $("lookup-msg");
  msg.textContent = "";
  const code = parseCode(text);
  if (!code) { msg.textContent = "這組題號不對，請再確認一下。"; return false; }
  try {
    const p = await puzzleFor(code);
    if (!p) { msg.textContent = "找不到這組題號的題目，請再確認一下。"; return false; }
    await openPuzzle(p, how, opts);
    return true;
  } catch (e) {
    msg.textContent = e.message;
    return false;
  }
}

async function newPuzzle({ replace = false } = {}) {
  try {
    const bank = await loadBank(level);

    const done = new Set(readStore("sudoku.history", []).map((h) => parseCode(h.code))
      .filter((c) => c && c.level === level).map((c) => c.n));
    const fresh = [];
    const count = Math.min(bank.length, MAX_N);
    for (let n = 1; n <= count; n++) if (!done.has(n)) fresh.push(n);
    const pool = fresh.length ? fresh : [...Array(count)].map((_, k) => k + 1);
    const n = pool[Math.floor(Math.random() * pool.length)];
    await openPuzzle(await puzzleFor({ level, n }), "new", { push: !replace });
  } catch (e) {
    $("lookup-msg").textContent = e.message;
  }
}

function goHome() {
  const forceHome = () => {
    history.replaceState({ screen: "home" }, "", location.pathname + location.search);
    showHome();
  };
  const st = history.state || {};
  if (homeBelow && (st.screen === "explain" || st.screen === "game")) {
    history.go(st.screen === "explain" ? -2 : -1);

    setTimeout(() => { if ($("home").hidden) forceHome(); }, 400);
    return;
  }
  forceHome();
}

let homeBelow = false;

window.addEventListener("popstate", (e) => {
  const st = e.state || {};
  for (const d of document.querySelectorAll("dialog[open]")) d.close();
  if (st.screen === "explain" && current) return;
  if (st.screen === "game" && current && st.code === current.code) {
    if (view) { view = null; render(); }
    if ($("game").hidden) showGame();
    return;
  }
  if (st.screen === "game" && st.code) { openCode(st.code, "code", { push: false }); return; }
  showHome();
});

window.addEventListener("hashchange", () => {
  if (history.state) return;
  const c = parseCode(decodeURIComponent(location.hash.slice(1)));
  if (!c) { history.replaceState({ screen: "home" }, "", location.pathname + location.search); showHome(); return; }
  homeBelow = true;
  openCode(formatCode(c.level, c.n), "code", { push: false });
});

function showCopyCard() {
  $("copy-code").textContent = current.code;
  $("copy-text").textContent = `寫完回來，在首頁「對答案」輸入 ${current.code}，就能看到答案。想直接在螢幕上寫也可以。`;
  $("copy-card").showModal();
}

function peek() {
  if (play.started && !play.done && hasEntries()) { $("confirm-peek").showModal(); return; }
  setMode("answer");
}

function openView(title, info, before, puzzle) {
  modeBeforeView = mode;
  view = { title, name: info.name, frames: info.frames, idx: 0, before, puzzle };
  history.pushState({ screen: "explain", code: current.code }, "", `#${current.code}`);
  syncTimer();
  render();
}
function closeView() {
  if (history.state && history.state.screen === "explain") history.back();
  else { view = null; render(); }
}

async function showKeyStep() {
  const code = current.code;
  const btn = $("key-step");
  btn.disabled = true;
  btn.firstElementChild.textContent = "分析中…";
  if (!analysis || analysis.code !== code) analysis = { code, ...(await ask({ mode: "path", puzzle: current.puzzle })) };
  btn.disabled = false;
  btn.firstElementChild.textContent = "看這題的關鍵一步";
  if (!current || current.code !== code) return;
  if (analysis.path.stuck) openView("關鍵一步", EXPLAIN.stuck(), analysis.path.stuck, current.puzzle);
  else openView("關鍵一步", EXPLAIN.explain(analysis.key), analysis.key.before, current.puzzle);
}

async function hint() {
  if (mode !== "play" || play.done) return;

  const state = [...current.puzzle].map((ch, i) =>
    ch !== "." ? ch : play.entries[i] && play.entries[i] === +current.solution[i] ? String(play.entries[i]) : ".").join("");
  const code = current.code;
  $("hint").disabled = true;
  const res = await ask({ mode: "next", puzzle: state });
  $("hint").disabled = false;
  if (!current || current.code !== code) return;
  if (!res.step) openView("提示", EXPLAIN.stuck(), res.stuck, current.puzzle);
  else openView("提示", EXPLAIN.explain(res.step), res.step.before, current.puzzle);
}

function change(list) {

  undoStack.push(list.map(([i]) => [i, play.entries[i], play.notes[i]]));
  if (undoStack.length > 300) undoStack.shift();
  for (const [i, e, n] of list) { play.entries[i] = e; play.notes[i] = n; }
  if (!play.started) play.started = true;
  afterChange();
}

function afterChange() {
  if (current.solution && play.entries.every((v, i) => v || isGiven(i))) {
    const ok = play.entries.every((v, i) => isGiven(i) || v === +current.solution[i]);
    if (ok) {
      tick();
      play.done = true;
      mode = "done";
    } else {

      toast("填滿了，但還有錯，再檢查看看。", 7000);
    }
  }
  syncTimer();
  savePlay();
  render();
}

function input(d) {
  if (mode !== "play" || view) return;
  if (sel < 0) { toast("先點一個空格，再按數字。"); return; }
  if (isGiven(sel)) { toast("這是題目本來就有的數字，不能改。"); return; }
  if (noteMode) {
    if (play.entries[sel]) { toast("這格已經填了數字，要先擦掉才能寫筆記。"); return; }
    const base = play.notes[sel] || (settings.autoNotes ? autoCand(sel) : 0);
    change([[sel, 0, base ^ bit(d)]]);
    return;
  }
  const next = play.entries[sel] === d ? 0 : d;
  const list = [[sel, next, 0]];

  if (next) for (const j of SUDOKU.PEERS[sel]) if (play.notes[j] & bit(d)) list.push([j, play.entries[j], play.notes[j] & ~bit(d)]);
  change(list);
}
function erase() {
  if (mode !== "play" || view) return;
  if (sel < 0) { toast("先點一格，再按擦掉。"); return; }
  if (isGiven(sel)) { toast("這是題目本來就有的數字，不能擦。"); return; }
  if (play.entries[sel] || play.notes[sel]) change([[sel, 0, 0]]);
}
function undo() {
  if (mode !== "play" || view) return;
  if (!undoStack.length) { toast("沒有可以復原的了。"); return; }
  for (const [i, e, n] of undoStack.pop()) { play.entries[i] = e; play.notes[i] = n; }
  afterChange();
}

function renderHistory() {
  const list = readStore("sudoku.history", []);
  $("history-wrap").hidden = list.length === 0;

  let done = 0;
  for (const h of list) { const p = parseCode(h.code); if (p) { const st = readStore(playKey(formatCode(p.level, p.n)), null); if (st && st.done) done++; } }
  $("done-count").textContent = done ? `（完成 ${done} 題）` : "";
  const ul = $("history");
  ul.textContent = "";
  for (const h of list.slice(0, 30)) {
    const p = parseCode(h.code);
    if (!p) continue;
    const code = formatCode(p.level, p.n);
    const st = readStore(playKey(code), null);
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    const c = document.createElement("span");
    c.className = "h-code";
    c.textContent = code;
    const lv = document.createElement("span");
    lv.className = "h-level";
    const dot = document.createElement("span");
    dot.className = "lv-dot";
    dot.dataset.level = p.level;
    lv.append(dot, ` ${LEVEL_NAMES[p.level]}・${new Date(h.at).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })}`);
    btn.append(c, lv);
    if (st && (st.done || st.started)) {
      const tag = document.createElement("span");
      tag.className = st.done ? "h-tag done" : "h-tag";
      tag.textContent = st.done ? "完成" : "寫到一半";
      btn.appendChild(tag);
    }
    btn.addEventListener("click", () => openCode(code, "code"));
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

(function standaloneHeightFix() {
  const game = $("game");
  const root = document.documentElement;
  function apply() {
    game.style.height = "";
    root.style.removeProperty("--sab-fix");
    if (!standalone() || !window.screen || !window.matchMedia("(orientation: portrait)").matches) return;
    const a = window.screen.width, b = window.screen.height;
    if (!a || !b) return;
    const fullH = Math.max(a, b), fullW = Math.min(a, b);
    const gap = fullH - window.innerHeight;
    if (gap > 15 && gap < 100 && Math.abs(fullW - window.innerWidth) < 2) {
      game.style.height = fullH + "px";

      const sab = fullW >= 700 ? 20 : gap >= 40 ? 34 : 0;
      if (sab) root.style.setProperty("--sab-fix", sab + "px");
    }
  }

  const applyAndRefit = () => { apply(); refit(); };
  apply();
  window.addEventListener("orientationchange", () => setTimeout(applyAndRefit, 250));
  window.addEventListener("resize", applyAndRefit);
})();
function renderInstall() {
  const card = $("install-card");
  if (standalone() || readStore("sudoku.installSeen", false)) { card.hidden = true; return; }
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  $("install-text").textContent = ios
    ? "在 Safari 按「分享」按鈕（方框加向上箭頭），往下找「加入主畫面」。之後從主畫面打開，就像一個 App，沒有網路也能用，寫的紀錄也比較不會被清掉。"
    : "按瀏覽器右上角的選單（三個點），選「安裝應用程式」或「加到主畫面」。之後從主畫面打開，就像一個 App，沒有網路也能用。";
  card.hidden = false;
}

function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);

  const tc = document.querySelector('meta[name="theme-color"]');
  const chrome = getComputedStyle(document.documentElement).getPropertyValue("--chrome").trim();
  if (tc && chrome) tc.setAttribute("content", chrome);
  $("theme-label").textContent = t === "dark" ? "明色" : "暗色";
  $("dark-switch").checked = t === "dark";
}
function setTheme(t) {
  try { localStorage.setItem("sudoku.theme", t); } catch {   }
  applyTheme(t);
}

function printPuzzle() {
  for (const d of document.querySelectorAll("dialog[open]")) d.close();
  const prevMode = mode, prevView = view;
  view = null;
  mode = "check";
  renderBoard();
  $("print-date").textContent = new Date().toLocaleDateString("zh-TW");
  $("print-code").textContent = `題號 ${current.code}`;
  $("print-level").textContent = LEVEL_NAMES[current.level];
  $("print-foot").textContent = `寫完到 ${location.host}${location.pathname} 輸入 ${current.code} 對答案`;
  const restore = () => { mode = prevMode; view = prevView; render(); window.removeEventListener("afterprint", restore); };
  window.addEventListener("afterprint", restore);
  window.print();
  setTimeout(() => { if (mode !== prevMode || view !== prevView) restore(); }, 1500);
}

function renderLevels() {
  document.querySelectorAll(".levels button").forEach((b) => {
    b.setAttribute("aria-checked", +b.dataset.level === level ? "true" : "false");
  });
}
document.querySelectorAll(".levels button").forEach((b) => {
  b.addEventListener("click", () => { level = +b.dataset.level; writeStore("sudoku.level", level); renderLevels(); });
});
$("new").addEventListener("click", () => newPuzzle());
$("lookup").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("code-input").blur();
  if (await openCode($("code-input").value, "code")) $("code-input").value = "";
});
const dismissInstall = () => { writeStore("sudoku.installSeen", true); renderInstall(); };
$("install-ok").addEventListener("click", dismissInstall);
$("install-close").addEventListener("click", dismissInstall);
$("toggle-theme").addEventListener("click", () => setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"));
$("dark-switch").addEventListener("change", (e) => setTheme(e.target.checked ? "dark" : "light"));
$("open-settings").addEventListener("click", () => openSettings());
function openSettings() {
  document.querySelectorAll("[data-setting]").forEach((el) => { el.checked = !!settings[el.dataset.setting]; });
  $("settings").showModal();
}
document.querySelectorAll("[data-setting]").forEach((el) => {
  el.addEventListener("change", () => { settings[el.dataset.setting] = el.checked; saveSettings(); if (current) render(); });
});
$("settings-close").addEventListener("click", () => $("settings").close());

$("back").addEventListener("click", () => (view ? closeView() : goHome()));
$("peek").addEventListener("click", peek);
$("board").addEventListener("click", (e) => {
  const c = e.target.closest(".cell");
  if (!c || view) return;
  if (mode === "check") { toast("要在螢幕上寫，請先按下面的「在螢幕上寫」。"); return; }
  if (mode !== "play") return;
  sel = +c.dataset.i;
  render();
});
document.querySelectorAll("#dock [data-d]").forEach((b) => b.addEventListener("click", () => input(+b.dataset.d)));
$("erase").addEventListener("click", erase);
$("undo").addEventListener("click", undo);
$("note-mode").addEventListener("click", () => {
  noteMode = !noteMode;
  toast(noteMode ? "筆記模式：按數字會寫成小字。" : "回到填數字。", 1800);
  render();
});
$("hint").addEventListener("click", hint);
$("open-more").addEventListener("click", () => $("more").showModal());
$("timer").addEventListener("click", () => { settings.showTimer = false; saveSettings(); renderTimer(); toast("計時藏起來了，可以從「更多」打開。"); });

$("show-answer").addEventListener("click", () => setMode("answer"));
$("write-here").addEventListener("click", () => setMode("play"));
$("print-check").addEventListener("click", printPuzzle);
$("key-step").addEventListener("click", showKeyStep);
$("hide-answer").addEventListener("click", () => setMode(play.done ? "done" : "play"));

$("mark-done").addEventListener("click", () => {
  if (play.done) return;
  tick();
  play.done = true;
  play.marked = true;
  savePlay();
  setMode("done");
  renderHistory();
});
$("prev-frame").addEventListener("click", () => { if (view && view.idx > 0) { view.idx--; renderView(); } });
$("next-frame").addEventListener("click", () => {
  if (!view) return;
  if (view.idx < view.frames.length - 1) { view.idx++; renderView(); } else closeView();
});
$("again").addEventListener("click", () => { level = current.level; newPuzzle({ replace: true }); });
$("done-answer").addEventListener("click", () => setMode("answer"));
$("done-home").addEventListener("click", goHome);

$("copy-ok").addEventListener("click", () => $("copy-card").close());
$("copy-print").addEventListener("click", printPuzzle);
$("peek-cancel").addEventListener("click", () => $("confirm-peek").close());
$("peek-ok").addEventListener("click", () => { $("confirm-peek").close(); setMode("answer"); });
$("more-print").addEventListener("click", printPuzzle);
$("more-answer").addEventListener("click", () => { $("more").close(); peek(); });
$("more-timer").addEventListener("click", () => { settings.showTimer = !settings.showTimer; saveSettings(); renderTimer(); $("more").close(); });
$("more-settings").addEventListener("click", () => { $("more").close(); openSettings(); });
$("more-home").addEventListener("click", () => { $("more").close(); goHome(); });
$("more-close").addEventListener("click", () => $("more").close());

for (const d of document.querySelectorAll("dialog")) {
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
}

document.addEventListener("keydown", (e) => {
  if ($("game").hidden || e.target.closest("input, dialog") || e.ctrlKey || e.metaKey || e.altKey) return;
  if (view) {
    if (e.key === "ArrowRight") $("next-frame").click();
    else if (e.key === "ArrowLeft") $("prev-frame").click();
    else if (e.key === "Escape") closeView();
    return;
  }
  if (mode !== "play") return;
  if (/^[1-9]$/.test(e.key)) { input(+e.key); e.preventDefault(); }
  else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") { erase(); e.preventDefault(); }
  else if (e.key === "n" || e.key === "N") $("note-mode").click();
  else if (e.key.startsWith("Arrow")) {
    if (sel < 0) sel = 0;
    else {
      const r = Math.floor(sel / 9), c = sel % 9;
      const [dr, dc] = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      sel = ((r + dr + 9) % 9) * 9 + ((c + dc + 9) % 9);
    }
    render();
    e.preventDefault();
  }
});
document.addEventListener("visibilitychange", () => {
  syncTimer();
  if (document.hidden) savePlay(); else if (!$("game").hidden) keepAwake(true);
});
window.addEventListener("pagehide", () => { tick(); savePlay(); });

(function migrateCodes() {
  try {
    const list = readStore("sudoku.history", []);
    let changed = false;
    for (const h of list) {
      const p = parseCode(h.code);
      if (!p) continue;
      const code = formatCode(p.level, p.n);
      if (code === h.code) continue;
      const old = localStorage.getItem(playKey(h.code));
      if (old && !localStorage.getItem(playKey(code))) localStorage.setItem(playKey(code), old);
      if (old) localStorage.removeItem(playKey(h.code));
      h.code = code;
      changed = true;
    }
    if (changed) writeStore("sudoku.history", list.filter((h, i, a) => a.findIndex((x) => x.code === h.code) === i));
  } catch {   }
})();
applyTheme(document.documentElement.getAttribute("data-theme") || "light");
renderLevels();

document.addEventListener("pointerdown", function once() {
  document.removeEventListener("pointerdown", once);
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch {   }
});
(() => {
  const c = parseCode(decodeURIComponent(location.hash.slice(1)));
  if (c) {

    history.replaceState({ screen: "home" }, "", location.pathname + location.search);
    homeBelow = true;
    showHome();
    openCode(formatCode(c.level, c.n), "code");
  } else {
    history.replaceState({ screen: "home" }, "", location.pathname + location.search);
    showHome();
  }
})();

const _push = history.pushState.bind(history);
history.pushState = (st, t, u) => { if (st && st.screen === "game") homeBelow = true; _push(st, t, u); };

if ("serviceWorker" in navigator && location.hostname !== "localhost") {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
