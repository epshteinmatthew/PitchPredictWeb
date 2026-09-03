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

/** Season hitting split: prefer combined multi-team total over per-team rows. */
async function loadHittingSeason(id, y) {
  const j = await get(`${MLB}/v1/people/${id}/stats?stats=season&group=hitting&season=${y}`);
  const splits = j.stats?.[0]?.splits || [];
  const combined = splits.find(s => s.numTeams) || splits.find(s => !s.team) || splits[0];
  return combined?.stat || {};
}

/** Current season slash; fall back to prior year when PA < 100. */
async function slash(id, yr) {
  const key = `${id}:${yr}`;
  if (slashCache.has(key)) return slashCache.get(key);
  let st = await loadHittingSeason(id, yr);
  if (num(st.plateAppearances) < 100) {
    const prev = await loadHittingSeason(id, yr - 1);
    if (num(prev.plateAppearances) > num(st.plateAppearances)) st = prev;
  }
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
const OPEN_MS = 450;
const CLOSE_MS = 180;
let animating = false;
const expandedPks = new Set();
let superPk = null;
let winProbChart = null;

const DOT_FILL = { ball: "#2e8b3a", strike: "#d32f2f", play: "#1e6fd9", out: "#7b1fa2" };

const SAMPLE_SUPER = {
  9001: {
    game: "NYY 2 @ BOS 1",
    inning: "Top 5",
    matchup: "Gerrit Cole vs Rafael Devers",
    pitcher: { id: 543037, name: "Gerrit Cole" },
    batter: { id: 646240, name: "Rafael Devers" },
    count: "1-2",
    outs: 1,
    on_1b: true,
    on_2b: false,
    on_3b: false,
    ranked: [["FF", 0.482], ["SL", 0.221], ["CU", 0.14], ["CH", 0.094], ["FC", 0.063]],
    stats: { era: 3.41, avg: 0.273, obp: 0.341, slg: 0.508 },
    pitches: [
      { n: 1, kind: "ball", type: "SL", call: "ball", outcome: "Ball", px: -1.15, pz: 2.4, szTop: 3.45, szBot: 1.55, ranked: [["FF", 0.51], ["SL", 0.2], ["CU", 0.12]] },
      { n: 2, kind: "strike", type: "FF", call: "called_strike", outcome: "Called strike", px: 0.15, pz: 2.55, szTop: 3.45, szBot: 1.55, ranked: [["FF", 0.44], ["SL", 0.24], ["CH", 0.15]] },
      { n: 3, kind: "strike", type: "SL", call: "foul", outcome: "Foul", px: 0.55, pz: 1.75, szTop: 3.45, szBot: 1.55, ranked: [["SL", 0.38], ["FF", 0.31], ["CU", 0.18]] },
    ],
    linescore: {
      away: { abbr: "NYY", runs: 2, hits: 6, errors: 0 },
      home: { abbr: "BOS", runs: 1, hits: 4, errors: 1 },
      innings: [
        { num: 1, away: 0, home: 0 }, { num: 2, away: 1, home: 0 }, { num: 3, away: 0, home: 1 },
        { num: 4, away: 1, home: 0 }, { num: 5, away: 0, home: null }, { num: 6, away: null, home: null },
        { num: 7, away: null, home: null }, { num: 8, away: null, home: null }, { num: 9, away: null, home: null },
      ],
    },
    winProb: [
      { home: 52 }, { home: 48 }, { home: 45 }, { home: 50 }, { home: 47 },
      { home: 44 }, { home: 49 }, { home: 46 }, { home: 42 }, { home: 45 },
      { home: 41 }, { home: 39 }, { home: 43 }, { home: 40 },
    ],
  },
  9002: {
    game: "LAD 0 @ SD 0",
    inning: "Bot 1",
    matchup: "Yoshinobu Yamamoto vs Manny Machado",
    pitcher: { id: 808967, name: "Yoshinobu Yamamoto" },
    batter: { id: 592518, name: "Manny Machado" },
    count: "0-1",
    outs: 0,
    on_1b: false,
    on_2b: false,
    on_3b: false,
    ranked: [["FS", 0.415], ["FF", 0.28], ["CU", 0.162], ["FC", 0.091], ["SI", 0.052]],
    stats: { era: 2.86, avg: 0.268, obp: 0.325, slg: 0.456 },
    pitches: [
      { n: 1, kind: "strike", type: "FF", call: "called_strike", outcome: "Called strike", px: -0.2, pz: 2.8, szTop: 3.5, szBot: 1.6, ranked: [["FF", 0.46], ["FS", 0.27], ["CU", 0.14]] },
    ],
    linescore: {
      away: { abbr: "LAD", runs: 0, hits: 0, errors: 0 },
      home: { abbr: "SD", runs: 0, hits: 0, errors: 0 },
      innings: Array.from({ length: 9 }, (_, i) => ({ num: i + 1, away: i === 0 ? 0 : null, home: null })),
    },
    winProb: [{ home: 54 }, { home: 53 }, { home: 52 }],
  },
  9003: {
    game: "HOU 4 @ SEA 3",
    inning: "Bot 8",
    matchup: "Josh Hader vs Julio Rodríguez",
    pitcher: { id: 623352, name: "Josh Hader" },
    batter: { id: 677594, name: "Julio Rodríguez" },
    count: "2-2",
    outs: 2,
    on_1b: false,
    on_2b: true,
    on_3b: true,
    done: true,
    result: "Julio Rodríguez singles to left. Runner scores.",
    ranked: [],
    stats: { era: 2.12, avg: 0.281, obp: 0.339, slg: 0.472 },
    pitches: [
      { n: 1, kind: "ball", type: "FF", call: "ball", outcome: "Ball", px: -1.4, pz: 3.2, szTop: 3.4, szBot: 1.5, ranked: [["SL", 0.55], ["FF", 0.3], ["SI", 0.1]] },
      { n: 2, kind: "ball", type: "SI", call: "ball", outcome: "Ball", px: 1.2, pz: 1.3, szTop: 3.4, szBot: 1.5, ranked: [["SL", 0.49], ["FF", 0.34], ["SI", 0.12]] },
      { n: 3, kind: "strike", type: "SL", call: "swinging_strike", outcome: "Swinging strike", px: 0.4, pz: 1.9, szTop: 3.4, szBot: 1.5, ranked: [["SL", 0.52], ["FF", 0.33]] },
      { n: 4, kind: "strike", type: "FF", call: "foul", outcome: "Foul", px: -0.35, pz: 2.6, szTop: 3.4, szBot: 1.5, ranked: [["FF", 0.47], ["SL", 0.4]] },
      { n: 5, kind: "play", type: "FF", call: "hit_into_play", outcome: "In play", px: 0.1, pz: 2.35, szTop: 3.4, szBot: 1.5, ranked: [["SL", 0.58], ["FF", 0.29]] },
    ],
    linescore: {
      away: { abbr: "HOU", runs: 4, hits: 8, errors: 0 },
      home: { abbr: "SEA", runs: 4, hits: 9, errors: 0 },
      innings: [
        { num: 1, away: 0, home: 1 }, { num: 2, away: 2, home: 0 }, { num: 3, away: 0, home: 0 },
        { num: 4, away: 1, home: 1 }, { num: 5, away: 0, home: 0 }, { num: 6, away: 1, home: 1 },
        { num: 7, away: 0, home: 0 }, { num: 8, away: 0, home: 1 }, { num: 9, away: null, home: null },
      ],
    },
    winProb: [
      { home: 48 }, { home: 55 }, { home: 42 }, { home: 38 }, { home: 45 },
      { home: 40 }, { home: 35 }, { home: 42 }, { home: 50 }, { home: 58 },
      { home: 52 }, { home: 61 },
    ],
  },
  9004: {
    game: "CHC 1 @ MIL 1",
    inning: "Top 3",
    matchup: "Freddy Peralta vs Cody Bellinger",
    pitcher: { id: 642547, name: "Freddy Peralta" },
    batter: { id: 641355, name: "Cody Bellinger" },
    count: "0-0",
    outs: 0,
    on_1b: false,
    on_2b: false,
    on_3b: false,
    ranked: [["FF", 0.398], ["CH", 0.245], ["SL", 0.187], ["CU", 0.112], ["FC", 0.058]],
    stats: { era: 3.58, avg: 0.266, obp: 0.328, slg: 0.444 },
    pitches: [],
    linescore: {
      away: { abbr: "CHC", runs: 1, hits: 3, errors: 0 },
      home: { abbr: "MIL", runs: 1, hits: 2, errors: 0 },
      innings: [
        { num: 1, away: 1, home: 0 }, { num: 2, away: 0, home: 1 }, { num: 3, away: null, home: null },
        { num: 4, away: null, home: null }, { num: 5, away: null, home: null }, { num: 6, away: null, home: null },
        { num: 7, away: null, home: null }, { num: 8, away: null, home: null }, { num: 9, away: null, home: null },
      ],
    },
    winProb: [{ home: 50 }, { home: 47 }, { home: 52 }, { home: 49 }],
  },
};

function waitMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function applyLayout(el, open) {
  if (!el) return;
  if (open) {
    el.classList.add("expanded");
    el.classList.remove("ready", "collapsing");
  } else {
    el.classList.remove("expanded", "ready", "collapsing");
  }
}

async function animateExpand(el) {
  animating = true;
  applyLayout(el, true);
  await waitMs(OPEN_MS + 20);
  el.classList.add("ready");
  animating = false;
}

async function animateCollapse(el) {
  animating = true;
  el.classList.remove("ready");
  el.classList.add("collapsing");
  el.classList.remove("expanded");
  await waitMs(CLOSE_MS + 20);
  el.classList.remove("collapsing");
  animating = false;
}

async function toggleExpanded(el) {
  if (!el || animating) return;
  const pk = +el.dataset.pk;
  const opening = !expandedPks.has(pk);

  if (!opening) {
    await animateCollapse(el);
    expandedPks.delete(pk);
    return;
  }

  expandedPks.add(pk);
  await animateExpand(el);
}

function situationHtml(v) {
  const [balls, strikes] = String(v.count || "0-0").split("-");
  const outs = Math.max(0, Math.min(3, +v.outs || 0));
  const pad = (on, cls, label) =>
    `<span class="base ${cls}${on ? " on" : ""}" title="${label}"></span>`;
  const outDots = [0, 1, 2].map(i =>
    `<span class="out-dot${i < outs ? " on" : ""}"></span>`
  ).join("");
  return `<div class="situation" aria-label="${esc(balls)} and ${esc(strikes)}, ${outs} out${outs === 1 ? "" : "s"}">
    <div class="diamond" aria-hidden="true">
      <svg class="diamond-outline" viewBox="0 0 100 100">
        <path d="M50 88 L12 50 L50 12 L88 50 Z" fill="none" stroke="currentColor" stroke-width="1.5"/>
      </svg>
      ${pad(v.on_2b, "b2", "2B")}
      ${pad(v.on_3b, "b3", "3B")}
      ${pad(v.on_1b, "b1", "1B")}
    </div>
    <div class="sit-count">${esc(balls)}-${esc(strikes)}</div>
    <div class="outs">${outDots}</div>
  </div>`;
}

function headshot(id, alt) {
  const src = `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/${id}/headshot/67/current`;
  return `<img class="headshot" src="${src}" alt="${esc(alt || "")}" width="40" height="40" loading="lazy">`;
}

function pitchZoneWireframe() {
  const W = 260, H = 320;
  const zoneW = 108, zoneHPx = 126;
  const cx = W / 2;
  const L = cx - zoneW / 2, R = cx + zoneW / 2;
  const cellW = zoneW / 3, cellH = zoneHPx / 3;
  const oL = L - cellW, oR = R + cellW;
  const oT = 36, oB = oT + zoneHPx + 2 * cellH;
  const T = oT + cellH, B = T + zoneHPx;
  const plateGap = 18;
  const plateTop = oB + plateGap;
  const pFlat = plateTop + 11;
  const pTip = plateTop + 38;
  return { W, H, cx, L, R, T, B, oL, oR, oT, oB, zoneW, zoneHPx, cellW, cellH, plateGap, plateTop, pFlat, pTip };
}

/** IRON RULE: fit far pitches by uniform scale only — never squash/stretch X vs Y independently. */
function pitchZoneDotLayout(pitches, szTop, szBot, wf) {
  const DOT_R = 11, MARGIN = 4;
  const half = 17 / 24;
  const zoneH = szTop - szBot || 2;
  const { L, R, T, B, oL, oR, oT, oB, zoneW, zoneHPx } = wf;
  const zcx = (L + R) / 2, zcy = (T + B) / 2;
  const boundL = oL + MARGIN, boundR = oR - MARGIN;
  const boundT = oT + MARGIN, boundB = oB - MARGIN;
  const base = pitches.map(p => ({
    x: L + ((p.px + half) / (2 * half)) * zoneW,
    y: B - ((p.pz - szBot) / zoneH) * zoneHPx,
  }));
  let scaleX = 1, scaleY = 1;
  for (const { x: bx, y: by } of base) {
    const dx = bx - zcx, dy = by - zcy;
    if (dx > 0) scaleX = Math.min(scaleX, (boundR - DOT_R - zcx) / dx);
    else if (dx < 0) scaleX = Math.min(scaleX, (boundL + DOT_R - zcx) / dx);
    if (dy > 0) scaleY = Math.min(scaleY, (boundB - DOT_R - zcy) / dy);
    else if (dy < 0) scaleY = Math.min(scaleY, (boundT + DOT_R - zcy) / dy);
  }
  const scale = Math.min(1, scaleX, scaleY);
  const dots = base.map(({ x, y }) => ({
    x: zcx + (x - zcx) * scale,
    y: zcy + (y - zcy) * scale,
  }));
  return { scale, scaleX, scaleY, dots };
}

function pitchZoneHtml(item) {
  const all = item.view?.pitches || item.pitches || [];
  const pitches = all.filter(p => p.px != null && p.pz != null);
  if (!pitches.length) {
    return `<div class="super-panel pitch-panel">
      <h3 class="section-title">Pitch view</h3>
      <p class="empty">No pitch locations yet</p>
    </div>`;
  }

  const szTop = pitches.map(p => p.szTop).find(Number.isFinite) ?? 3.5;
  const szBot = pitches.map(p => p.szBot).find(Number.isFinite) ?? 1.5;
  const wf = pitchZoneWireframe();
  const { W, H, cx, L, R, T, B, oL, oR, oT, oB, zoneW, zoneHPx, cellW, cellH, plateGap, plateTop, pFlat, pTip } = wf;
  const { scale, scaleX, scaleY, dots: dotPos } = pitchZoneDotLayout(pitches, szTop, szBot, wf);

  const stroke = "#111";
  const shadow = "#bbb";
  const shadowGrid = [
    ...[oL, L, R, oR].map(x =>
      `<line x1="${x.toFixed(1)}" y1="${oT.toFixed(1)}" x2="${x.toFixed(1)}" y2="${oB.toFixed(1)}" stroke="${shadow}" stroke-width="1"/>`),
    ...[oT, T, B, oB].map(y =>
      `<line x1="${oL.toFixed(1)}" y1="${y.toFixed(1)}" x2="${oR.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${shadow}" stroke-width="1"/>`),
  ].join("");
  const zoneGrid = [1, 2].map(i => {
    const gx = L + cellW * i, gy = T + cellH * i;
    return `<line x1="${gx.toFixed(1)}" y1="${T.toFixed(1)}" x2="${gx.toFixed(1)}" y2="${B.toFixed(1)}" stroke="#ccc" stroke-width="1"/>
      <line x1="${L.toFixed(1)}" y1="${gy.toFixed(1)}" x2="${R.toFixed(1)}" y2="${gy.toFixed(1)}" stroke="#ccc" stroke-width="1"/>`;
  }).join("");

  const dots = pitches.map((p, i) => {
    const fill = DOT_FILL[p.kind] || "#555";
    const { x, y } = dotPos[i];
    return `<g>
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" fill="${fill}" stroke="#fff" stroke-width="2"/>
      <text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" fill="#fff" font-size="11" font-weight="800" font-family="system-ui,sans-serif">${p.n}</text>
    </g>`;
  }).join("");

  return `<div class="super-panel pitch-panel">
    <h3 class="section-title">Pitch view</h3>
    <svg class="pitch-zone" viewBox="0 0 ${W} ${H}" overflow="hidden" role="img" aria-label="Catcher's view pitch locations"
      data-pz-scale="${scale.toFixed(4)}" data-pz-scale-x="${scaleX.toFixed(4)}" data-pz-scale-y="${scaleY.toFixed(4)}">
      <rect data-pz="outer" x="${oL.toFixed(1)}" y="${oT.toFixed(1)}" width="${(oR - oL).toFixed(1)}" height="${(oB - oT).toFixed(1)}"
        fill="#f7f7f7" stroke="${shadow}" stroke-width="1"/>
      ${shadowGrid}
      <rect data-pz="inner" x="${L.toFixed(1)}" y="${T.toFixed(1)}" width="${zoneW.toFixed(1)}" height="${zoneHPx.toFixed(1)}"
        fill="#fff" stroke="${stroke}" stroke-width="2.25"/>
      ${zoneGrid}
      <path data-pz="plate" data-plate-top="${plateTop.toFixed(1)}" data-gap="${plateGap}"
        d="M${L.toFixed(1)} ${plateTop.toFixed(1)}
        L${R.toFixed(1)} ${plateTop.toFixed(1)}
        L${R.toFixed(1)} ${pFlat.toFixed(1)}
        L${cx.toFixed(1)} ${pTip.toFixed(1)}
        L${L.toFixed(1)} ${pFlat.toFixed(1)} Z"
        fill="#fff" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="miter"/>
      ${dots}
    </svg>
  </div>`;
}
function linescoreHtml(item) {
  const ls = item.linescore;
  if (!ls) {
    return `<div class="super-panel">
      <h3 class="section-title">Scoreboard</h3>
      <p class="empty">No linescore</p>
    </div>`;
  }
  const inns = ls.innings || [];
  const head = inns.map(i => `<th>${i.num}</th>`).join("") + "<th>R</th><th>H</th><th>E</th>";
  const cell = v => `<td>${v == null ? "" : esc(v)}</td>`;
  const awayCells = inns.map(i => cell(i.away)).join("")
    + cell(ls.away.runs) + cell(ls.away.hits) + cell(ls.away.errors);
  const homeCells = inns.map(i => cell(i.home)).join("")
    + cell(ls.home.runs) + cell(ls.home.hits) + cell(ls.home.errors);
  return `<div class="super-panel">
    <h3 class="section-title">Scoreboard</h3>
    <div class="linescore-wrap">
      <table class="linescore">
        <thead><tr><th></th>${head}</tr></thead>
        <tbody>
          <tr><th>${esc(ls.away.abbr)}</th>${awayCells}</tr>
          <tr><th>${esc(ls.home.abbr)}</th>${homeCells}</tr>
        </tbody>
      </table>
    </div>
  </div>`;
}

function winProbPanelHtml(item) {
  const home = item.linescore?.home?.abbr || "Home";
  const last = item.winProb?.length ? item.winProb[item.winProb.length - 1] : null;
  const pctVal = last ? `${Math.round(last.home)}%` : "—";
  return `<div class="super-panel">
    <div class="acc-head">
      <h3 class="section-title super-wp-title">${esc(home)} win prob</h3>
      <span class="acc-val super-wp-val">${pctVal}</span>
    </div>
    <div class="acc-wrap super-wp-wrap">
      <canvas id="super-wp-chart"></canvas>
    </div>
  </div>`;
}

function drawWinProbChart(item) {
  const canvas = document.getElementById("super-wp-chart");
  if (!canvas || typeof Chart === "undefined") return;
  const series = item.winProb || [];
  const labels = series.map((_, i) => String(i + 1));
  const data = series.map(p => Math.round(p.home * 10) / 10);
  if (winProbChart) {
    winProbChart.destroy();
    winProbChart = null;
  }
  if (Chart.Filler) Chart.register(Chart.Filler);
  winProbChart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        data,
        borderColor: "#041e42",
        backgroundColor: "rgba(4, 30, 66, 0.08)",
        fill: "origin",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.25,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      layout: { padding: 0 },
      scales: {
        x: { display: false },
        y: {
          min: 0,
          max: 100,
          ticks: { stepSize: 50, callback: v => v + "%", maxTicksLimit: 3, font: { size: 10 } },
          grid: { color: "#eee" },
          border: { display: false },
        },
      },
    },
  });
}

