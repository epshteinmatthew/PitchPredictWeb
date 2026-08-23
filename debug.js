const MLB = "https://statsapi.mlb.com/api";
const API = new URLSearchParams(location.search).get("api")
  || "https://pitchpredict-910442.tail42c403.ts.net";
const TYPE = {SI:0,CH:1,FF:2,ST:3,FC:4,FS:5,SL:6,CU:7,SV:8,KC:9,FO:10,PO:11,FA:12,UN:13,CS:14,EP:15,KN:16,SC:17};
const TYPE_ALIAS = {FT:"SI", SF:"FS"};
const TYPE_CODE = Object.fromEntries(Object.entries(TYPE).map(([k, v]) => [v, k]));
const CALL = {called_strike:0,ball:1,swinging_strike:2,blocked_ball:3,foul:4,foul_bunt:5,foul_tip:6,automatic_ball:7,swinging_strike_blocked:8,automatic_strike:9,pitchout:10,missed_bunt:11,bunt_foul_tip:12,hit_into_play:13,hit_by_pitch:14,swinging_pitchout:15};
const CODE = {B:"ball","*":"blocked_ball",C:"called_strike",S:"swinging_strike",W:"swinging_strike_blocked",T:"foul_tip",F:"foul",L:"foul_bunt",M:"missed_bunt",O:"bunt_foul_tip",P:"pitchout",Q:"swinging_pitchout",X:"hit_into_play",D:"hit_into_play",E:"hit_into_play",H:"hit_by_pitch",V:"automatic_ball",A:"automatic_strike"};
const NAME = {
  SI:"Sinker", CH:"Changeup", FF:"Four-Seam Fastball", ST:"Sweeper", FC:"Cutter",
  FS:"Splitter", SL:"Slider", CU:"Curveball", SV:"Slurve", KC:"Knuckle Curve",
  FO:"Forkball", PO:"Pitchout", FA:"Fastball", UN:"Unknown", CS:"Slow Curve",
  EP:"Eephus", KN:"Knuckleball", SC:"Screwball",
};

const typeIndex = code => TYPE[TYPE_ALIAS[code] || code] ?? TYPE.UN;
const codeFrom = t => TYPE_CODE[t] ?? TYPE_CODE[+t] ?? t;
const normCode = c => TYPE_ALIAS[c] || c || "";
const name = c => NAME[normCode(c)] || NAME[codeFrom(c)] || normCode(c) || c;
const normalizeRanked = ranked => (ranked || [])
  .map(([t, p]) => [codeFrom(t), p])
  .filter(([t]) => t !== "UN");
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmtTypes = arr => (arr || []).map(i => TYPE_CODE[i] ?? i).join(", ") || "—";
const fmtTop = ranked => ranked.slice(0, 3).map(([t, p]) => `${name(t)} ${(p * 100).toFixed(1)}%`).join(" · ");
const num = x => parseFloat(x) || 0;
const pct = (n, d) => d ? `${((n / d) * 100).toFixed(1)}%` : "—";

let predChart;
let actualChart;
const slashCache = new Map();

document.getElementById("api").value = API;
if (!document.getElementById("season").value) {
  document.getElementById("season").value = new Date().getFullYear();
}

const get = url => fetch(url).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });

async function slash(id, yr) {
  const key = `${id}:${yr}`;
  if (slashCache.has(key)) return slashCache.get(key);
  const load = async y => {
    const j = await get(`${MLB}/v1/people/${id}/stats?stats=season&group=hitting&season=${y}`);
    return j.stats?.[0]?.splits?.[0]?.stat || {};
  };
  let st = await load(yr);
  if (num(st.plateAppearances) < 100) st = await load(yr - 1);
  const line = [num(st.avg), num(st.obp), num(st.slg)];
  slashCache.set(key, line);
  return line;
}

async function pitcherGames(id, yr, n) {
  const j = await get(`${MLB}/v1/people/${id}/stats?stats=gameLog&group=pitching&season=${yr}`);
  return (j.stats?.[0]?.splits || [])
    .map(s => ({ date: s.date, gamePk: s.game?.gamePk }))
    .filter(g => g.gamePk)
    .slice(0, n);
}

