"use strict";

const LEVEL_NAMES = { 1: "入門", 2: "簡單", 3: "中等", 4: "困難", 5: "專家", 6: "極限" };

const MAX_N = 999;
const formatCode = (level, n) => `${level}${String(n).padStart(3, "0")}`;

function parseCode(text) {
  const s = String(text)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/\s+/g, " ")
    .trim();
  const m = s.match(/^([1-6])\s*[-－—–_.,、 ]?\s*0*(\d{1,4})$/);
  if (!m || +m[2] < 1 || +m[2] > MAX_N) return null;
  return { level: +m[1], n: +m[2] };
}

function solve(puzzle) {
  const rows = new Array(9).fill(0), cols = new Array(9).fill(0), boxes = new Array(9).fill(0);
  const cells = new Array(81).fill(0);
  const box = (i) => Math.floor(i / 27) * 3 + Math.floor((i % 9) / 3);
  for (let i = 0; i < 81; i++) {
    if (puzzle[i] === ".") continue;
    const b = 1 << (+puzzle[i] - 1);
    rows[Math.floor(i / 9)] |= b; cols[i % 9] |= b; boxes[box(i)] |= b;
    cells[i] = +puzzle[i];
  }
  const popcount = (m) => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
  function dfs() {
    let best = -1, bestMask = 0, bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (cells[i]) continue;
      const m = ~(rows[Math.floor(i / 9)] | cols[i % 9] | boxes[box(i)]) & 0x1FF;
      const n = popcount(m);
      if (n < bestN) { best = i; bestMask = m; bestN = n; if (n <= 1) break; }
    }
    if (best < 0) return true;
    const r = Math.floor(best / 9), c = best % 9, x = box(best);
    let m = bestMask;
    while (m) {
      const b = m & -m;
      m ^= b;
      rows[r] |= b; cols[c] |= b; boxes[x] |= b;
      cells[best] = 31 - Math.clz32(b) + 1;
      if (dfs()) return true;
      rows[r] ^= b; cols[c] ^= b; boxes[x] ^= b;
      cells[best] = 0;
    }
    return false;
  }
  return dfs() ? cells.join("") : null;
}