function fmtRate(n) {
  return (n || n === 0) ? (n < 1 ? n.toFixed(3).slice(1) : n.toFixed(3)) : "—";
}
function fmtEra(n) {
  return (n || n === 0) ? Number(n).toFixed(2) : "—";
}

function superPredHtml(item) {
  if (item.done) return `<p class="empty">Waiting for next batter</p>`;
  const ranked = (item.ranked || []).slice(0, 5)
    .map(([t, p], j) => `<li class="${j === 0 ? "best" : ""}"><span>${esc(name(t))}</span><span>${(p * 100).toFixed(1)}%</span></li>`)
    .join("");
  return `<ul class="pred">${ranked}</ul>`;
}

function superDetailInner(item) {
  const st = item.stats;
  const abResult = item.result ? `<p class="ab-result">${esc(item.result)}</p>` : "";
  const log = item.pitches.length
    ? `<h3 class="section-title">Past pitches</h3><ul class="pitch-log">${item.pitches.map(p => {
      const preds = (p.ranked || []).slice(0, 3)
        .map(([t, pr], i) => {
          const text = `${esc(name(t))} ${(pr * 100).toFixed(1)}%`;
          return i === 0 ? `<strong>${text}</strong>` : text;
        }).join(", ") || "—";
      const hit = p.ranked?.[0]?.[0] === p.type;
      return `<li>
        <span class="dot-wrap"><span class="dot ${p.kind}">${p.n}</span></span>
        <div>
          <div class="preds">Predicted: ${preds}</div>
          <div class="actual ${hit ? "match" : "miss"}">Actual: ${esc(name(p.type))}</div>
          <div class="outcome">${esc(p.outcome || "")}</div>
        </div>
      </li>`;
    }).join("")}</ul>`
    : `<p class="empty">No pitches yet</p>`;
  return `
    <div class="stats">
      <div class="stat-box">
        <div class="lbl">Pitching</div>
        <div class="stat-player">${headshot(item.pitcher.id, item.pitcher.name)}<div><div class="name">${esc(item.pitcher.name)}</div><div class="nums era">ERA ${fmtEra(st?.era)}</div></div></div>
      </div>
      <div class="stat-box">
        <div class="lbl">At bat</div>
        <div class="stat-player">${headshot(item.batter.id, item.batter.name)}<div><div class="name">${esc(item.batter.name)}</div><div class="nums slash">${fmtRate(st?.avg)} / ${fmtRate(st?.obp)} / ${fmtRate(st?.slg)}</div></div></div>
      </div>
    </div>
    ${abResult}
    ${log}`;
}