function outsBefore(pe, i) {
  if (!pe.length) return 0;
  if (i === 0) {
    const c = pe[0].count?.outs ?? 0;
    return pe[0].details?.isOut ? Math.max(0, c - 1) : c;
  }
  return pe[i - 1].count?.outs ?? 0;
}

function casesFromPlay(play, gamePk, gameDate) {
  const events = (play.playEvents || []).filter(e => e.isPitch);
  if (!events.length) return [];
  const mu = play.matchup || {};
  const about = play.about || {};
  const half = about.halfInning === "bottom" ? 1 : 0;
  const res = play.result || {};
  const away = res.awayScore ?? 0;
  const home = res.homeScore ?? 0;
  const out = [];

  for (let i = 0; i < events.length; i++) {
    const actual = events[i].details?.type?.code || "";
    if (!actual || actual === "UN") continue;

    const calls = [];
    const types = [];
    for (let j = 0; j < i; j++) {
      const d = events[j].details || {};
      const c = d.call?.code || d.code;
      const call = CODE[c] || "ball";
      calls.push(CALL[call] ?? CALL.ball);
      types.push(typeIndex(d.type?.code));
    }

    out.push({
      label: `${gameDate} AB${(about.atBatIndex ?? 0) + 1} P${i + 1}`,
      gameDate,
      gamePk,
      batterId: mu.batter?.id,
      batterName: mu.batter?.fullName || String(mu.batter?.id || ""),
      types,
      calls,
      pitch_number: i + 1,
      actual,
      body: {
        game_date: +gameDate.replaceAll("-", ""),
        at_bat_number: (about.atBatIndex ?? 0) + 1,
        pitch_number: i + 1,
        pitcher_id: mu.pitcher?.id,
        batter_id: mu.batter?.id,
        pitch_calls_so_far: calls,
        pitch_types_so_far: types,
        outs: outsBefore(events, i),
        on_1b: 0,
        on_2b: 0,
        on_3b: 0,
        offense_score: half ? home : away,
        defense_score: half ? away : home,
        inning: about.inning || 1,
        inning_half: half,
        p_throws: mu.pitchHand?.code === "L" ? 1 : 0,
        stand: mu.batSide?.code === "L" ? 1 : 0,
      },
    });
  }
  return out;
}

async function loadCases(pitcher, season, games, max) {
  const gameList = await pitcherGames(pitcher, season, games);
  const cases = [];
  for (const g of gameList) {
    const feed = await get(`${MLB}/v1.1/game/${g.gamePk}/feed/live`);
    for (const play of feed.liveData?.plays?.allPlays || []) {
      if (play.matchup?.pitcher?.id !== pitcher) continue;
      cases.push(...casesFromPlay(play, g.gamePk, g.date));
      if (cases.length >= max) return cases;
    }
  }
  return cases;
}

function responseId(ranked) {
  return ranked.slice(0, 8).map(([t, p]) => `${t}:${p.toFixed(6)}`).join("|");
}

