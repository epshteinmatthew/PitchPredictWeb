const MLB = "https://statsapi.mlb.com/api";
const API = new URLSearchParams(location.search).get("api") || "https://pitchpredict-910442.tail42c403.ts.net";
const TYPE = {SI:0,CH:1,FF:2,ST:3,FC:4,FS:5,SL:6,CU:7,SV:8,KC:9,FO:10,PO:11,FA:12,UN:13,CS:14,EP:15,KN:16,SC:17};
const TYPE_ALIAS = {FT:"SI", SF:"FS"};
const TYPE_CODE = Object.fromEntries(Object.entries(TYPE).map(([k, v]) => [v, k]));
const typeIndex = code => TYPE[TYPE_ALIAS[code] || code] ?? TYPE.UN;
const CALL = {called_strike:0,ball:1,swinging_strike:2,blocked_ball:3,foul:4,foul_bunt:5,foul_tip:6,automatic_ball:7,swinging_strike_blocked:8,automatic_strike:9,pitchout:10,missed_bunt:11,bunt_foul_tip:12,hit_into_play:13,hit_by_pitch:14,swinging_pitchout:15};
const CODE = {B:"ball","*":"blocked_ball",C:"called_strike",S:"swinging_strike",W:"swinging_strike_blocked",T:"foul_tip",F:"foul",L:"foul_bunt",M:"missed_bunt",O:"bunt_foul_tip",P:"pitchout",Q:"swinging_pitchout",X:"hit_into_play",D:"hit_into_play",E:"hit_into_play",H:"hit_by_pitch",V:"automatic_ball",A:"automatic_strike"};
const KIND = {
  ball: "ball", blocked_ball: "ball", automatic_ball: "ball", pitchout: "ball",
  called_strike: "strike", swinging_strike: "strike", swinging_strike_blocked: "strike",
  automatic_strike: "strike", foul: "strike", foul_bunt: "strike", foul_tip: "strike",
  missed_bunt: "strike", bunt_foul_tip: "strike", swinging_pitchout: "strike",
  hit_into_play: "play", hit_by_pitch: "play",
};
const NAME = {
  SI:"Sinker", CH:"Changeup", FF:"Four-Seam Fastball", ST:"Sweeper", FC:"Cutter",
  FS:"Splitter", SL:"Slider", CU:"Curveball", SV:"Slurve", KC:"Knuckle Curve",
  FO:"Forkball", PO:"Pitchout", FA:"Fastball", UN:"Unknown", CS:"Slow Curve",
  EP:"Eephus", KN:"Knuckleball", SC:"Screwball",
};
const OUTCOME = {
  ball: "Ball", blocked_ball: "Blocked ball", automatic_ball: "Automatic ball", pitchout: "Pitchout",
  called_strike: "Called strike", swinging_strike: "Swinging strike",
  swinging_strike_blocked: "Swinging strike (blocked)", automatic_strike: "Automatic strike",
  foul: "Foul", foul_bunt: "Foul bunt", foul_tip: "Foul tip", missed_bunt: "Missed bunt",
  bunt_foul_tip: "Bunt foul tip", swinging_pitchout: "Swinging pitchout",
  hit_into_play: "In play", hit_by_pitch: "Hit by pitch",
};
const codeFrom = t => TYPE_CODE[t] ?? TYPE_CODE[+t] ?? t;
const name = c => NAME[codeFrom(c)] || codeFrom(c) || c;
const outcomeName = c => OUTCOME[c] || c;
const normalizeRanked = ranked => (ranked || [])
  .map(([t, p]) => [codeFrom(t), p])
  .filter(([t]) => t !== "UN");

function arsenalCodes(mix) {
  const codes = new Set();
  for (const { code } of mix || []) {
    const mapped = TYPE_ALIAS[code] || code;
    if (mapped in TYPE) codes.add(mapped);
  }
  return codes;
}

function maskRanked(ranked, allowed) {
  if (!allowed?.size || !ranked?.length) return ranked;
  const filtered = ranked.filter(([t]) => allowed.has(t));
  if (!filtered.length) return ranked;
  const total = filtered.reduce((s, [, p]) => s + p, 0);
  if (total <= 0) return filtered;
  return filtered.map(([t, p]) => [t, p / total]);
}

let items = [];
let expandedPks = new Set();
let year = new Date().getFullYear();

const pad = n => String(n).padStart(2, "0");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const num = x => parseFloat(x) || 0;
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const get = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
const fmtRate = n => (n || n === 0) ? (n < 1 ? n.toFixed(3).slice(1) : n.toFixed(3)) : "—";
const fmtEra = n => (n || n === 0) ? num(n).toFixed(2) : "—";

