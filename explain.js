"use strict";

const EXPLAIN = (() => {
  const { UNITS, ROW_OF, COL_OF, SEES, digitsOf } = SUDOKU;

  const TECH_NAMES = {
    naked_single: "唯一候選數",
    hidden_single: "隱性唯一",
    locked: "區塊排除",
    pair: "數對",
    triple: "數組（三個數字）",
    quad: "數組（四個數字）",
    x_wing: "X-Wing",
    swordfish: "劍魚（Swordfish）",
    turbot: "摩天樓／風箏（Skyscraper／2-String Kite）",
    xy_wing: "XY-Wing",
    xyz_wing: "XYZ-Wing",
    w_wing: "W-Wing",
    simple_coloring: "著色法（Simple Coloring）",
    unique_rectangle: "唯一矩形（Unique Rectangle）",
    aic: "推理鏈",
    finned_x_wing: "帶鰭 X-Wing（Finned X-Wing）",
    finned_swordfish: "帶鰭劍魚（Finned Swordfish）",
    als_xz: "ALS-XZ（兩組格子互相牽制）",
    contradiction: "假設法（試試看，推到矛盾）",
  };

  const cell = (i) => `第 ${ROW_OF[i] + 1} 列第 ${COL_OF[i] + 1} 欄`;
  const word = (k) => (k < 9 ? "列" : k < 18 ? "欄" : "宮");
  const unit = (k) => (k < 9 ? `第 ${k + 1} 列` : k < 18 ? `第 ${k - 8} 欄` : `第 ${k - 17} 宮`);
  const list = (xs) => (xs.length <= 1 ? String(xs[0] ?? "") : `${xs.slice(0, -1).join("、")} 和 ${xs[xs.length - 1]}`);
  const units = (ks) => list(ks.map(unit));

  const unitsShort = (ks) => `第 ${ks.map((k) => (k < 9 ? k + 1 : k < 18 ? k - 8 : k - 17)).join("、")} ${word(ks[0])}`;

  const { BOX_OF } = SUDOKU;
  const linkUnit = (a, b) => (ROW_OF[a] === ROW_OF[b] ? ROW_OF[a] : COL_OF[a] === COL_OF[b] ? 9 + COL_OF[a] : 18 + BOX_OF[a]);
  const uniq = (xs) => [...new Set(xs)];

  function struckOf(elim) {
    const s = {};
    for (const [i, d] of elim) (s[i] = s[i] || []).push(d);
    return s;
  }

  function build(frames) {
    const out = [];
    let prev = { units: [], clue: [], clue2: [], target: [], cross: [], cand: [], key: [], struck: {}, placed: null, fills: [], lines: [], focus: [] };
    for (const f of frames) {
      const cur = { ...prev, focus: [], ...f };
      if (f.addLines) cur.lines = [...prev.lines, ...f.addLines];
      if (f.addClue) cur.clue = uniq([...prev.clue, ...f.addClue]);
      if (f.addCand) cur.cand = uniq([...prev.cand, ...f.addCand]);
      delete cur.addLines; delete cur.addClue; delete cur.addCand;
      out.push(cur);
      prev = cur;
    }
    return out;
  }

  function finish(step, text) {
    const tg = uniq(step.elim.map(([i]) => i));
    return { text, target: tg, addCand: tg, struck: struckOf(step.elim), focus: tg };
  }

  function explain(step) {
    const v = step.before.val;
    const cand = step.before.cand;
    const d = step.digits && step.digits[0];
    const f = [];
    switch (step.tech) {
      case "naked_single": {
        const [i, dd] = step.place;
        const seen = [];
        for (let j = 0; j < 81; j++) if (SEES[i][j] && v[j]) seen.push(j);
        const used = uniq(seen.map((j) => v[j])).sort();
        f.push({ text: `看框起來的這一格（${cell(i)}）。它所在的列、欄、宮，就是打底的這三排。`, target: [i], units: step.units, focus: [i] });
        f.push({ text: `這三排裡已經出現了 ${list(used)}，一共八個數字。`, clue: seen });
        f.push({ text: `1 到 9 只剩 ${dd} 還沒用到，所以這一格一定是 ${dd}。`, placed: [i, dd], focus: [i] });
        break;
      }
      case "hidden_single": {
        const [i, dd] = step.place, k = step.units[0];
        const empties = UNITS[k].filter((j) => !v[j] && j !== i);
        const block = [], lines = [];
        for (const j of empties) {
          for (let b = 0; b < 81; b++) {
            if (SEES[j][b] && v[b] === dd) { block.push(b); lines.push([b, j, "weak"]); break; }
          }
        }

        const byElim = empties.length - lines.length;
        f.push({ text: `看${unit(k)}（打底的那一${word(k)}）。每一${word(k)}都一定要有一個 ${dd}，現在還沒有。`, units: [k] });
        if (block.length) f.push({ text: `標黃的這幾個 ${dd}，會擋住和它同一列、同一欄、同一宮的格子。`, clue: uniq(block) });
        f.push({
          text: !byElim ? `被擋住的空格打上叉（虛線連到擋住它的那個 ${dd}）：這些格子都不能放 ${dd}。`
            : !lines.length ? `其他空格在前面的推理裡，都已經排除了 ${dd}，打上叉：不能放 ${dd}。`
            : `其他空格都打上叉：有虛線的被那個 ${dd} 擋住，其餘的在前面已經排除了 ${dd}。`,
          cross: empties, lines,
        });
        f.push({ text: `這一${word(k)}只剩框起來的這格（${cell(i)}）能放 ${dd}，所以就是它。`, placed: [i, dd], target: [i], focus: [i] });
        break;
      }
      case "locked": {
        const [k, k2] = step.units;
        f.push({ text: `看${unit(k)}（打底的）：數字 ${d} 在這裡只能放在標黃的這 ${step.cells.length} 格。`, units: [k], cand: step.cells, key: [d], clue: step.cells });
        f.push({ text: `這幾格剛好都在${unit(k2)}上。不管最後是哪一格，${unit(k2)}的 ${d} 都會被它用掉。`, units: [k, k2] });
        f.push(finish(step, `所以${unit(k2)}其他格子都不能放 ${d}，劃掉。`));
        break;
      }
      case "pair":
      case "triple":
      case "quad": {
        const n = step.cells.length, ds = list(step.digits), k = step.units[0];
        if (!step.hidden) {
          f.push({ text: `看${unit(k)}裡這 ${n} 格：它們都只能填 ${ds}。`, units: [k], cand: step.cells, key: step.digits, clue: step.cells });
          f.push(finish(step, `${n} 格分 ${n} 個數字剛好分完，所以${unit(k)}其他格子都不能再放 ${ds}，劃掉。`));
        } else {
          f.push({ text: `看${unit(k)}：數字 ${ds} 只能放在這 ${n} 格。`, units: [k], cand: step.cells, key: step.digits, clue: step.cells });
          f.push(finish(step, `這 ${n} 格要留給 ${ds}，所以它們不能再放別的數字，劃掉。`));
        }
        break;
      }
      case "x_wing":
      case "swordfish": {
        const n = step.tech === "x_wing" ? 2 : 3;
        const base = step.units.slice(0, n), cover = step.units.slice(n);
        const bw = word(base[0]), cw = word(cover[0]);
        f.push({ text: `看${units(base)}：數字 ${d} 在每一${bw}都只剩${n === 2 ? "兩" : "兩、三"}個位置（小字的 ${d}）。`, units: base, cand: step.cells, key: [d], clue: step.cells });
        f.push({ text: `這些位置都在${units(cover)}上。這 ${n} ${bw}各要一個 ${d}，會把這幾${cw}的 ${d} 用光。`, units: [...base, ...cover] });
        f.push(finish(step, `所以${units(cover)}其他格子都不能放 ${d}，劃掉。`));
        break;
      }
      case "turbot": {
        const [[x, y], [z, w]] = step.links;
        f.push({ text: `數字 ${d} 在${unit(linkUnit(x, y))}只剩框起來的兩格（實線），兩格之中一定有一格是 ${d}。`, cand: [x, y], key: [d], clue: [x, y], lines: [[x, y, "strong"]], focus: [x, y] });
        f.push({ text: `${unit(linkUnit(z, w))}也一樣：框起來的這兩格之中，一定有一格是 ${d}。`, addCand: [z, w], addClue: [z, w], addLines: [[z, w, "strong"]], focus: [z, w] });
        f.push({ text: `中間這兩格互相看得到（虛線），不可能都是 ${d}。所以框起來的兩端，至少有一格是 ${d}。`, addLines: [[y, z, "weak"]], focus: [x, w] });
        f.push(finish(step, `同時看得到兩端的格子，不管哪一端是 ${d}，都不能放 ${d}，劃掉。`));
        break;
      }
      case "xy_wing": {
        const [p, a, b] = step.cells, [x, y] = step.pivotDigits, z = d;
        const xa = digitsOf(cand[a]).includes(x) ? x : y, xb = xa === x ? y : x;
        f.push({ text: `框起來的這格（${cell(p)}）只能是 ${x} 或 ${y}。`, cand: [p], clue: [p], key: [x, y], focus: [p] });
        f.push({ text: `如果它是 ${xa}：框起來的另一格（${cell(a)}）就不能是 ${xa}，只剩 ${z}。`, addCand: [a], addClue: [a], addLines: [[p, a, "weak"]], key: [xa, z], focus: [a] });
        f.push({ text: `如果它是 ${xb}：框起來的這格（${cell(b)}）就不能是 ${xb}，只剩 ${z}。`, addCand: [b], addClue: [b], addLines: [[p, b, "weak"]], key: [xb, z], focus: [b] });
        f.push(finish(step, `不管哪一種，兩邊總有一格是 ${z}。同時看得到這兩格的地方都不能放 ${z}，劃掉。`));
        break;
      }
      case "xyz_wing": {
        const [p, a, b] = step.cells, z = d;
        f.push({ text: `框起來的這格只能是 ${list(digitsOf(cand[p]))}；連線的另外兩格各只剩兩個可能，而且都包含 ${z}。`, cand: [p, a, b], clue: [p, a, b], key: [z], lines: [[p, a, "weak"], [p, b, "weak"]], focus: [p] });
        f.push({ text: `框起來的這格如果是 ${z}，就有 ${z} 了；如果是另外兩個數字，會逼旁邊一格變成 ${z}。`, focus: [p] });
        f.push(finish(step, `所以三格裡一定有一格是 ${z}。同時看得到這三格的地方都不能放 ${z}，劃掉。`));
        break;
      }
      case "w_wing": {
        const [p, q, a, b] = step.cells, x = step.linkDigit, y = d;
        const [ap, bq] = SEES[p][a] ? [a, b] : [b, a];
        f.push({ text: `框起來的這兩格都只能是 ${x} 或 ${y}。`, cand: [p, q], clue: [p, q], key: [x, y], focus: [p, q] });
        f.push({ text: `數字 ${x} 在${unit(linkUnit(a, b))}只剩框起來的兩格（實線），各自看得到上一步的一格（虛線）。`, addCand: [a, b], addClue: [a, b], addLines: [[a, b, "strong"], [p, ap, "weak"], [q, bq, "weak"]], key: [x], focus: [a, b] });
        f.push({ text: `如果那兩格都是 ${x}，${unit(linkUnit(a, b))}就放不下 ${x} 了。所以那兩格至少有一格是 ${y}。`, key: [y], focus: [p, q] });
        f.push(finish(step, `同時看得到兩格的地方都不能放 ${y}，劃掉。`));
        break;
      }
      case "simple_coloring": {
        const lines = step.links.map(([a, b]) => [a, b, "strong"]);
        f.push({ text: `把數字 ${d} 所有「二選一」的格子用實線串起來，輪流塗上黃色和藍色。`, clue: step.colors[0], clue2: step.colors[1], cand: step.cells, key: [d], lines });
        f.push({ text: `同一種顏色的格子，要嘛全都是 ${d}，要嘛全都不是。` });
        if (step.wrap != null) {
          f.push(finish(step, `其中一種顏色有兩格互相看得到，不可能都是 ${d}，所以這種顏色全錯，劃掉。`));
        } else {
          f.push(finish(step, `兩種顏色一定有一種是對的。同時看得到兩種顏色的格子，不管哪種對都不能是 ${d}，劃掉。`));
        }
        break;
      }
      case "unique_rectangle": {
        const [a, b] = step.digits, extra = step.elim[0][0];
        f.push({ text: `這四格排成長方形、橫跨兩宮，其中三格都只能填 ${a} 或 ${b}。`, cand: step.cells, clue: step.cells.filter((i) => i !== extra), key: [a, b] });
        f.push({ text: `如果第四格也只填 ${a}、${b}，四格的 ${a}、${b} 可以整組對調，題目就有兩個答案。可是數獨只能有一個答案。`, target: [extra] });
        f.push(finish(step, `所以${cell(extra)}不能是 ${a} 或 ${b}，劃掉。`));
        break;
      }
      case "aic": {
        const ch = step.chain;
        const cells = uniq(ch.map((c) => c[0]));
        f.push({ text: `我們用「假設」一路推下去。先假設框起來的這格（${cell(ch[0][0])}）不是 ${ch[0][1]}。`, cand: [ch[0][0]], clue: [ch[0][0]], key: [ch[0][1]], focus: [ch[0][0]] });
        for (let k = 1; k < ch.length; k++) {
          const [i, dd, on] = ch[k], [pi, pd] = ch[k - 1];
          const text = on
            ? `那${i === pi ? "這格" : "框起來的這格"}就一定是 ${dd}（${i === pi ? `這格只剩 ${pd}、${dd} 兩個可能` : `${dd} 在${unit(linkUnit(pi, i))}只剩這兩格`}）。`
            : `那${i === pi ? "這格" : "框起來的這格"}就不能是 ${dd}（${i === pi ? "同一格只能填一個數字" : "兩格互相看得到"}）。`;
          f.push({ text, addCand: [i], addClue: [i], addLines: i === pi ? [] : [[pi, i, on ? "strong" : "weak"]], key: uniq(ch.slice(0, k + 1).map((c) => c[1])), focus: [i] });
        }
        const [si, sd] = ch[0], [ei, ed] = ch[ch.length - 1];
        f.push({ text: `所以「框起來的頭一格是 ${sd}」和「框起來的最後一格是 ${ed}」，至少有一個成立。`, clue: cells, focus: [si, ei] });
        const ek = step.elim;
        f.push(finish(step, ek.length === 1
          ? `${cell(ek[0][0])}的 ${ek[0][1]} 跟兩頭都衝突，劃掉。`
          : `跟兩頭都衝突的 ${ek.length} 個候選數（劃掉的那幾個），都不可能是答案。`));
        break;
      }
      case "finned_x_wing":
      case "finned_swordfish": {
        const n = step.tech === "finned_x_wing" ? 2 : 3;
        const base = step.units.slice(0, n), cover = step.units.slice(n);
        const cw = word(cover[0]), fins = step.fins, fb = 18 + BOX_OF[fins[0]];
        f.push({ text: `看${unitsShort(base)}（打底的）：數字 ${d} 大多落在${unitsShort(cover)}上（標黃的）。`, units: base, cand: [...step.cells, ...fins], key: [d], clue: step.cells });
        f.push({ text: `只有藍色的 ${fins.length} 格不在這幾${cw}上，叫做「鰭」。鰭${fins.length > 1 ? "都" : ""}在${unit(fb)}裡。`, clue2: fins, units: [...base, fb] });
        f.push({ text: `如果鰭${fins.length > 1 ? "都" : ""}不是 ${d}：這就是${n === 2 ? " X-Wing" : "劍魚"}，${unitsShort(cover)}其他格子都不能放 ${d}。`, units: [...base, ...cover] });
        f.push({ text: `如果${fins.length > 1 ? "有一格鰭" : "鰭"}是 ${d}：和鰭同一宮（${unit(fb)}）的格子都不能放 ${d}。`, units: [fb] });
        f.push(finish(step, `框起來的格子，兩種情況都不能放 ${d}，劃掉。`));
        break;
      }
      case "als_xz": {
        const [A, B] = step.als, [ua, ub] = step.units, x = step.rcc, z = d;
        const ds = (cs) => list(digitsOf(cs.reduce((m, i) => m | cand[i], 0)));
        const group = (cs, k, color) => (cs.length === 1
          ? `${color}的這一格只能是 ${digitsOf(cand[cs[0]]).join(" 或 ")}（兩個數字只會用上一個）。`
          : `${unit(k)}${color}的這 ${cs.length} 格只能填 ${ds(cs)}：${cs.length} 格放 ${cs.length + 1} 個數字，只會少掉一個。`);
        const ax = A.filter((i) => digitsOf(cand[i]).includes(x)), bx = B.filter((i) => digitsOf(cand[i]).includes(x));
        f.push({ text: group(A, ua, "標黃"), units: A.length > 1 ? [ua] : [], cand: A, key: [x, z], clue: A });
        f.push({ text: group(B, ub, "藍色"), units: [], addCand: B, clue2: B });
        f.push({ text: `兩組的 ${x} 互相看得到（虛線），不能兩組都有 ${x}。所以至少有一組少掉的是 ${x}。`, lines: ax.flatMap((i) => bx.map((j) => [i, j, "weak"])) });
        f.push({ text: `少掉 ${x} 的那一組，其他數字都到齊了，一定有 ${z}。所以兩組裡至少有一個 ${z}。`, lines: [] });
        f.push(finish(step, `同時看得到兩組所有 ${z} 的格子，都不能放 ${z}，劃掉。`));
        break;
      }
      case "contradiction": {
        const ev = step.events, [i0, d0] = [ev[0].cell, ev[0].digit];
        const orig = (j) => digitsOf(cand[j]);
        const lineTo = (ps, j) => ps.map((p) => [ev[p].cell, j, "weak"]).filter(([a, b]) => a !== b);

        const blocked = (u, e, fills, skip) => {
          const shown = (b) => v[b] || (fills.find(([x]) => x === b) || [])[1] || 0;
          const cross = UNITS[u].filter((m) => m !== skip && !shown(m)), lines = [];
          for (const m of cross) {
            const by = fills.map(([x]) => x).find((b) => SEES[m][b] && shown(b) === e) ??
              [...Array(81).keys()].find((b) => SEES[m][b] && v[b] === e);
            if (by != null) lines.push([by, m, "weak"]);
          }
          return { cross, lines, byElim: cross.length - lines.length };
        };
        f.push({ text: "前面的方法都推不動了，只能「試試看」：先假設一格的數字，看會不會出問題。" });
        f.push({ text: `假設框起來的這格（${cell(i0)}）是 ${d0}。`, fills: [[i0, d0]], target: [i0], focus: [i0] });
        for (let k = 1; k < ev.length; k++) {
          const { cell: j, digit: e, why, unit: u, parents } = ev[k];
          const fills = ev.slice(0, k).map((x) => [x.cell, x.digit]);
          const clue = ev.slice(1, k).map((x) => x.cell);
          if (why === "naked") {
            f.push({ text: `那框起來的這格（${cell(j)}）只剩 ${e} 能填：其他數字都被虛線連到的格子擋住了。`,
              fills, clue, units: [], cross: [], cand: [j], key: [e], struck: { [j]: orig(j).filter((x) => x !== e) }, lines: lineTo(parents, j), focus: [j] });
          } else {
            const b = blocked(u, e, fills, j);
            const why = !b.byElim ? `其他空格打叉，都被虛線連到的 ${e} 擋住。`
              : !b.lines.length ? `其他空格在前面的推理裡都已排除了 ${e}（打叉）。`
              : `其他空格打叉，有虛線的被 ${e} 擋住，其餘的前面已排除 ${e}。`;
            f.push({ text: `${unit(u)}只剩框起來的這格${b.byElim && b.lines.length ? "" : `（${cell(j)}）`}能放 ${e}：${why}`,
              fills, clue, units: [u], cross: b.cross, cand: [j], key: [e], struck: {}, lines: b.lines, focus: [j] });
          }
        }
        const bad = step.bad, all = ev.map((x) => [x.cell, x.digit]), clue = ev.slice(1).map((x) => x.cell);
        if (bad.kind === "cell") {
          const c = bad.cell;
          f.push({ text: `可是框起來的這格（${cell(c)}），每個數字都被虛線連到的格子擋住，沒有數字可以填——矛盾！`,
            fills: all, clue, units: [], cross: [], cand: [c], key: [], struck: { [c]: orig(c) }, lines: lineTo(bad.parents, c), focus: [c] });
        } else {
          const e = bad.digit, b = blocked(bad.unit, e, all, -1);
          const text = !b.cross.length ? `可是${unit(bad.unit)}已經填滿了，卻沒有 ${e}——矛盾！`
            : !b.byElim ? `可是${unit(bad.unit)}的空格都被擋住，放不下 ${e} 了（打叉，虛線連到擋住它的 ${e}）——矛盾！`
            : !b.lines.length ? `可是${unit(bad.unit)}的空格在前面都已排除了 ${e}（打叉），放不下 ${e}——矛盾！`
            : `可是${unit(bad.unit)}放不下 ${e} 了：空格打叉，有虛線的被 ${e} 擋住，其餘前面已排除——矛盾！`;
          f.push({ text, fills: all, clue, units: [bad.unit], cross: b.cross, cand: [], key: [], struck: {}, lines: b.lines, focus: [] });
        }
        f.push({ ...finish(step, `所以一開始的假設錯了：${cell(i0)}不能是 ${d0}，劃掉。`),
          addCand: null, cand: [i0], fills: [], clue: [], units: [], cross: [], lines: [], key: [d0] });
        break;
      }
      default:
        f.push(finish(step, "劃掉這些候選數。"));
    }
    return { name: TECH_NAMES[step.tech] || step.tech, frames: build(f) };
  }

  function stuck() {
    return {
      name: "超出常規技巧",
      frames: build([
        { text: "這一步連「試試看」都推不出來：盤面是所有方法都用上後卡住的樣子。" },
        { text: "要假設好幾格、一路試下去才分得出對錯，沒辦法一格一格講清楚。" },
      ]),
    };
  }

  return { explain, stuck, TECH_NAMES };
})();