function renderSuper() {
  const root = document.getElementById("super-modal");
  if (!root || superPk == null) return;
  const item = SAMPLE_SUPER[superPk];
  if (!item) {
    closeSuper();
    return;
  }
  const panel = root.querySelector(".super-panel-root");
  if (!panel) return;
  if (winProbChart) {
    winProbChart.destroy();
    winProbChart = null;
  }
  panel.innerHTML = `
    <header class="super-head">
      <div class="row">
        <span class="game">${esc(item.game)}</span>
        <span class="inning">${esc(item.inning)}</span>
      </div>
      <button type="button" class="super-close" aria-label="Close full game view">×</button>
    </header>
    <div class="super-layout">
      <div class="super-main">
        <div class="card-main">
          <div class="pitches">${(item.pitches || []).map(p =>
            `<span class="dot-wrap"><span class="dot ${p.kind}">${p.n}</span></span>`
          ).join("")}</div>
          <div>
            <div class="matchup">${esc(item.matchup)}</div>
            ${situationHtml(item)}
            ${superPredHtml(item)}
          </div>
        </div>
        <div class="super-detail">
          ${superDetailInner(item)}
        </div>
      </div>
      <aside class="super-side">
        ${pitchZoneHtml(item)}
        <div class="super-side-bottom">
          ${winProbPanelHtml(item)}
          ${linescoreHtml(item)}
        </div>
      </aside>
    </div>`;
  drawWinProbChart(item);
}

