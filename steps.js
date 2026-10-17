"use strict";

const SUDOKU = (() => {
  const ROWS = [], COLS = [], BOXES = [];
  for (let r = 0; r < 9; r++) ROWS.push([...Array(9)].map((_, c) => r * 9 + c));
  for (let c = 0; c < 9; c++) COLS.push([...Array(9)].map((_, r) => r * 9 + c));
  for (let b = 0; b < 9; b++) {
    const br = Math.floor(b / 3), bc = b % 3, u = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) u.push((br * 3 + r) * 9 + bc * 3 + c);
    BOXES.push(u);
  }
  const UNITS = [...ROWS, ...COLS, ...BOXES];
  const ROW_OF = [], COL_OF = [], BOX_OF = [];
  for (let i = 0; i < 81; i++) {
    ROW_OF.push(Math.floor(i / 9));
    COL_OF.push(i % 9);
    BOX_OF.push(Math.floor(i / 27) * 3 + Math.floor((i % 9) / 3));
  }
  const PEERS = [], SEES = [];
  for (let i = 0; i < 81; i++) {
    const flag = new Uint8Array(81);
    for (const u of [ROWS[ROW_OF[i]], COLS[COL_OF[i]], BOXES[BOX_OF[i]]]) for (const j of u) flag[j] = 1;
    flag[i] = 0;
    const list = [];
    for (let j = 0; j < 81; j++) if (flag[j]) list.push(j);
    PEERS.push(list);
    SEES.push(flag);
  }
  const bit = (d) => 1 << (d - 1);
  const has = (m, d) => (m >> (d - 1)) & 1;
  const pop = (m) => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
  const digitsOf = (m) => { const out = []; for (let d = 1; d <= 9; d++) if (has(m, d)) out.push(d); return out; };
  const common = (a, b) => PEERS[a].filter((j) => SEES[b][j]);

  function* combos(arr, n, start = 0, acc = []) {
    if (acc.length === n) { yield acc.slice(); return; }
    for (let k = start; k < arr.length; k++) {
      acc.push(arr[k]);
      yield* combos(arr, n, k + 1, acc);
      acc.pop();
    }
  }

  class Grid {
    constructor(puzzle) {
      this.val = new Int8Array(81);
      this.cand = new Int16Array(81);
      for (let i = 0; i < 81; i++) if (puzzle[i] !== "." && puzzle[i] !== "0") this.val[i] = +puzzle[i];
      for (let i = 0; i < 81; i++) {
        if (this.val[i]) continue;
        let m = 0x1FF;
        for (const j of PEERS[i]) if (this.val[j]) m &= ~bit(this.val[j]);
        this.cand[i] = m;
      }
    }
    clone() {
      const g = Object.create(Grid.prototype);
      g.val = this.val.slice();
      g.cand = this.cand.slice();
      return g;
    }
    solved() { for (let i = 0; i < 81; i++) if (!this.val[i]) return false; return true; }
    place(i, d) {
      this.val[i] = d;
      this.cand[i] = 0;
      for (const j of PEERS[i]) this.cand[j] &= ~bit(d);
    }

    elimList(cells, mask) {
      const out = [];
      for (const i of cells) {
        const hit = this.cand[i] & mask;
        if (hit) for (const d of digitsOf(hit)) out.push([i, d]);
      }
      return out.length ? out : null;
    }
    apply(step) {
      if (step.place) this.place(step.place[0], step.place[1]);
      for (const [i, d] of step.elim) this.cand[i] &= ~bit(d);
    }

    conjugates(d) {
      const seen = new Set(), out = [];
      for (const u of UNITS) {
        const pos = u.filter((i) => has(this.cand[i], d));
        if (pos.length === 2) {
          const a = Math.min(pos[0], pos[1]), b = Math.max(pos[0], pos[1]), k = a * 81 + b;
          if (!seen.has(k)) { seen.add(k); out.push([a, b]); }
        }
      }
      return out.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    }
  }

  function nakedSingle(g) {
    for (let i = 0; i < 81; i++) {
      if (!g.val[i] && pop(g.cand[i]) === 1) {
        const d = digitsOf(g.cand[i])[0];
        return { place: [i, d], elim: [], cells: [i], units: [ROW_OF[i], 9 + COL_OF[i], 18 + BOX_OF[i]], digits: [d] };
      }
    }
    return null;
  }

  function hiddenSingle(g) {
    for (let k = 0; k < 27; k++) {
      for (let d = 1; d <= 9; d++) {
        const pos = UNITS[k].filter((i) => has(g.cand[i], d));
        if (pos.length === 1) return { place: [pos[0], d], elim: [], cells: [pos[0]], units: [k], digits: [d] };
      }
    }
    return null;
  }

  function locked(g) {
    for (let k = 0; k < 27; k++) {
      for (let d = 1; d <= 9; d++) {
        const pos = UNITS[k].filter((i) => has(g.cand[i], d));
        if (pos.length < 2) continue;
        for (let k2 = 0; k2 < 27; k2++) {
          if (k2 === k || !pos.every((p) => UNITS[k2].includes(p))) continue;
          const elim = g.elimList(UNITS[k2].filter((j) => !pos.includes(j)), bit(d));
          if (elim) return { place: null, elim, cells: pos, units: [k, k2], digits: [d] };
        }
      }
    }
    return null;
  }

  function subset(g, n) {
    for (let k = 0; k < 27; k++) {
      const cells = UNITS[k].filter((i) => g.cand[i]);
      if (cells.length <= n) continue;
      for (const c of combos(cells, n)) {
        let m = 0;
        for (const i of c) m |= g.cand[i];
        if (pop(m) !== n) continue;
        const elim = g.elimList(cells.filter((i) => !c.includes(i)), m);
        if (elim) return { place: null, elim, cells: c, units: [k], digits: digitsOf(m), hidden: false };
      }
      for (const ds of combos([1, 2, 3, 4, 5, 6, 7, 8, 9], n)) {
        let m = 0;
        for (const d of ds) m |= bit(d);
        const pos = cells.filter((i) => g.cand[i] & m);
        if (pos.length !== n || !ds.every((d) => pos.some((i) => has(g.cand[i], d)))) continue;
        const elim = g.elimList(pos, 0x1FF & ~m);
        if (elim) return { place: null, elim, cells: pos, units: [k], digits: ds, hidden: true };
      }
    }
    return null;
  }

  function fish(g, n) {
    for (let d = 1; d <= 9; d++) {
      for (const [baseOff, coverOff, key] of [[0, 9, COL_OF], [9, 0, ROW_OF]]) {
        const lines = [];
        for (let k = 0; k < 9; k++) lines.push(UNITS[baseOff + k].filter((i) => has(g.cand[i], d)));
        const idx = [];
        for (let k = 0; k < 9; k++) if (lines[k].length >= 2 && lines[k].length <= n) idx.push(k);
        for (const c of combos(idx, n)) {
          const covers = new Set(), base = [];
          for (const k of c) for (const i of lines[k]) { covers.add(key[i]); base.push(i); }
          if (covers.size !== n) continue;
          const cov = [...covers].sort((a, b) => a - b);
          const tgt = [];
          for (const cv of cov) for (const i of UNITS[coverOff + cv]) if (!base.includes(i)) tgt.push(i);
          const elim = g.elimList(tgt, bit(d));
          if (elim) {
            return { place: null, elim, cells: base.sort((a, b) => a - b),
              units: [...c.map((k) => baseOff + k), ...cov.map((k) => coverOff + k)], digits: [d] };
          }
        }
      }
    }
    return null;
  }

  function turbot(g) {
    for (let d = 1; d <= 9; d++) {
      const links = g.conjugates(d);
      for (const [[a1, a2], [b1, b2]] of combos(links, 2)) {
        for (const [x, y] of [[a1, a2], [a2, a1]]) {
          for (const [z, w] of [[b1, b2], [b2, b1]]) {
            if (new Set([x, y, z, w]).size < 4 || !SEES[y][z]) continue;
            const elim = g.elimList(common(x, w), bit(d));
            if (elim) return { place: null, elim, cells: [x, y, z, w], units: [], digits: [d], links: [[x, y], [z, w]] };
          }
        }
      }
    }
    return null;
  }

  function xyWing(g) {
    const bi = [];
    for (let i = 0; i < 81; i++) if (pop(g.cand[i]) === 2) bi.push(i);
    for (const p of bi) {
      const [x, y] = digitsOf(g.cand[p]);
      const wings = bi.filter((q) => SEES[p][q]);
      for (const a of wings) {
        for (const b of wings) {
          if (a === b) continue;
          const ca = g.cand[a], cb = g.cand[b];
          if (!(has(ca, x) && has(cb, y) && !has(ca, y) && !has(cb, x))) continue;
          const za = ca & ~bit(x), zb = cb & ~bit(y);
          if (za !== zb) continue;
          const z = digitsOf(za)[0];
          if (z === x || z === y) continue;
          const elim = g.elimList(common(a, b).filter((i) => i !== p), bit(z));
          if (elim) return { place: null, elim, cells: [p, a, b], units: [], digits: [z], pivotDigits: [x, y] };
        }
      }
    }
    return null;
  }

  function xyzWing(g) {
    for (let p = 0; p < 81; p++) {
      const cp = g.cand[p];
      if (pop(cp) !== 3) continue;
      const wings = PEERS[p].filter((q) => pop(g.cand[q]) === 2 && (g.cand[q] & ~cp) === 0);
      for (const [a, b] of combos(wings, 2)) {
        const cm = g.cand[a] & g.cand[b];
        if (pop(cm) !== 1 || (g.cand[a] | g.cand[b]) !== cp) continue;
        const elim = g.elimList(common(p, a).filter((i) => SEES[b][i]), cm);
        if (elim) return { place: null, elim, cells: [p, a, b], units: [], digits: digitsOf(cm) };
      }
    }
    return null;
  }

  function wWing(g) {
    const bi = [];
    for (let i = 0; i < 81; i++) if (pop(g.cand[i]) === 2) bi.push(i);
    for (const [p, q] of combos(bi, 2)) {
      if (g.cand[p] !== g.cand[q] || SEES[p][q]) continue;
      const [x, y] = digitsOf(g.cand[p]);
      for (const [link, other] of [[x, y], [y, x]]) {
        for (const [a, b] of g.conjugates(link)) {
          if (a === p || a === q || b === p || b === q) continue;
          const ok = (SEES[p][a] && SEES[q][b]) || (SEES[p][b] && SEES[q][a]);
          if (!ok) continue;
          const elim = g.elimList(common(p, q), bit(other));
          if (elim) return { place: null, elim, cells: [p, q, a, b], units: [], digits: [other], links: [[a, b]], linkDigit: link };
        }
      }
    }
    return null;
  }

  function simpleColoring(g) {
    for (let d = 1; d <= 9; d++) {
      const adj = new Map();
      for (const [a, b] of g.conjugates(d)) {
        if (!adj.has(a)) adj.set(a, []);
        if (!adj.has(b)) adj.set(b, []);
        adj.get(a).push(b);
        adj.get(b).push(a);
      }
      const seen = new Set();
      for (const start of adj.keys()) {
        if (seen.has(start)) continue;
        const color = new Map([[start, 0]]);
        const stack = [start];
        while (stack.length) {
          const n = stack.pop();
          for (const m of adj.get(n)) if (!color.has(m)) { color.set(m, 1 - color.get(n)); stack.push(m); }
        }
        for (const k of color.keys()) seen.add(k);
        if (color.size < 4) continue;
        const groups = [[], []];
        for (const [k, c] of color) groups[c].push(k);
        const links = [];
        for (const [a, b] of g.conjugates(d)) if (color.has(a)) links.push([a, b]);
        for (let c = 0; c < 2; c++) {
          const grp = groups[c];
          if ([...combos(grp, 2)].some(([a, b]) => SEES[a][b])) {
            const elim = g.elimList(grp, bit(d));
            if (elim) return { place: null, elim, cells: [...groups[0], ...groups[1]], units: [], digits: [d], links, colors: groups, wrap: c };
          }
        }
        const tgt = [];
        for (let i = 0; i < 81; i++) {
          if (!has(g.cand[i], d) || color.has(i)) continue;
          if (groups[0].some((n) => SEES[i][n]) && groups[1].some((n) => SEES[i][n])) tgt.push(i);
        }
        const elim = g.elimList(tgt, bit(d));
        if (elim) return { place: null, elim, cells: [...groups[0], ...groups[1]], units: [], digits: [d], links, colors: groups };
      }
    }
    return null;
  }

  function uniqueRectangle(g) {
    for (const [r1, r2] of combos([0, 1, 2, 3, 4, 5, 6, 7, 8], 2)) {
      for (const [c1, c2] of combos([0, 1, 2, 3, 4, 5, 6, 7, 8], 2)) {
        const cells = [r1 * 9 + c1, r1 * 9 + c2, r2 * 9 + c1, r2 * 9 + c2];
        if (new Set(cells.map((i) => BOX_OF[i])).size !== 2 || cells.some((i) => g.val[i])) continue;
        const bis = cells.filter((i) => pop(g.cand[i]) === 2);
        if (bis.length !== 3 || new Set(bis.map((i) => g.cand[i])).size !== 1) continue;
        const ab = g.cand[bis[0]];
        const extra = cells.find((i) => !bis.includes(i));
        if ((g.cand[extra] & ab) !== ab || g.cand[extra] === ab) continue;
        const elim = g.elimList([extra], ab);
        if (elim) return { place: null, elim, cells, units: [], digits: digitsOf(ab) };
      }
    }
    return null;
  }

  function aic(g, maxStrong = 8) {
    const nodes = [];
    for (let i = 0; i < 81; i++) for (const d of digitsOf(g.cand[i])) nodes.push(i * 10 + d);
    const isNode = new Set(nodes);
    const strong = new Map(nodes.map((n) => [n, []]));
    for (let i = 0; i < 81; i++) {
      if (pop(g.cand[i]) === 2) {
        const [a, b] = digitsOf(g.cand[i]);
        strong.get(i * 10 + a).push(i * 10 + b);
        strong.get(i * 10 + b).push(i * 10 + a);
      }
    }
    for (let d = 1; d <= 9; d++) {
      for (const [a, b] of g.conjugates(d)) {
        strong.get(a * 10 + d).push(b * 10 + d);
        strong.get(b * 10 + d).push(a * 10 + d);
      }
    }
    for (const list of strong.values()) list.sort((x, y) => x - y);
    const weakCache = new Map();
    const weak = (n) => {
      let w = weakCache.get(n);
      if (!w) {
        const i = Math.floor(n / 10), d = n % 10;
        w = [];
        for (const e of digitsOf(g.cand[i])) if (e !== d) w.push(i * 10 + e);
        for (const j of PEERS[i]) if (isNode.has(j * 10 + d)) w.push(j * 10 + d);
        w.sort((x, y) => x - y);
        weakCache.set(n, w);
      }
      return w;
    };
    for (const s of nodes) {
      if (!strong.get(s).length) continue;
      const ws = new Set(weak(s));
      const onParent = new Map(), offParent = new Map([[s, null]]);
      let frontier = [];
      for (const n of strong.get(s)) if (!onParent.has(n)) { onParent.set(n, s); frontier.push(n); }
      for (let depth = 0; depth < maxStrong; depth++) {
        for (const n of frontier) {
          if (n === s) continue;
          const kill = weak(n).filter((m) => ws.has(m) && m !== s && m !== n);
          if (kill.length) {
            const chain = [];
            let cur = n, on = true;
            while (cur != null) {
              chain.push([Math.floor(cur / 10), cur % 10, on]);
              cur = on ? onParent.get(cur) : offParent.get(cur);
              on = !on;
            }
            chain.reverse();
            return { place: null, elim: kill.map((m) => [Math.floor(m / 10), m % 10]),
              cells: [...new Set(chain.map((c) => c[0]))], units: [], digits: [s % 10, n % 10], chain };
          }
        }
        const next = [];
        for (const n of frontier) {
          for (const m of weak(n)) {
            if (offParent.has(m)) continue;
            offParent.set(m, n);
            for (const o of strong.get(m)) if (!onParent.has(o)) { onParent.set(o, m); next.push(o); }
          }
        }
        if (!next.length) break;
        frontier = next;
      }
    }
    return null;
  }

  function finnedFish(g, n) {
    for (let d = 1; d <= 9; d++) {
      for (const [baseOff, coverOff, key, other] of [[0, 9, COL_OF, ROW_OF], [9, 0, ROW_OF, COL_OF]]) {
        const lines = [];
        for (let k = 0; k < 9; k++) lines.push(UNITS[baseOff + k].filter((i) => has(g.cand[i], d)));
        const idx = [];
        for (let k = 0; k < 9; k++) if (lines[k].length) idx.push(k);
        for (const c of combos(idx, n)) {
          const base = [];
          for (const k of c) base.push(...lines[k]);
          const used = [...new Set(base.map((i) => key[i]))].sort((a, b) => a - b);
          if (used.length <= n) continue;
          for (const cov of combos(used, n)) {
            const fins = base.filter((i) => !cov.includes(key[i]));
            const fb = BOX_OF[fins[0]];
            if (!fins.every((i) => BOX_OF[i] === fb)) continue;
            if (!c.every((k) => lines[k].some((i) => cov.includes(key[i])))) continue;
            const tgt = [];
            for (const cv of cov) for (const i of UNITS[coverOff + cv]) if (BOX_OF[i] === fb && !c.includes(other[i])) tgt.push(i);
            const elim = g.elimList(tgt, bit(d));
            if (elim) {
              return { place: null, elim, cells: base.filter((i) => !fins.includes(i)).sort((a, b) => a - b), fins,
                units: [...c.map((k) => baseOff + k), ...cov.map((k) => coverOff + k)], digits: [d] };
            }
          }
        }
      }
    }
    return null;
  }

  function alsList(g) {
    const out = [], seen = new Set();
    for (let k = 0; k < 27; k++) {
      const cells = UNITS[k].filter((i) => !g.val[i]);
      for (let n = 1; n <= Math.min(4, cells.length - 1); n++) {
        for (const c of combos(cells, n)) {
          let m = 0;
          for (const i of c) m |= g.cand[i];
          if (pop(m) !== n + 1) continue;
          const key = c.join(",");
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ cells: c, mask: m, unit: k });
        }
      }
    }
    return out;
  }

  function alsXZ(g) {
    const als = alsList(g);
    for (let a = 0; a < als.length; a++) {
      for (let b = a + 1; b < als.length; b++) {
        const A = als[a], B = als[b];
        const com = A.mask & B.mask;
        if (pop(com) < 2 || A.cells.some((i) => B.cells.includes(i))) continue;
        for (const x of digitsOf(com)) {
          const ax = A.cells.filter((i) => has(g.cand[i], x)), bx = B.cells.filter((i) => has(g.cand[i], x));
          if (!ax.every((i) => bx.every((j) => SEES[i][j]))) continue;
          for (const z of digitsOf(com)) {
            if (z === x) continue;
            const zs = [...A.cells, ...B.cells].filter((i) => has(g.cand[i], z));
            const tgt = [];
            for (let i = 0; i < 81; i++) if (has(g.cand[i], z) && zs.every((j) => SEES[i][j])) tgt.push(i);
            const elim = g.elimList(tgt, bit(z));
            if (elim) return { place: null, elim, cells: [...A.cells, ...B.cells], als: [A.cells, B.cells],
              units: [A.unit, B.unit], digits: [z], rcc: x };
          }
        }
      }
    }
    return null;
  }

  function trace(g0, i0, d0, maxEvents = 60) {
    const cand = Array.from(g0.cand), val = Array.from(g0.val), orig = Array.from(g0.cand);
    const by = new Map();
    const ev = [];
    const fill = (j, e, why, unit, parents) => {
      const id = ev.length;
      ev.push({ cell: j, digit: e, why, unit, parents });
      for (const x of digitsOf(cand[j])) if (x !== e && !by.has(j * 10 + x)) by.set(j * 10 + x, id);
      val[j] = e;
      cand[j] = 0;
      for (const p of PEERS[j]) if (has(cand[p], e)) { cand[p] &= ~bit(e); if (!by.has(p * 10 + e)) by.set(p * 10 + e, id); }
    };
    fill(i0, d0, "assume", -1, []);
    let bad = null;
    while (ev.length < maxEvents) {
      for (let j = 0; j < 81 && !bad; j++) {
        if (!val[j] && !cand[j]) bad = { kind: "cell", cell: j, parents: digitsOf(orig[j]).map((x) => by.get(j * 10 + x)) };
      }
      for (let k = 0; k < 27 && !bad; k++) {
        for (let e = 1; e <= 9 && !bad; e++) {
          const u = UNITS[k];
          if (u.some((j) => val[j] === e || has(cand[j], e))) continue;
          bad = { kind: "unit", unit: k, digit: e, parents: u.filter((j) => has(orig[j], e)).map((j) => by.get(j * 10 + e)) };
        }
      }
      if (bad) break;
      let done = false;
      for (let j = 0; j < 81 && !done; j++) {
        if (val[j] || pop(cand[j]) !== 1) continue;
        const e = digitsOf(cand[j])[0];
        fill(j, e, "naked", -1, digitsOf(orig[j]).filter((x) => x !== e).map((x) => by.get(j * 10 + x)));
        done = true;
      }
      for (let k = 0; k < 27 && !done; k++) {
        for (let e = 1; e <= 9 && !done; e++) {
          const pos = UNITS[k].filter((j) => has(cand[j], e));
          if (pos.length !== 1) continue;
          const j = pos[0];
          fill(j, e, "hidden", k, UNITS[k].filter((m) => m !== j && has(orig[m], e)).map((m) => by.get(m * 10 + e)));
          done = true;
        }
      }
      if (!done) return null;
    }
    if (!bad) return null;
    const need = new Set([0]);
    const stack = bad.parents.filter((x) => x != null);
    while (stack.length) {
      const x = stack.pop();
      if (need.has(x)) continue;
      need.add(x);
      for (const p of ev[x].parents) if (p != null) stack.push(p);
    }
    const keep = [...need].sort((a, b) => a - b);
    const re = new Map(keep.map((x, k) => [x, k]));
    const fix = (ps) => [...new Set(ps.filter((p) => p != null).map((p) => re.get(p)))];
    return { events: keep.map((x) => ({ ...ev[x], parents: fix(ev[x].parents) })), bad: { ...bad, parents: fix(bad.parents) } };
  }

  function contradiction(g) {
    let best = null;
    for (let i = 0; i < 81; i++) {
      if (g.val[i]) continue;
      for (const d of digitsOf(g.cand[i])) {
        const t = trace(g, i, d);
        if (t && (!best || t.events.length < best.t.events.length)) best = { t, i, d };
      }
    }
    if (!best) return null;
    return { place: null, elim: [[best.i, best.d]], cells: [best.i], units: [], digits: [best.d],
      events: best.t.events, bad: best.t.bad };
  }

  const TECHNIQUES = [
    ["naked_single", 2, nakedSingle],
    ["hidden_single", 2, hiddenSingle],
    ["locked", 3, locked],
    ["pair", 3, (g) => subset(g, 2)],
    ["triple", 4, (g) => subset(g, 3)],
    ["x_wing", 4, (g) => fish(g, 2)],
    ["turbot", 4, turbot],
    ["xy_wing", 4, xyWing],
    ["xyz_wing", 4, xyzWing],
    ["w_wing", 4, wWing],
    ["swordfish", 4, (g) => fish(g, 3)],
    ["simple_coloring", 4, simpleColoring],
    ["unique_rectangle", 4, uniqueRectangle],
    ["quad", 4, (g) => subset(g, 4)],
    ["finned_x_wing", 4, (g) => finnedFish(g, 2)],
    ["finned_swordfish", 4, (g) => finnedFish(g, 3)],
    ["aic", 5, aic],
    ["als_xz", 5, alsXZ],
    ["contradiction", 6, contradiction],
  ];

  function nextStep(g) {
    for (let r = 0; r < TECHNIQUES.length; r++) {
      const [tech, tier, fn] = TECHNIQUES[r];
      const st = fn(g);
      if (st) return { tech, tier, rank: r, ...st };
    }
    return null;
  }

  function solvePath(puzzle, { keepBoards = true, stopAtTop = false } = {}) {
    const g = new Grid(puzzle);
    const steps = [];
    let tier = 2;
    while (!g.solved()) {
      const st = nextStep(g);
      if (!st) return { tier: 6, steps, stuck: { val: Array.from(g.val), cand: Array.from(g.cand) } };
      if (keepBoards) st.before = { val: Array.from(g.val), cand: Array.from(g.cand) };
      steps.push(st);
      tier = Math.max(tier, st.tier);
      if (stopAtTop && st.tier === 6) break;
      g.apply(st);
    }
    return { tier, steps, stuck: null };
  }

  function keyStep(path) {
    let best = null;
    for (const st of path.steps) if (!best || st.rank > best.rank) best = st;
    return best;
  }

  return { ROWS, COLS, BOXES, UNITS, ROW_OF, COL_OF, BOX_OF, PEERS, SEES, digitsOf, Grid, TECHNIQUES,
    nextStep, solvePath, keyStep, trace };
})();

SUDOKU.answer = (msg) => {
  if (msg.mode === "next") {
    const g = new SUDOKU.Grid(msg.puzzle);
    const st = g.solved() ? null : SUDOKU.nextStep(g);
    if (st) st.before = { val: Array.from(g.val), cand: Array.from(g.cand) };
    return { step: st, stuck: st ? null : { val: Array.from(g.val), cand: Array.from(g.cand) } };
  }
  const path = SUDOKU.solvePath(msg.puzzle, { stopAtTop: true });
  return { path: { tier: path.tier, stuck: path.stuck, steps: [] }, key: SUDOKU.keyStep(path) };
};

if (typeof self !== "undefined" && typeof self.importScripts === "function" && typeof document === "undefined") {

  self.onmessage = (e) => self.postMessage({ id: e.data.id, ...SUDOKU.answer(e.data) });
}