async function slash(id, yr) {
  const key = `slash:${id}:${yr}`;
  const hit = sessionStorage.getItem(key);
  if (hit) return JSON.parse(hit);
  const load = async y => {
    const j = await get(`${MLB}/v1/people/${id}/stats?stats=season&group=hitting&season=${y}`);
    return j.stats?.[0]?.splits?.[0]?.stat || {};
  };
  let st = await load(yr);
  if (num(st.plateAppearances) < 100) st = await load(yr - 1);
  const line = [num(st.avg), num(st.obp), num(st.slg)];
  sessionStorage.setItem(key, JSON.stringify(line));
  return line;
}

async function era(id, yr) {
  const key = `era:${id}:${yr}`;
  const hit = sessionStorage.getItem(key);
  if (hit) return JSON.parse(hit);
  const j = await get(`${MLB}/v1/people/${id}/stats?stats=season&group=pitching&season=${yr}`);
  const e = num(j.stats?.[0]?.splits?.[0]?.stat?.era);
  sessionStorage.setItem(key, JSON.stringify(e));
  return e;
}

async function pitchMix(id, yr) {
  const key = `mix:${id}:${yr}`;
  const hit = sessionStorage.getItem(key);
  if (hit) return JSON.parse(hit);
  const load = async y => {
    const j = await get(`${MLB}/v1/people/${id}/stats?stats=pitchArsenal&group=pitching&season=${y}`);
    return (j.stats?.[0]?.splits || [])
      .map(s => ({
        code: s.stat?.type?.code || "",
        pct: s.stat?.percentage || 0,
      }))
      .filter(x => x.code)
      .sort((a, b) => b.pct - a.pct);
  };
  let mix = await load(yr);
  if (!mix.length) mix = await load(yr - 1);
  sessionStorage.setItem(key, JSON.stringify(mix));
  return mix;
}

async function loadStats(item) {
  if (item.stats) return item.stats;
  const v = item.view;
  const [[avg, obp, slg], pitcherEra] = await Promise.all([
    slash(v.batter.id, year),
    era(v.pitcher.id, year),
  ]);
  item.stats = { avg, obp, slg, era: pitcherEra };
  return item.stats;
}

function atBat(feed, gamePk) {
  const play = feed.liveData?.plays?.currentPlay;
  const ls = feed.liveData?.linescore || {};
  const about = play?.about || {};
  const mu = play?.matchup || {};
  if (!play || !mu.pitcher?.id || !mu.batter?.id) return null;
  const half = about.halfInning === "bottom" ? 1 : 0;
  const away = ls.teams?.away?.runs || 0;
  const home = ls.teams?.home?.runs || 0;
  const events = (play.playEvents || []).filter(e => e.isPitch);
  const calls = [], types = [];
  const pitches = events.map((p, i) => {
    const d = p.details || {};
    const code = d.call?.code || d.code;
    const call = CODE[code] || "ball";
    calls.push(CALL[call] ?? CALL.ball);
    types.push(typeIndex(d.type?.code));
    let kind = KIND[call] || "ball";
    if (call === "hit_into_play" && (d.isOut || code === "X")) kind = "out";
    return {
      n: i + 1,
      kind,
      type: d.type?.code || "",
      call,
      outcome: d.call?.description || outcomeName(call),
    };
  });
  const date = feed.gameData?.datetime?.officialDate || today();
  const off = feed.liveData?.linescore?.offense || {};
  return {
    gamePk,
    body: {
      game_date: +date.replaceAll("-", ""),
      at_bat_number: (about.atBatIndex ?? 0) + 1,
      pitch_number: events.length + 1,
      pitcher_id: mu.pitcher.id,
      batter_id: mu.batter.id,
      pitch_calls_so_far: calls,
      pitch_types_so_far: types,
      outs: play.count?.outs ?? ls.outs ?? 0,
      on_1b: off.first ? 1 : 0,
      on_2b: off.second ? 1 : 0,
      on_3b: off.third ? 1 : 0,
      offense_score: half ? home : away,
      defense_score: half ? away : home,
      inning: about.inning || ls.currentInning || 1,
      inning_half: half,
      p_throws: mu.pitchHand?.code === "L" ? 1 : 0,
      stand: mu.batSide?.code === "L" ? 1 : 0,
    },
    view: {
      game: `${feed.gameData.teams.away.abbreviation} ${away} @ ${feed.gameData.teams.home.abbreviation} ${home}`,
      inning: `${half ? "Bot" : "Top"} ${about.inning || ls.currentInning}`,
      count: `${play.count?.balls ?? 0}-${play.count?.strikes ?? 0}`,
      outs: play.count?.outs ?? ls.outs ?? 0,
      on_1b: !!off.first,
      on_2b: !!off.second,
      on_3b: !!off.third,
      pitcher: { id: mu.pitcher.id, name: mu.pitcher.fullName },
      batter: { id: mu.batter.id, name: mu.batter.fullName },
      matchup: `${mu.pitcher.fullName} vs ${mu.batter.fullName}`,
      done: !!about.isComplete,
      result: about.isComplete ? (play.result?.description || play.result?.event || "") : "",
      pitches,
    },
  };
}