function openSuper(pk) {
  superPk = pk;
  document.body.classList.add("super-open");
  const root = document.getElementById("super-modal");
  if (root) {
    root.hidden = false;
    root.setAttribute("aria-hidden", "false");
  }
  renderSuper();
}

function closeSuper() {
  superPk = null;
  document.body.classList.remove("super-open");
  const root = document.getElementById("super-modal");
  if (root) {
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    const panel = root.querySelector(".super-panel-root");
    if (panel) panel.innerHTML = "";
  }
  if (winProbChart) {
    winProbChart.destroy();
    winProbChart = null;
  }
}

const debugList = document.getElementById("list");
CardColumns.packList(debugList);
CardColumns.observeColumns(debugList);

document.getElementById("list")?.addEventListener("click", e => {
  const superBtn = e.target.closest(".super-btn");
  if (superBtn) {
    e.stopPropagation();
    e.preventDefault();
    openSuper(+superBtn.dataset.superPk);
    return;
  }
  const c = e.target.closest(".card");
  if (c) toggleExpanded(c);
});
document.getElementById("list")?.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  if (e.target.closest(".super-btn")) return;
  const c = e.target.closest(".card");
  if (c) toggleExpanded(c);
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (superPk != null) {
    closeSuper();
    return;
  }
  if (!expandedPks.size) return;
  const open = document.querySelectorAll("#list .card.expanded");
  const last = open[open.length - 1];
  if (last) toggleExpanded(last);
});

