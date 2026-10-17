(function () {
  const BASE = "https://sudoku.goatcounter.com";
  const LINE1 = "我愛我那環海多山的國家";
  const FALLBACK = "Author: 行路有風溫柔閣驕傲的臺灣查某囝";
  const SEAL_SRC = "./icons/seal.webp";
  const HOLD_MS = 3000, TOL = 14;

  let total = null;
  let panel = null, closing = false, back = null;
  let sealState = "";

  function ping() {
    try {
      const s = document.createElement("script");
      s.async = true;
      s.src = "https://gc.zgo.at/count.js";
      s.setAttribute("data-goatcounter", BASE + "/count");
      s.onerror = function () {};
      document.head.appendChild(s);
    } catch (e) {}
  }

  function readCount(path) {
    return fetch(BASE + "/counter/" + encodeURIComponent(path) + ".json", { mode: "cors" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        const c = j && j.count;
        const n = typeof c === "number" ? c : parseInt(String(c || "").replace(/[^0-9]/g, ""), 10);
        return isNaN(n) ? null : n;
      })
      .catch(function () { return null; });
  }
  function fetchTotal() {
    return Promise.all([readCount("TOTAL"), readCount(location.pathname)]).then(function (ns) {
      const ok = ns.filter(function (n) { return n !== null; });
      if (ok.length) total = Math.max.apply(null, ok).toLocaleString("en-US");
      return total;
    });
  }

  function countText() {
    return total ? total + " 個臺灣獨獨好的足跡" : FALLBACK;
  }

  function open() {
    if (panel) return;
    closing = false;
    back = document.activeElement;
    panel = document.createElement("div");
    panel.className = "egg";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", LINE1);
    const card = document.createElement("div");
    card.className = "eggcard";
    card.tabIndex = -1;
    const l1 = document.createElement("p");
    l1.className = "eggline";
    l1.textContent = LINE1;
    const l2 = document.createElement("p");
    l2.className = "eggcount";
    l2.textContent = countText();
    card.appendChild(l1);
    card.appendChild(l2);
    if (sealState !== "dead") {
      const seal = document.createElement("span");
      seal.className = sealState === "ok" ? "eggseal ok" : "eggseal";
      seal.setAttribute("aria-hidden", "true");
      card.appendChild(seal);
      if (sealState !== "ok") {
        const pre = new Image();
        pre.crossOrigin = "anonymous";
        pre.onload = function () { sealState = "ok"; seal.classList.add("ok"); };
        pre.onerror = function () { sealState = "dead"; seal.remove(); };
        pre.src = SEAL_SRC;
      }
    }
    panel.appendChild(card);
    card.addEventListener("click", function (e) { e.stopPropagation(); });
    panel.addEventListener("click", close);
    document.body.appendChild(panel);
    void panel.offsetWidth;
    panel.classList.add("on");
    try { card.focus({ preventScroll: true }); } catch (e) {}
    if (!total) fetchTotal().then(function () { if (panel && !closing && total) l2.textContent = countText(); });
    document.addEventListener("keydown", onKey);
  }

  function onKey(e) { if (e.key === "Escape") close(); }

  function close() {
    if (!panel || closing) return;
    closing = true;
    document.removeEventListener("keydown", onKey);
    const p = panel;
    panel = null;
    p.classList.remove("on");
    const b = back;
    back = null;
    try { if (b && b !== document.body && b.isConnected && b.focus) b.focus({ preventScroll: true }); } catch (e) {}
    let done = false;
    const drop = function () { if (!done) { done = true; p.remove(); } };
    p.addEventListener("transitionend", drop);
    setTimeout(drop, 600);
  }

  const logo = document.querySelector(".home-top h1");
  if (logo) {
    let timer = null, sx = 0, sy = 0, moved = false;
    const begin = function (x, y) {
      moved = false; sx = x; sy = y;
      clearTimeout(timer);
      timer = setTimeout(function () { if (!moved) open(); }, HOLD_MS);
    };
    const track = function (x, y) {
      if (Math.abs(x - sx) > TOL || Math.abs(y - sy) > TOL) { moved = true; clearTimeout(timer); }
    };
    const cancel = function () { clearTimeout(timer); timer = null; };
    logo.addEventListener("touchstart", function (e) { const t = e.touches[0]; begin(t.clientX, t.clientY); }, { passive: true });
    logo.addEventListener("touchmove", function (e) { const t = e.touches[0]; track(t.clientX, t.clientY); }, { passive: true });
    logo.addEventListener("touchend", cancel);
    logo.addEventListener("touchcancel", cancel);
    logo.addEventListener("mousedown", function (e) { begin(e.clientX, e.clientY); });
    logo.addEventListener("mousemove", function (e) { if (timer) track(e.clientX, e.clientY); });
    logo.addEventListener("mouseup", cancel);
    logo.addEventListener("mouseleave", cancel);
    logo.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }

  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const later = function (fn) {
    const idle = function () {
      if ("requestIdleCallback" in window) requestIdleCallback(fn, { timeout: 3000 });
      else setTimeout(fn, 1200);
    };
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
  };
  later(function () { if (!local) ping(); fetchTotal(); });
})();