async function predict(api, body, yr) {
  const [avg, obp, slg] = await slash(body.batter_id, yr);
  const r = await fetch(`${api.replace(/\/$/, "")}/predict/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, batter_avg: avg, batter_obp: obp, batter_slg: slg }),
  });
  if (!r.ok) throw new Error(String(r.status));
  return normalizeRanked(await r.json());
}

function highConf(ranked) {
  if (!ranked?.length) return false;
  return ranked[0][1] - (ranked[1]?.[1] ?? 0) >= 0.2;
}

function grade(ranked, actual) {
  const act = normCode(actual);
  const top1 = ranked[0]?.[0] === act;
  const top3 = ranked.slice(0, 3).some(([t]) => t === act);
  return { top1, top3, hi: highConf(ranked) && top1 };
}

async function runPool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

function drawBarChart(canvasId, chartRef, counts, title) {
  const labels = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const data = labels.map(k => counts[k]);
  const ctx = document.getElementById(canvasId);
  if (chartRef) chartRef.destroy();
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels.map(k => `${k}`),
      datasets: [{ label: title, data, backgroundColor: "rgba(0,0,0,.55)" }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        title: { display: true, text: title },
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
        x: { ticks: { font: { size: 10 } } },
      },
    },
  });
}

document.getElementById("run").addEventListener("click", async () => {
  const api = document.getElementById("api").value.trim();
  const pitcher = +document.getElementById("pitcher").value;
  const season = +document.getElementById("season").value;
  const games = +document.getElementById("games").value;
  const max = +document.getElementById("max").value;
  const status = document.getElementById("status");
  const rows = document.getElementById("rows");
  const btn = document.getElementById("run");

  btn.disabled = true;
  rows.innerHTML = "";
  slashCache.clear();

  try {
    status.textContent = `Loading up to ${games} games from ${season}…`;
    const cases = await loadCases(pitcher, season, games, max);
    if (!cases.length) {
      status.textContent = "No pitches found for this pitcher/season.";
      btn.disabled = false;
      return;
    }

    let done = 0;
    status.textContent = `Grading ${cases.length} real pitches…`;
    const results = await runPool(cases, 6, async (sc) => {
      try {
        const ranked = await predict(api, sc.body, season);
        done++;
        status.textContent = `Grading ${done}/${cases.length}…`;
        const g = grade(ranked, sc.actual);
        return { ...sc, ranked, err: null, rid: responseId(ranked), ...g };
      } catch (e) {
        done++;
        status.textContent = `Grading ${done}/${cases.length}…`;
        return { ...sc, ranked: [], err: e.message, rid: "err", top1: false, top3: false, hi: false };
      }
    });

    let errors = 0;
    let top1 = 0;
    let top3 = 0;
    let hiN = 0;
    let hiHit = 0;
    const predDist = {};
    const actualDist = {};
    const rids = new Map();

    for (const r of results) {
      if (r.err) { errors++; continue; }
      const pred = r.ranked[0]?.[0] || "?";
      const act = normCode(r.actual);
      predDist[pred] = (predDist[pred] || 0) + 1;
      actualDist[act] = (actualDist[act] || 0) + 1;
      rids.set(r.rid, (rids.get(r.rid) || 0) + 1);
      if (r.top1) top1++;
      if (r.top3) top3++;
      if (r.ranked.length && highConf(r.ranked)) { hiN++; if (r.top1) hiHit++; }
    }

    const graded = results.length - errors;
    rows.innerHTML = results.map(r => {
      const cls = r.err ? "err" : r.top1 ? "hit" : "miss";
      const result = r.err
        ? `<span class="err">${esc(r.err)}</span>`
        : r.top1
          ? `<span class="ok">Top-1</span>`
          : r.top3
            ? "Top-3"
            : "Miss";
      return `<tr class="${cls}">
        <td>${esc(r.label)}</td>
        <td>${esc(r.batterName)}</td>
        <td>${r.pitch_number}</td>
        <td>${esc(fmtTypes(r.types))}</td>
        <td>${r.err ? "—" : esc(fmtTop(r.ranked))}</td>
        <td>${esc(name(r.actual))} (${esc(normCode(r.actual))})</td>
        <td>${result}</td>
      </tr>`;
    }).join("");

    document.getElementById("stat-total").textContent = String(graded);
    document.getElementById("stat-top1").textContent = pct(top1, graded);
    document.getElementById("stat-top3").textContent = pct(top3, graded);
    document.getElementById("stat-hi").textContent = hiN ? `${pct(hiHit, hiN)} (${hiHit}/${hiN})` : "—";
    document.getElementById("stat-errors").textContent = String(errors);
    document.getElementById("stat-unique").textContent = String(rids.size);

    predChart = drawBarChart("pred-chart", predChart, predDist, "Top-1 predictions");
    actualChart = drawBarChart("actual-chart", actualChart, actualDist, "Actual pitches");

    status.textContent = `Graded ${graded} pitches from ${games} game(s). Top-1: ${pct(top1, graded)}, top-3: ${pct(top3, graded)}.`;
  } catch (e) {
    status.textContent = `Failed: ${e.message}`;
  }
  btn.disabled = false;
});

/* —— Card UI preview (same expand/collapse as live page) —— */
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const ANIM_MS = 450;
const CLOSE_MS = 180;
const LIST_GAP = 16;
let animating = false;
const expandedPks = new Set();

function beginMotion() { animating = true; }
function endMotion() {
  clearMotionStyles();
  animating = false;
}

function detailOverlay(el) {
  return el?.classList.contains("down-only") ? el.querySelector(".card-detail") : null;
}

function clearPushes() {
  document.querySelectorAll("#list .card").forEach(c => {
    c.style.top = "";
    c.style.transform = "";
  });
  const list = document.getElementById("list");
  if (list) list.style.paddingBottom = "";
}

function clearMotionStyles() {
  document.querySelectorAll("#list .card").forEach(c => {
    c.style.transition = "";
    c.style.transform = "";
    c.style.width = "";
    c.style.height = "";
  });
  document.querySelectorAll("#list .card-detail").forEach(d => {
    d.style.transition = "";
    if (d.style.height === "0px") d.style.height = "";
  });
  const list = document.getElementById("list");
  if (list) list.style.transition = "";
}

function computePushes(excludeEl = null) {
  const cards = [...document.querySelectorAll("#list .card")];
  const tops = new Map(cards.map(c => [c, 0]));

  const open = cards
    .filter(el => el.classList.contains("expanded") && el !== excludeEl)
    .map(el => ({ el, detail: detailOverlay(el) }))
    .filter(x => x.detail)
    .sort((a, b) => a.el.getBoundingClientRect().top - b.el.getBoundingClientRect().top);

  for (const { el, detail } of open) {
    const saved = detail.style.height;
    detail.style.height = "";
    const er = el.getBoundingClientRect();
    const panelBottom = er.bottom + detail.scrollHeight - 1;
    const panelLeft = er.left;
    const panelRight = er.right;
    detail.style.height = saved;

    const col = cards
      .filter(c => c !== el)
      .map(c => {
        const r = c.getBoundingClientRect();
        const push = parseFloat(c.style.top) || 0;
        return {
          c,
          layoutTop: r.top - push,
          height: r.height,
          width: r.width,
          left: r.left,
          right: r.right,
        };
      })
      .filter(x => {
        const overlapX = Math.min(x.right, panelRight) - Math.max(x.left, panelLeft);
        return overlapX > x.width * 0.5 && x.layoutTop >= er.bottom - 2;
      })
      .sort((a, b) => a.layoutTop - b.layoutTop);

    let clearBelow = panelBottom + LIST_GAP;
    for (const item of col) {
      if (item.layoutTop >= clearBelow - 1) break;
      const need = clearBelow - item.layoutTop;
      const prev = tops.get(item.c) || 0;
      const next = Math.max(prev, need);
      tops.set(item.c, next);
      clearBelow = item.layoutTop + next + item.height + LIST_GAP;
    }
  }

  let pad = 0;
  const list = document.getElementById("list");
  if (list && open.length) {
    const bottoms = cards.map(c => {
      const r = c.getBoundingClientRect();
      const push = tops.get(c) || 0;
      return r.bottom - push;
    });
    const layoutBottom = bottoms.length ? Math.max(...bottoms) : list.getBoundingClientRect().bottom;
    let overflow = 0;
    for (const c of cards) {
      overflow = Math.max(overflow, c.getBoundingClientRect().bottom - layoutBottom);
    }
    for (const { el, detail } of open) {
      const saved = detail.style.height;
      detail.style.height = "";
      const er = el.getBoundingClientRect();
      overflow = Math.max(overflow, er.bottom + detail.scrollHeight - 1 - layoutBottom);
      detail.style.height = saved;
    }
    if (overflow > 0) pad = overflow;
  }

  return { tops, pad };
}

function applyPushes() {
  const { tops, pad } = computePushes();
  for (const c of document.querySelectorAll("#list .card")) {
    const px = tops.get(c) || 0;
    c.style.top = px > 0 ? px + "px" : "";
  }
  const list = document.getElementById("list");
  if (list) list.style.paddingBottom = pad > 0 ? pad + LIST_GAP + "px" : "";
}

function applyLayout(el, open) {
  if (!el) return;
  if (open) {
    el.classList.add("expanded", "down-only");
    el.classList.remove("ready");
  } else {
    el.classList.remove("expanded", "down-only", "ready");
  }
}

function panelHeight(overlay) {
  if (!overlay) return 0;
  const saved = overlay.style.height;
  overlay.style.height = "";
  const h = overlay.scrollHeight;
  overlay.style.height = saved;
  return h;
}

function animateExpand(el, onDone) {
  beginMotion();
  applyLayout(el, true);
  clearPushes();

  const overlay = detailOverlay(el);
  if (overlay) overlay.style.height = "0px";

  const { tops, pad } = computePushes();
  const h = panelHeight(overlay);
  const list = document.getElementById("list");
  if (list && pad > 0) list.style.paddingBottom = pad + LIST_GAP + "px";

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (overlay) {
        overlay.style.transition = `height ${ANIM_MS}ms ${EASE}`;
        overlay.style.height = h + "px";
      }
      const topTrans = `top ${ANIM_MS}ms ${EASE}`;
      for (const [c, px] of tops) {
        if (px > 0) {
          c.style.transition = topTrans;
          c.style.top = px + "px";
        }
      }
      setTimeout(() => {
        if (overlay) overlay.style.height = "";
        applyPushes();
        endMotion();
        onDone?.();
      }, ANIM_MS + 20);
    });
  });
}

function animateCollapse(el, onDone) {
  beginMotion();
  const overlay = detailOverlay(el);
  const { tops: fromTops, pad: fromPad } = computePushes();
  const { tops: toTops, pad: toPad } = computePushes(el);
  if (overlay) overlay.style.height = panelHeight(overlay) + "px";

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (overlay) {
        overlay.style.transition = `height ${CLOSE_MS}ms ${EASE}`;
        overlay.style.height = "0px";
      }
      const topTrans = `top ${CLOSE_MS}ms ${EASE}`;
      for (const c of document.querySelectorAll("#list .card")) {
        const from = fromTops.get(c) || 0;
        const to = toTops.get(c) || 0;
        if (from === to) continue;
        c.style.transition = "";
        c.style.top = from + "px";
      }
      void document.body.offsetHeight;
      for (const c of document.querySelectorAll("#list .card")) {
        const from = fromTops.get(c) || 0;
        const to = toTops.get(c) || 0;
        if (from === to) continue;
        c.style.transition = topTrans;
        c.style.top = to + "px";
      }
      const list = document.getElementById("list");
      if (list && fromPad !== toPad) {
        list.style.transition = `padding-bottom ${CLOSE_MS}ms ${EASE}`;
        list.style.paddingBottom = toPad > 0 ? toPad + LIST_GAP + "px" : "0px";
      }
      setTimeout(() => {
        if (overlay) overlay.style.height = "";
        endMotion();
        onDone?.();
      }, CLOSE_MS + 20);
    });
  });
}

function toggleExpanded(el) {
  if (!el || animating) return;
  const pk = +el.dataset.pk;
  const opening = !expandedPks.has(pk);

  if (!opening) {
    el.classList.remove("ready");
    animateCollapse(el, () => {
      expandedPks.delete(pk);
      applyLayout(el, false);
      applyPushes();
    });
    return;
  }

  expandedPks.add(pk);
  animateExpand(el, () => el.classList.add("ready"));
}

document.getElementById("list")?.addEventListener("click", e => {
  const c = e.target.closest(".card");
  if (c) toggleExpanded(c);
});
document.getElementById("list")?.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  const c = e.target.closest(".card");
  if (c) toggleExpanded(c);
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || !expandedPks.size) return;
  const open = document.querySelectorAll("#list .card.expanded");
  const last = open[open.length - 1];
  if (last) toggleExpanded(last);
});