const superModal = document.getElementById("super-modal");
superModal?.addEventListener("click", e => {
  if (e.target === superModal || e.target.classList.contains("super-backdrop")) {
    closeSuper();
    return;
  }
  if (e.target.closest(".super-close")) closeSuper();
});

/* —— Pitch view fixed-zone harness —— */
const PITCH_ZONE_TEST_PITCHES = [
  { n: 1, kind: "strike", px: 0, pz: 2.5, szTop: 3.5, szBot: 1.5 },
  { n: 2, kind: "ball", px: -2.2, pz: 4.8, szTop: 3.5, szBot: 1.5 },
  { n: 3, kind: "ball", px: 1.9, pz: 0.4, szTop: 3.5, szBot: 1.5 },
  { n: 4, kind: "strike", px: 0.55, pz: 3.45, szTop: 3.5, szBot: 1.5 },
  { n: 5, kind: "ball", px: -1.6, pz: 1.1, szTop: 3.5, szBot: 1.5 },
];

let pzTestIdx = 1;

function pitchZoneMetricsFromEl(root) {
  const svg = root?.querySelector(".pitch-zone");
  if (!svg) return null;
  const inner = svg.querySelector('[data-pz="inner"]');
  const outer = svg.querySelector('[data-pz="outer"]');
  const plate = svg.querySelector('[data-pz="plate"]');
  if (!inner || !outer || !plate) return null;
  const scale = +svg.dataset.pzScale;
  const scaleX = +svg.dataset.pzScaleX;
  const scaleY = +svg.dataset.pzScaleY;
  const circles = [...svg.querySelectorAll("circle")];
  const boundL = +outer.getAttribute("x") + 4;
  const boundR = boundL + +outer.getAttribute("width") - 8;
  const boundT = +outer.getAttribute("y") + 4;
  const boundB = boundT + +outer.getAttribute("height") - 8;
  const dotsInBounds = circles.every(c => {
    const cx = +c.getAttribute("cx"), cy = +c.getAttribute("cy"), r = +c.getAttribute("r");
    return cx - r >= boundL && cx + r <= boundR && cy - r >= boundT && cy + r <= boundB;
  });
  return {
    inner: {
      x: +inner.getAttribute("x"),
      y: +inner.getAttribute("y"),
      w: +inner.getAttribute("width"),
      h: +inner.getAttribute("height"),
    },
    outer: {
      x: +outer.getAttribute("x"),
      y: +outer.getAttribute("y"),
      w: +outer.getAttribute("width"),
      h: +outer.getAttribute("height"),
    },
    plateTop: +plate.dataset.plateTop,
    gap: +plate.dataset.gap,
    scale,
    scaleX,
    scaleY,
    uniformScale: scale === Math.min(1, scaleX, scaleY),
    dotsInBounds,
    dotCount: circles.length,
  };
}