async function predict(body, yr) {
  const key = `p2:${body.pitcher_id}:${body.batter_id}:${body.at_bat_number}:${body.pitch_number}:${body.pitch_types_so_far.join("-")}:${body.pitch_calls_so_far.join("-")}`;
  const hit = sessionStorage.getItem(key);
  if (hit) return normalizeRanked(JSON.parse(hit));
  const [avg, obp, slg] = await slash(body.batter_id, yr);
  const r = await fetch(`${API}/predict/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, batter_avg: avg, batter_obp: obp, batter_slg: slg }),
  });
  if (!r.ok) throw new Error("predict " + r.status);
  const ranked = normalizeRanked(await r.json());
  sessionStorage.setItem(key, JSON.stringify(ranked));
  return ranked;
}

function fingerprint(ab) {
  const v = ab.view;
  const b = ab.body;
  return [
    ab.gamePk,
    b.at_bat_number,
    v.pitches.length,
    v.count,
    b.outs,
    b.on_1b, b.on_2b, b.on_3b,
    b.batter_id,
    b.pitcher_id,
    v.done ? 1 : 0,
    v.game,
    v.inning,
    v.result || "",
  ].join("|");
}

function predKey(ab) {
  return [
    ab.gamePk,
    ab.body.at_bat_number,
    ab.body.batter_id,
    ab.body.pitcher_id,
    ab.view.pitches.length,
    ab.body.pitch_calls_so_far.join("-"),
    ab.body.pitch_types_so_far.join("-"),
    ab.view.done ? 1 : 0,
  ].join("|");
}

function carryPreds(old, ab) {
  if (!old) return;
  if (old.stats) ab.stats = old.stats;
  const sameAb = old.body?.at_bat_number === ab.body.at_bat_number
    && old.body?.batter_id === ab.body.batter_id
    && old.body?.pitcher_id === ab.body.pitcher_id;
  if (!sameAb) return;
  for (const p of ab.view.pitches) {
    const op = old.view.pitches.find(x => x.n === p.n);
    if (op?.ranked) p.ranked = normalizeRanked(op.ranked);
    else if (op?.err) p.err = op.err;
  }
  if (!ab.view.done && old.ranked && old._predKey === predKey(ab)) {
    ab.ranked = normalizeRanked(old.ranked);
    if (old.err) ab.err = old.err;
  }
}

async function attachPreds(ab, yr) {
  const mix = await pitchMix(ab.body.pitcher_id, yr);
  const allowed = arsenalCodes(mix);
  const jobs = ab.view.pitches.map(async (p, i) => {
    if (p.ranked) return;
    const body = {
      ...ab.body,
      pitch_number: i + 1,
      pitch_calls_so_far: ab.body.pitch_calls_so_far.slice(0, i),
      pitch_types_so_far: ab.body.pitch_types_so_far.slice(0, i),
    };
    try { p.ranked = await predict(body, yr); }
    catch (e) { p.err = e.message; }
  });
  if (!ab.view.done && !ab.ranked) {
    jobs.push(predict(ab.body, yr).then(r => { ab.ranked = r; }).catch(e => { ab.err = e.message; }));
  }
  await Promise.all(jobs);
  for (const p of ab.view.pitches) {
    if (p.ranked) p.ranked = maskRanked(p.ranked, allowed);
  }
  if (ab.ranked) ab.ranked = maskRanked(ab.ranked, allowed);
  ab._predKey = predKey(ab);
}

function highConf(ranked) {
  if (!ranked?.length) return false;
  return ranked[0][1] - (ranked[1]?.[1] ?? 0) >= 0.2;
}

function pitcherTipHtml(mix, acc) {
  const rows = mix.length
    ? mix.map(m => `<div class="mix-row"><span>${esc(name(m.code))}</span><span>${(m.pct * 100).toFixed(1)}%</span></div>`).join("")
    : "<div>No pitch mix data</div>";
  const accText = acc?.total
    ? `${acc.hits}/${acc.total} (${((acc.hits / acc.total) * 100).toFixed(0)}%)`
    : "—";
  return `<div class="tip-h">Season pitch mix</div>${rows}<div class="actual">Model accuracy: ${accText}</div>`;
}

function pitcherName(p) {
  return `<span class="pitcher-name" data-pid="${p.id}">${esc(p.name)}<span class="tip pitcher-tip">Loading…</span></span>`;
}

function headshot(id, alt) {
  const src = `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/${id}/headshot/67/current`;
  return `<img class="headshot" src="${src}" alt="${esc(alt || "")}" width="40" height="40" loading="lazy">`;
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

async function fillPitcherTip(el) {
  const tip = el.querySelector(".pitcher-tip");
  if (!tip) return;
  const id = +el.dataset.pid;
  try {
    const mix = await pitchMix(id, year);
    tip.innerHTML = pitcherTipHtml(mix, byPitcher.get(id));
  } catch (e) {
    tip.innerHTML = `<div>${esc(e.message)}</div>`;
  }
}

function tip(p) {
  const top = (p.ranked || []).slice(0, 3)
    .map(([t, pr], i) => `<div class="${i === 0 && highConf(p.ranked) ? "guess" : ""}">${esc(name(t))} ${(pr * 100).toFixed(1)}%</div>`)
    .join("") || (p.err ? `<div>${esc(p.err)}</div>` : "<div>No prediction</div>");
  return `<div class="tip"><div class="tip-h">Predicted</div>${top}<div class="actual">Actual: ${esc(name(p.type))}</div><div class="outcome">Outcome: ${esc(p.outcome || outcomeName(p.call))}</div></div>`;
}

function pitchLogRow(p) {
  const preds = (p.ranked || []).slice(0, 3)
    .map(([t, pr], i) => {
      const text = `${esc(name(t))} ${(pr * 100).toFixed(1)}%`;
      return i === 0 && highConf(p.ranked) ? `<strong>${text}</strong>` : text;
    })
    .join(", ") || esc(p.err || "—");
  const hit = codeFrom(p.ranked?.[0]?.[0]) === p.type;
  return `<li>
    <span class="dot-wrap"><span class="dot ${p.kind}">${p.n}</span>${tip(p)}</span>
    <div>
      <div class="preds">Predicted: ${preds}</div>
      <div class="actual ${hit ? "match" : "miss"}">Actual: ${esc(name(p.type))}</div>
      <div class="outcome">${esc(p.outcome || outcomeName(p.call))}</div>
    </div>
  </li>`;
}

function cardDetail(item) {
  const v = item.view;
  const st = item.stats;
  const abResult = v.result
    ? `<p class="ab-result">${esc(v.result)}</p>`
    : "";
  const log = v.pitches.length
    ? `<h3 class="section-title">Past pitches</h3><ul class="pitch-log">${v.pitches.map(pitchLogRow).join("")}</ul>`
    : `<p class="empty">No pitches yet</p>`;
  return `<div class="card-detail"><div class="inner">
    <div class="stats">
      <div class="stat-box">
        <div class="lbl">Pitching</div>
        <div class="stat-player">${headshot(v.pitcher.id, v.pitcher.name)}<div><div class="name">${pitcherName(v.pitcher)}</div><div class="nums era">${st ? "ERA " + fmtEra(st.era) : "ERA —"}</div></div></div>
      </div>
      <div class="stat-box">
        <div class="lbl">At bat</div>
        <div class="stat-player">${headshot(v.batter.id, v.batter.name)}<div><div class="name">${esc(v.batter.name)}</div><div class="nums slash">${st ? `${fmtRate(st.avg)} / ${fmtRate(st.obp)} / ${fmtRate(st.slg)}` : "— / — / —"}</div></div></div>
      </div>
    </div>
    ${abResult}
    ${log}
  </div></div>`;
}

function card(item, i) {
  const isExp = expandedPks.has(item.gamePk);
  const v = item.view;
  const dots = v.pitches.map(p =>
    `<span class="dot-wrap"><span class="dot ${p.kind}">${p.n}</span>${tip(p)}</span>`
  ).join("");
  const ranked = (item.ranked || []).slice(0, 5)
    .map(([t, p], j) => `<li class="${j === 0 && highConf(item.ranked) ? "best" : ""}"><span>${esc(name(t))}</span><span>${(p * 100).toFixed(1)}%</span></li>`)
    .join("");
  const pred = v.done
    ? `<p class="empty">Waiting for next batter</p>`
    : item.err
      ? `<p class="err">${esc(item.err)}</p>`
      : `<ul class="pred">${ranked}</ul>`;
  return `<article class="card${isExp ? " expanded ready" : ""}" data-index="${i}" data-pk="${item.gamePk}" tabindex="0">
    <div class="card-body">
      <div class="card-main">
        <div class="pitches">${dots}</div>
        <div>
          <div class="row"><span class="game">${esc(v.game)}</span><span class="inning">${esc(v.inning)}</span></div>
          <div class="matchup">${pitcherName(v.pitcher)} vs ${esc(v.batter.name)}</div>
          ${situationHtml(v)}
          ${pred}
        </div>
      </div>
      ${cardDetail(item)}
    </div>
  </article>`;
}

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const ANIM_MS = 450;
const CLOSE_MS = 180;
const LIST_GAP = 16;
let animating = false;

function beginMotion() {
  animating = true;
}

function endMotion() {
  clearMotionStyles();
  animating = false;
}

function detailOverlay(el) {
  return el?.classList.contains("down-only") ? el.querySelector(".card-detail") : null;
}

function clearPushes() {
  document.querySelectorAll(".card").forEach(c => {
    c.style.top = "";
    c.style.transform = "";
  });
  const list = document.getElementById("list");
  if (list) list.style.paddingBottom = "";
}

function clearMotionStyles() {
  document.querySelectorAll(".card").forEach(c => {
    c.style.transition = "";
    c.style.transform = "";
    c.style.width = "";
    c.style.height = "";
  });
  document.querySelectorAll(".card-detail").forEach(d => {
    d.style.transition = "";
    if (d.style.height === "0px") d.style.height = "";
  });
  const list = document.getElementById("list");
  if (list) list.style.transition = "";
}

function computePushes(excludeEl = null) {
  const cards = [...document.querySelectorAll(".card")];
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
  for (const c of document.querySelectorAll(".card")) {
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
      for (const c of document.querySelectorAll(".card")) {
        const from = fromTops.get(c) || 0;
        const to = toTops.get(c) || 0;
        if (from === to) continue;
        c.style.transition = "";
        c.style.top = from + "px";
      }
      void document.body.offsetHeight;
      for (const c of document.querySelectorAll(".card")) {
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

function fillStats(i) {
  const item = items[i];
  const st = item?.stats;
  const el = document.querySelector(`.card[data-index="${i}"]`);
  if (!el || !st) return;
  const eraEl = el.querySelector(".era");
  const slashEl = el.querySelector(".slash");
  if (eraEl) eraEl.textContent = "ERA " + fmtEra(st.era);
  if (slashEl) slashEl.textContent = `${fmtRate(st.avg)} / ${fmtRate(st.obp)} / ${fmtRate(st.slg)}`;
  el.dataset.contentKey = contentKey(item);
  el.dataset.detailKey = detailKey(item);
  if (el.classList.contains("expanded")) applyPushes();
}

function toggleExpanded(i) {
  const el = document.querySelector(`.card[data-index="${i}"]`);
  const item = items[i];
  if (!el || !item || animating) return;
  const pk = item.gamePk;
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
  loadStats(item).then(() => fillStats(i));
}

function upsertItem(ab) {
  const i = items.findIndex(x => x.gamePk === ab.gamePk);
  if (i >= 0) items[i] = ab;
  else items.push(ab);
}

function removeItem(pk) {
  items = items.filter(x => x.gamePk !== pk);
  expandedPks.delete(pk);
}

function contentKey(item) {
  const pred = item.view.done
    ? "done"
    : item.err
      ? `err:${item.err}`
      : (item.ranked || []).map(([t, p]) => `${t}:${p}`).join(",");
  const pitchPred = item.view.pitches
    .map(p => `${p.n}:${p.type}:${p.ranked?.[0]?.[0] || p.err || ""}`)
    .join(",");
  const st = item.stats
    ? `${item.stats.avg}|${item.stats.obp}|${item.stats.slg}|${item.stats.era}`
    : "";
  return `${item._fp || fingerprint(item)}|${pred}|${pitchPred}|${st}`;
}

function mainKey(item) {
  const v = item.view;
  const pred = v.done
    ? "done"
    : item.err
      ? `err:${item.err}`
      : (item.ranked || []).map(([t, p]) => `${t}:${p}`).join(",");
  return [
    item._fp || fingerprint(item),
    pred,
    v.pitches.map(p => `${p.n}:${p.kind}:${p.type}`).join(","),
  ].join("|");
}

function detailKey(item) {
  const st = item.stats
    ? `${item.stats.avg}|${item.stats.obp}|${item.stats.slg}|${item.stats.era}`
    : "";
  const pitchPred = item.view.pitches
    .map(p => `${p.n}:${p.type}:${p.call}:${p.ranked?.[0]?.[0] || p.err || ""}`)
    .join(",");
  return `${item._fp || fingerprint(item)}|${st}|${pitchPred}|${item.view.result || ""}`;
}

function patchCard(el, item, i) {
  el.dataset.index = i;
  el.dataset.pk = item.gamePk;
  const key = contentKey(item);
  if (el.dataset.contentKey === key) return false;

  const tmp = document.createElement("div");
  tmp.innerHTML = card(item, i);

  const mKey = mainKey(item);
  if (el.dataset.mainKey !== mKey) {
    const cur = el.querySelector(".card-main");
    const next = tmp.querySelector(".card-main");
    if (cur && next) cur.innerHTML = next.innerHTML;
    el.dataset.mainKey = mKey;
  }

  const dKey = detailKey(item);
  if (el.dataset.detailKey !== dKey) {
    const cur = el.querySelector(".card-detail > .inner");
    const next = tmp.querySelector(".card-detail > .inner");
    if (cur && next) cur.innerHTML = next.innerHTML;
    el.dataset.detailKey = dKey;
  }

  el.dataset.contentKey = key;
  return true;
}

function syncList({ onlyPk = null, relayout = false } = {}) {
  const list = document.getElementById("list");
  if (!items.length) {
    if (!list.querySelector(".empty")) {
      list.innerHTML = `<p class="empty">No live at-bats right now.</p>`;
    }
    clearPushes();
    return;
  }
  list.querySelector(".empty")?.remove();

  let structureChanged = false;
  const live = new Set(items.map(x => x.gamePk));
  list.querySelectorAll(".card").forEach(el => {
    if (!live.has(+el.dataset.pk)) {
      expandedPks.delete(+el.dataset.pk);
      el.remove();
      structureChanged = true;
    }
  });

  items.forEach((item, i) => {
    let el = list.querySelector(`[data-pk="${item.gamePk}"]`);
    if (onlyPk != null && item.gamePk !== onlyPk) {
      if (el) el.dataset.index = i;
      return;
    }
    if (el) {
      patchCard(el, item, i);
    } else {
      list.insertAdjacentHTML("beforeend", card(item, i));
      el = list.querySelector(`[data-pk="${item.gamePk}"]`);
      if (el) {
        el.dataset.contentKey = contentKey(item);
        el.dataset.mainKey = mainKey(item);
        el.dataset.detailKey = detailKey(item);
      }
      structureChanged = true;
    }
  });

  if (relayout || structureChanged) applyPushes();
}

function renderList() {
  const list = document.getElementById("list");
  list.innerHTML = items.length
    ? items.map((item, i) => card(item, i)).join("")
    : `<p class="empty">No live at-bats right now.</p>`;
  list.querySelectorAll(".card").forEach(el => {
    const item = items.find(x => x.gamePk === +el.dataset.pk);
    if (!item) return;
    el.dataset.contentKey = contentKey(item);
    el.dataset.mainKey = mainKey(item);
    el.dataset.detailKey = detailKey(item);
  });
  for (const pk of expandedPks) {
    const el = list.querySelector(`[data-pk="${pk}"]`);
    if (!el) continue;
    el.classList.remove("down-only", "ready", "expanded");
    applyLayout(el, true);
    el.classList.add("ready");
  }
  applyPushes();
}

function updateCard(pk, { relayout = false } = {}) {
  if (animating) return;
  if (!document.querySelector(".card")) {
    if (items.length) renderList();
    return;
  }
  syncList({ onlyPk: pk, relayout });
}

function updateMeta(extra = "") {
  const meta = document.getElementById("meta");
  const date = today();
  meta.textContent = `${items.length} live · ${livePks.size} games · ${date} ${new Date().toLocaleTimeString()}${extra ? ` · ${extra}` : ""}`;
}

const SCHED_MS = 45000;
const LIVE_MS = 1500;
const LIVE_MS_HIDDEN = 8000;
const FEED_CONCURRENCY = 3;

const livePks = new Set();
/** @type {Map<number, { timecode: string|null, fails: number, backoffUntil: number, fetching: boolean }>} */
const gameState = new Map();
let schedBusy = false;
let liveBusy = false;
let liveTimer = null;

function liveDelay() {
  return document.hidden ? LIVE_MS_HIDDEN : LIVE_MS;
}

async function mapPool(list, limit, fn) {
  const q = [...list];
  const n = Math.min(limit, q.length) || 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (q.length) await fn(q.shift());
  }));
}

function stateFor(pk) {
  let st = gameState.get(pk);
  if (!st) {
    st = { timecode: null, fails: 0, backoffUntil: 0, fetching: false };
    gameState.set(pk, st);
  }
  return st;
}

async function applyFeed(pk, feed, timecode) {
  const ab = atBat(feed, pk);
  if (!ab) {
    removeItem(pk);
    if (!animating) syncList({ relayout: true });
    return;
  }

  const old = items.find(x => x.gamePk === pk);
  const fp = fingerprint(ab);
  const st = stateFor(pk);
  st.timecode = timecode;

  if (old && old._fp === fp) {
    return;
  }

  const isNew = !old;
  const prevPitches = old?.view?.pitches?.length || 0;
  carryPreds(old, ab);
  ab._fp = fp;
  ab._predKey = predKey(ab);
  upsertItem(ab);

  const needsPred = ab.view.pitches.some(p => !p.ranked)
    || (!ab.view.done && !ab.ranked);

  const paint = () => {
    const grew = ab.view.pitches.length !== prevPitches;
    updateCard(pk, { relayout: isNew || (expandedPks.has(pk) && grew) });
    ingestAccuracy();
    if (expandedPks.has(pk) && !ab.stats) {
      loadStats(ab).then(() => {
        const i = items.findIndex(x => x.gamePk === pk);
        if (i >= 0) fillStats(i);
      });
    }
  };

  if (needsPred) {
    await attachPreds(ab, year);
    if (items.find(x => x.gamePk === pk) !== ab) return;
    paint();
  } else {
    paint();
  }
}

async function pollOneGame(pk) {
  const st = stateFor(pk);
  if (st.fetching || Date.now() < st.backoffUntil) return;

  try {
    const stamps = await get(`${MLB}/v1.1/game/${pk}/feed/live/timestamps`);
    const latest = Array.isArray(stamps) && stamps.length ? stamps[stamps.length - 1] : null;
    if (latest && latest === st.timecode) {
      st.fails = 0;
      return;
    }

    st.fetching = true;
    const feed = await get(`${MLB}/v1.1/game/${pk}/feed/live`);
    const tc = latest || feed.metaData?.timeStamp || feed.metaData?.wait || `t${Date.now()}`;
    await applyFeed(pk, feed, tc);
    st.fails = 0;
  } catch (e) {
    st.fails += 1;
    st.backoffUntil = Date.now() + Math.min(30000, 1000 * (2 ** Math.min(st.fails, 5)));
  } finally {
    st.fetching = false;
  }
}

async function pollLiveGames() {
  if (liveBusy || !livePks.size) return;
  liveBusy = true;
  try {
    await mapPool([...livePks], FEED_CONCURRENCY, pollOneGame);
    updateMeta();
  } finally {
    liveBusy = false;
  }
}

function scheduleLiveLoop() {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(async () => {
    await pollLiveGames();
    scheduleLiveLoop();
  }, liveDelay());
}

async function refreshSchedule() {
  if (schedBusy) return;
  schedBusy = true;
  const meta = document.getElementById("meta");
  try {
    const date = today();
    year = +date.slice(0, 4);
    const sched = await get(`${MLB}/v1/schedule?sportId=1&date=${date}`);
    const games = (sched.dates?.[0]?.games || []).filter(g => g.status?.abstractGameState === "Live");
    const next = new Set(games.map(g => g.gamePk));

    for (const pk of [...livePks]) {
      if (!next.has(pk)) {
        livePks.delete(pk);
        gameState.delete(pk);
        removeItem(pk);
      }
    }
    for (const pk of next) livePks.add(pk);

    expandedPks = new Set([...expandedPks].filter(pk => next.has(pk)));
    updateMeta();
    if (!animating) syncList();
  } catch (e) {
    meta.textContent = `Schedule error · ${esc(e.message)}`;
  } finally {
    schedBusy = false;
  }
}

document.getElementById("list").addEventListener("click", e => {
  if (e.target.closest(".pitcher-name")) {
    e.stopPropagation();
    return;
  }
  const c = e.target.closest(".card");
  if (c) toggleExpanded(+c.dataset.index);
});
document.getElementById("list").addEventListener("mouseover", e => {
  const el = e.target.closest(".pitcher-name");
  if (!el || el.contains(e.relatedTarget)) return;
  fillPitcherTip(el);
});
document.getElementById("list").addEventListener("keydown", e => {
  if (e.key === "Enter") {
    const c = e.target.closest(".card");
    if (c) toggleExpanded(+c.dataset.index);
  }
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && expandedPks.size) {
    const open = document.querySelectorAll(".card.expanded");
    const last = open[open.length - 1];
    if (last) toggleExpanded(+last.dataset.index);
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshSchedule().then(() => pollLiveGames());
    scheduleLiveLoop();
  }
});

refreshSchedule().then(() => {
  pollLiveGames();
  scheduleLiveLoop();
});
setInterval(refreshSchedule, SCHED_MS);

const WIN = 20;
const MAX_POINTS = 48;
const seenPitches = new Set();
const byPitcher = new Map();
const top1 = { outcomes: [], series: [], chart: null };
const top3 = { outcomes: [], series: [], chart: null };
const top50 = { outcomes: [], series: [], chart: null };
let chartMode = "rolling";

function roll(store, hit) {
  store.outcomes.push(hit ? 1 : 0);
  const slice = store.outcomes.slice(-WIN);
  store.series.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  if (store.outcomes.length > 400) store.outcomes.splice(0, store.outcomes.length - 400);
  if (store.series.length > MAX_POINTS) store.series.splice(0, store.series.length - MAX_POINTS);
}

function rollPitcher(id, hit) {
  let s = byPitcher.get(id);
  if (!s) {
    s = { hits: 0, total: 0 };
    byPitcher.set(id, s);
  }
  s.total++;
  if (hit) s.hits++;
}

function totalSeries(store) {
  let hits = 0;
  const all = store.outcomes.map((o, i) => {
    hits += o;
    return hits / (i + 1);
  });
  return all.length > MAX_POINTS ? all.slice(-MAX_POINTS) : all;
}

function activeSeries(store) {
  return chartMode === "total" ? totalSeries(store) : store.series;
}

function redrawCharts() {
  drawChart("acc-chart", "acc-val", top1, "#666", "rgba(0, 0, 0, 0.1)");
  drawChart("acc3-chart", "acc3-val", top3, "#666", "rgba(0, 0, 0, 0.1)");
  drawChart("acc50-chart", "acc50-val", top50, "#666", "rgba(0, 0, 0, 0.1)");
}

function ingestAccuracy() {
  let added = 0;
  for (const item of items) {
    for (const p of item.view.pitches) {
      if (!p.ranked?.length || !p.type) continue;
      const id = `${item.gamePk}:${item.body.at_bat_number}:${p.n}:${p.type}`;
      if (seenPitches.has(id)) continue;
      seenPitches.add(id);
      const correct = codeFrom(p.ranked[0][0]) === p.type;
      roll(top1, correct);
      roll(top3, p.ranked.slice(0, 3).some(([t]) => codeFrom(t) === p.type));
      if (highConf(p.ranked)) {
        roll(top50, correct);
      }
      rollPitcher(item.body.pitcher_id, correct);
      added++;
    }
  }
  if (added) redrawCharts();
}

function drawChart(canvasId, valId, store, stroke, fill) {
  const val = document.getElementById(valId);
  const hits = store.outcomes.reduce((a, b) => a + b, 0);
  if (!store.outcomes.length) {
    val.textContent = "—";
  } else if (chartMode === "rolling") {
    const slice = store.outcomes.slice(-WIN);
    const rh = slice.reduce((a, b) => a + b, 0);
    val.textContent = `${rh}/${slice.length} (${((rh / slice.length) * 100).toFixed(0)}%) · ${hits}/${store.outcomes.length}`;
  } else {
    val.textContent = `${hits}/${store.outcomes.length} (${((hits / store.outcomes.length) * 100).toFixed(0)}%)`;
  }
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === "undefined") return;
  const series = activeSeries(store);
  const labels = series.map((_, i) => String(i + 1));
  const data = series.map(y => Math.round(y * 1000) / 10);
  if (!store.chart) {
    if (Chart.Filler) Chart.register(Chart.Filler);
    store.chart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [{
          data,
          borderColor: stroke,
          backgroundColor: fill,
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
    return;
  }
  store.chart.data.labels = labels;
  store.chart.data.datasets[0].data = data;
  store.chart.data.datasets[0].borderColor = stroke;
  store.chart.data.datasets[0].backgroundColor = fill;
  store.chart.update("none");
}

document.querySelector(".acc-mode")?.addEventListener("click", e => {
  const btn = e.target.closest("[data-mode]");
  if (!btn || btn.dataset.mode === chartMode) return;
  chartMode = btn.dataset.mode;
  document.querySelectorAll(".acc-mode-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.mode === chartMode);
  });
  redrawCharts();
});