function renderPitchZoneTest() {
  const root = document.getElementById("pitch-zone-test-view");
  if (!root) return;
  root.innerHTML = pitchZoneHtml({ pitches: PITCH_ZONE_TEST_PITCHES.slice(0, pzTestIdx) });
  const m = pitchZoneMetricsFromEl(root);
  const meta = document.getElementById("pitch-zone-test-metrics");
  if (!meta) return;
  if (!m) {
    meta.textContent = "No pitches";
    return;
  }
  meta.textContent =
    `Showing pitch ${pzTestIdx}/${PITCH_ZONE_TEST_PITCHES.length} · `
    + `inner ${m.inner.w}×${m.inner.h} @ (${m.inner.x}, ${m.inner.y}) · `
    + `outer ${m.outer.w}×${m.outer.h} · gap ${m.gap}px · scale ${m.scale.toFixed(3)} · dots ${m.dotCount}`;
}

function runPitchZoneChecks() {
  const expected = pitchZoneWireframe();
  const root = document.getElementById("pitch-zone-test-view");
  const status = document.getElementById("pitch-zone-test-status");
  if (!root || !status) return;

  const failures = [];
  for (let i = 1; i <= PITCH_ZONE_TEST_PITCHES.length; i++) {
    root.innerHTML = pitchZoneHtml({ pitches: PITCH_ZONE_TEST_PITCHES.slice(0, i) });
    const m = pitchZoneMetricsFromEl(root);
    const ok = m
      && m.inner.w === expected.zoneW
      && m.inner.h === expected.zoneHPx
      && m.inner.x === expected.L
      && m.inner.y === expected.T
      && m.outer.w === expected.zoneW + 2 * expected.cellW
      && m.outer.h === expected.zoneHPx + 2 * expected.cellH
      && m.plateTop === expected.plateTop
      && m.gap === expected.plateGap
      && m.uniformScale
      && m.dotsInBounds
      && m.dotCount === i
      && (i === 1 ? m.scale === 1 : m.scale <= 1);
    if (!ok) failures.push(i);
  }

  renderPitchZoneTest();

  if (!failures.length) {
    status.innerHTML = `<span class="debug-pz-pass">All ${PITCH_ZONE_TEST_PITCHES.length} checks passed — wireframe fixed, uniform scale only, dots in bounds.</span>`;
    return;
  }
  status.innerHTML = `<span class="debug-pz-fail">Failed at pitch step(s): ${failures.join(", ")}</span>`;
}

document.getElementById("pz-prev")?.addEventListener("click", () => {
  pzTestIdx = Math.max(1, pzTestIdx - 1);
  renderPitchZoneTest();
});
document.getElementById("pz-next")?.addEventListener("click", () => {
  pzTestIdx = Math.min(PITCH_ZONE_TEST_PITCHES.length, pzTestIdx + 1);
  renderPitchZoneTest();
});
document.getElementById("pz-reset")?.addEventListener("click", () => {
  pzTestIdx = 1;
  renderPitchZoneTest();
  const status = document.getElementById("pitch-zone-test-status");
  if (status) status.textContent = "";
});
document.getElementById("pz-run")?.addEventListener("click", runPitchZoneChecks);

renderPitchZoneTest();
runPitchZoneChecks();

/** Known hitters — include regulars so prior season usually differs from current. */
const SLASH_TEST_BATTERS = [
  { id: 592450, name: "Aaron Judge" },
  { id: 660271, name: "Shohei Ohtani" },
  { id: 677594, name: "Julio Rodríguez" },
  { id: 646240, name: "Rafael Devers" },
  { id: 571448, name: "Nolan Arenado" },
  { id: 665742, name: "Kyle Tucker" },
];

function fmtSlashLine(avg, obp, slg) {
  return `${fmtRate(avg)} / ${fmtRate(obp)} / ${fmtRate(slg)}`;
}

function sameSlash(a, b) {
  return a?.[0] === b?.[0] && a?.[1] === b?.[1] && a?.[2] === b?.[2];
}

async function runSlashChecks() {
  const meta = document.getElementById("slash-test-meta");
  const status = document.getElementById("slash-test-status");
  const rows = document.getElementById("slash-test-rows");
  const btn = document.getElementById("slash-run");
  if (!meta || !status || !rows) return;

  const yr = new Date().getFullYear();
  if (btn) btn.disabled = true;
  meta.textContent = `Checking ${SLASH_TEST_BATTERS.length} batters for ${yr} season slash…`;
  status.textContent = "";
  rows.innerHTML = "";
  slashCache.clear();

  try {
    let pass = 0;
    let fail = 0;
    let usedPrior = 0;

    for (const batter of SLASH_TEST_BATTERS) {
      const [used, currentSt, prevSt] = await Promise.all([
        slash(batter.id, yr),
        loadHittingSeason(batter.id, yr),
        loadHittingSeason(batter.id, yr - 1),
      ]);
      const current = [num(currentSt.avg), num(currentSt.obp), num(currentSt.slg)];
      const prev = [num(prevSt.avg), num(prevSt.obp), num(prevSt.slg)];
      const pa = num(currentSt.plateAppearances);
      const prevPa = num(prevSt.plateAppearances);
      const expectPrior = pa < 100 && prevPa > pa;
      const expected = expectPrior ? prev : current;
      const source = expectPrior ? `prior ${yr - 1}` : `${yr} season`;
      if (expectPrior) usedPrior++;

      const ok = sameSlash(used, expected);
      if (ok) pass++;
      else fail++;

      const tr = document.createElement("tr");
      tr.className = ok ? "hit" : "miss";
      tr.innerHTML = `
        <td>${esc(batter.name)}</td>
        <td class="mono">${pa || "—"}</td>
        <td class="mono">${fmtSlashLine(...current)}</td>
        <td class="mono">${fmtSlashLine(...prev)}</td>
        <td class="mono">${fmtSlashLine(...used)}</td>
        <td>${esc(source)}</td>
        <td class="${ok ? "ok" : "err"}">${ok ? "pass" : "fail"}</td>`;
      rows.appendChild(tr);
    }

    meta.textContent =
      `${yr} season API · ${SLASH_TEST_BATTERS.length} batters`
      + (usedPrior ? ` · ${usedPrior} fell back to ${yr - 1}` : " · all used current season");

    if (!fail) {
      status.innerHTML =
        `<span class="debug-pz-pass">All ${pass} checks passed — current season when PA ≥ 100, prior year when PA &lt; 100.</span>`;
    } else {
      status.innerHTML =
        `<span class="debug-pz-fail">${fail} failed, ${pass} passed.</span>`;
    }
  } catch (e) {
    status.innerHTML = `<span class="debug-pz-fail">Slash check error: ${esc(e.message)}</span>`;
    meta.textContent = "Failed to run slash checks.";
  } finally {
    if (btn) btn.disabled = false;
  }
}

document.getElementById("slash-run")?.addEventListener("click", () => {
  runSlashChecks();
});
runSlashChecks();
