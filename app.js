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
  const awayRuns = ls.teams?.away?.runs || 0;
  const homeRuns = ls.teams?.home?.runs || 0;
  const awayAbbr = feed.gameData?.teams?.away?.abbreviation || "AWY";
  const homeAbbr = feed.gameData?.teams?.home?.abbreviation || "HME";
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
    const pd = p.pitchData || {};
    const c = pd.coordinates || {};
    return {
      n: i + 1,
      kind,
      type: d.type?.code || "",
      call,
      outcome: d.call?.description || outcomeName(call),
      px: Number.isFinite(c.pX) ? c.pX : null,
      pz: Number.isFinite(c.pZ) ? c.pZ : null,
      szTop: Number.isFinite(pd.strikeZoneTop) ? pd.strikeZoneTop : null,
      szBot: Number.isFinite(pd.strikeZoneBottom) ? pd.strikeZoneBottom : null,
      speed: Number.isFinite(pd.startSpeed) ? pd.startSpeed : null,
    };
  });
  const date = feed.gameData?.datetime?.officialDate || today();
  const off = feed.liveData?.linescore?.offense || {};
  const scheduled = ls.scheduledInnings || 9;
  const innings = (ls.innings || []).map(inn => ({
    num: inn.num,
    away: inn.away?.runs ?? null,
    home: inn.home?.runs ?? null,
  }));
  while (innings.length < scheduled) {
    innings.push({ num: innings.length + 1, away: null, home: null });
  }
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
      offense_score: half ? homeRuns : awayRuns,
      defense_score: half ? awayRuns : homeRuns,
      inning: about.inning || ls.currentInning || 1,
      inning_half: half,
      p_throws: mu.pitchHand?.code === "L" ? 1 : 0,
      stand: mu.batSide?.code === "L" ? 1 : 0,
    },
    view: {
      game: `${awayAbbr} ${awayRuns} @ ${homeAbbr} ${homeRuns}`,
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
      batSide: mu.batSide?.code || "R",
    },
    linescore: {
      away: {
        abbr: awayAbbr,
        runs: awayRuns,
        hits: ls.teams?.away?.hits || 0,
        errors: ls.teams?.away?.errors || 0,
      },
      home: {
        abbr: homeAbbr,
        runs: homeRuns,
        hits: ls.teams?.home?.hits || 0,
        errors: ls.teams?.home?.errors || 0,
      },
      innings,
    },
  };
}

const predMemo = new Map();

async function predict(body, yr) {
  const key = `p2:${body.pitcher_id}:${body.batter_id}:${body.at_bat_number}:${body.pitch_number}:${body.pitch_types_so_far.join("-")}:${body.pitch_calls_so_far.join("-")}`;
  if (predMemo.has(key)) return predMemo.get(key);

  const hit = sessionStorage.getItem(key);
  if (hit) {
    const ranked = normalizeRanked(JSON.parse(hit));
    predMemo.set(key, ranked);
    return ranked;
  }

  const job = (async () => {
    const [avg, obp, slg] = await slash(body.batter_id, yr);
    const r = await fetch(`${API}/predict/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, batter_avg: avg, batter_obp: obp, batter_slg: slg }),
    });
    if (!r.ok) throw new Error("predict " + r.status);
    const ranked = normalizeRanked(await r.json());
    try { sessionStorage.setItem(key, JSON.stringify(ranked)); } catch { /* quota */ }
    predMemo.set(key, ranked);
    return ranked;
  })();

  predMemo.set(key, job);
  try {
    return await job;
  } catch (e) {
    predMemo.delete(key);
    throw e;
  }
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
  if (old.winProb) ab.winProb = old.winProb;
  if (old._wpFp) ab._wpFp = old._wpFp;
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

async function loadWinProb(item) {
  if (!item) return null;
  try {
    const series = await get(`${MLB}/v1/game/${item.gamePk}/winProbability`);
    item.winProb = (Array.isArray(series) ? series : [])
      .map(p => ({
        home: p.homeTeamWinProbability,
        away: p.awayTeamWinProbability,
        inning: p.about?.inning,
        half: p.about?.halfInning,
        atBatIndex: p.atBatIndex,
      }))
      .filter(p => Number.isFinite(p.home));
    item._wpFp = item._fp || fingerprint(item);
    return item.winProb;
  } catch {
    return item.winProb || null;
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
          <div class="row">
            <span class="game-line">
              <span class="game">${esc(v.game)}</span>
              <button type="button" class="super-btn" data-super-pk="${item.gamePk}" aria-label="Open full game view" title="Full game view">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M2 5V2h3M9 2h3v3M12 9v3H9M5 12H2V9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </span>
            <span class="inning">${esc(v.inning)}</span>
          </div>
          <div class="matchup">${pitcherName(v.pitcher)} vs ${esc(v.batter.name)}</div>
          ${situationHtml(v)}
          ${pred}
        </div>
      </div>
      ${cardDetail(item)}
    </div>
  </article>`;
}

let superPk = null;
let winProbChart = null;

const DOT_FILL = { ball: "#2e8b3a", strike: "#d32f2f", play: "#1e6fd9", out: "#7b1fa2" };

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
  const half = 17 / 24; // plate half-width (ft)

  // Tight catcher's-view crop — zone dominates, room for balls outside
  let xMin = -1.5, xMax = 1.5;
  let zBot = 0.8, zTop = 4.0;
  for (const p of pitches) {
    xMin = Math.min(xMin, p.px - 0.2);
    xMax = Math.max(xMax, p.px + 0.2);
    zBot = Math.min(zBot, p.pz - 0.15);
    zTop = Math.max(zTop, p.pz + 0.15);
  }
  xMin = Math.min(xMin, -half - 0.35);
  xMax = Math.max(xMax, half + 0.35);
  zBot = Math.max(0.4, Math.min(zBot, szBot - 0.1));
  zTop = Math.max(zTop, szTop + 0.15);

  const W = 260, H = 320;
  // Room for Gameday-style outer shadow ring + gap + plate under the zone
  const padL = 36, padR = 36, padT = 28, padB = 96;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const sx = x => padL + ((x - xMin) / (xMax - xMin)) * innerW;
  const sy = z => padT + ((zTop - z) / (zTop - zBot)) * innerH;

  // Inner 3×3 = actual strike zone (pitch coords map here)
  const L = sx(-half), R = sx(half), T = sy(szTop), B = sy(szBot);
  const zw = R - L, zh = B - T;
  const cx = (L + R) / 2;
  const cellW = zw / 3, cellH = zh / 3;
  // Outer shadow ring ≈ one cell deep (Gameday 5×5 frame around the zone)
  const oL = L - cellW, oR = R + cellW, oT = T - cellH, oB = B + cellH;

  // Plate under the outer frame with a clear knees-to-ground gap; tip down
  const plateGap = Math.max(14, cellH * 0.55);
  const plateTop = oB + plateGap;
  const pFlat = plateTop + Math.max(9, zh * 0.09);
  const pTip = plateTop + Math.max(32, zh * 0.36);

  const stroke = "#111";
  const shadow = "#bbb";
  // Outer ring: light wireframe only (shadow / chase zone)
  const shadowGrid = [
    ...[oL, L, R, oR].map(x =>
      `<line x1="${x.toFixed(1)}" y1="${oT.toFixed(1)}" x2="${x.toFixed(1)}" y2="${oB.toFixed(1)}" stroke="${shadow}" stroke-width="1"/>`),
    ...[oT, T, B, oB].map(y =>
      `<line x1="${oL.toFixed(1)}" y1="${y.toFixed(1)}" x2="${oR.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${shadow}" stroke-width="1"/>`),
  ].join("");
  // Inner 3×3 only inside the real strike zone
  const zoneGrid = [1, 2].map(i => {
    const gx = L + cellW * i, gy = T + cellH * i;
    return `<line x1="${gx.toFixed(1)}" y1="${T.toFixed(1)}" x2="${gx.toFixed(1)}" y2="${B.toFixed(1)}" stroke="#ccc" stroke-width="1"/>
      <line x1="${L.toFixed(1)}" y1="${gy.toFixed(1)}" x2="${R.toFixed(1)}" y2="${gy.toFixed(1)}" stroke="#ccc" stroke-width="1"/>`;
  }).join("");

  const dots = pitches.map(p => {
    const fill = DOT_FILL[p.kind] || "#555";
    const x = sx(p.px), y = sy(p.pz);
    return `<g>
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" fill="${fill}" stroke="#fff" stroke-width="2"/>
      <text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" fill="#fff" font-size="11" font-weight="800" font-family="system-ui,sans-serif">${p.n}</text>
    </g>`;
  }).join("");

  return `<div class="super-panel pitch-panel">
    <h3 class="section-title">Pitch view</h3>
    <svg class="pitch-zone" viewBox="0 0 ${W} ${H}" role="img" aria-label="Catcher's view pitch locations">
      <rect x="${oL.toFixed(1)}" y="${oT.toFixed(1)}" width="${(oR - oL).toFixed(1)}" height="${(oB - oT).toFixed(1)}"
        fill="#f7f7f7" stroke="${shadow}" stroke-width="1"/>
      ${shadowGrid}
      <rect x="${L.toFixed(1)}" y="${T.toFixed(1)}" width="${zw.toFixed(1)}" height="${zh.toFixed(1)}"
        fill="#fff" stroke="${stroke}" stroke-width="2.25"/>
      ${zoneGrid}
      <path d="M${L.toFixed(1)} ${plateTop.toFixed(1)}
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
  const pct = last ? `${Math.round(last.home)}%` : "—";
  return `<div class="super-panel">
    <div class="acc-head">
      <h3 class="section-title super-wp-title">${esc(home)} win prob</h3>
      <span class="acc-val super-wp-val">${pct}</span>
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
  if (!winProbChart) {
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
    return;
  }
  winProbChart.data.labels = labels;
  winProbChart.data.datasets[0].data = data;
  winProbChart.update("none");
}

function superPredHtml(item) {
  const v = item.view;
  if (v.done) return `<p class="empty">Waiting for next batter</p>`;
  if (item.err) return `<p class="err">${esc(item.err)}</p>`;
  const ranked = (item.ranked || []).slice(0, 5)
    .map(([t, p], j) => `<li class="${j === 0 && highConf(item.ranked) ? "best" : ""}"><span>${esc(name(t))}</span><span>${(p * 100).toFixed(1)}%</span></li>`)
    .join("");
  return `<ul class="pred">${ranked}</ul>`;
}

function superDetailInner(item) {
  const v = item.view;
  const st = item.stats;
  const abResult = v.result
    ? `<p class="ab-result">${esc(v.result)}</p>`
    : "";
  const log = v.pitches.length
    ? `<h3 class="section-title">Past pitches</h3><ul class="pitch-log">${v.pitches.map(pitchLogRow).join("")}</ul>`
    : `<p class="empty">No pitches yet</p>`;
  return `
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
    ${log}`;
}

function renderSuper() {
  const root = document.getElementById("super-modal");
  if (!root || superPk == null) return;
  const item = items.find(x => x.gamePk === superPk);
  if (!item) {
    closeSuper();
    return;
  }
  const v = item.view;
  const panel = root.querySelector(".super-panel-root");
  if (!panel) return;
  if (winProbChart) {
    winProbChart.destroy();
    winProbChart = null;
  }
  panel.innerHTML = `
    <header class="super-head">
      <div class="row">
        <span class="game">${esc(v.game)}</span>
        <span class="inning">${esc(v.inning)}</span>
      </div>
      <button type="button" class="super-close" aria-label="Close full game view">×</button>
    </header>
    <div class="super-layout">
      <div class="super-main">
        <div class="card-main">
          <div class="pitches">${(v.pitches || []).map(p =>
            `<span class="dot-wrap"><span class="dot ${p.kind}">${p.n}</span>${tip(p)}</span>`
          ).join("")}</div>
          <div>
            <div class="matchup">${pitcherName(v.pitcher)} vs ${esc(v.batter.name)}</div>
            ${situationHtml(v)}
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
  const item = items.find(x => x.gamePk === pk);
  if (!item) return;
  loadStats(item).then(() => {
    if (superPk === pk) renderSuper();
  });
  loadWinProb(item).then(() => {
    if (superPk === pk) renderSuper();
  });
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

function refreshSuper(pk) {
  if (superPk !== pk) return;
  renderSuper();
  const item = items.find(x => x.gamePk === pk);
  if (!item) return;
  if (item._wpFp !== (item._fp || fingerprint(item))) {
    loadWinProb(item).then(() => {
      if (superPk === pk) renderSuper();
    });
  }
}

const OPEN_MS = 450;
const CLOSE_MS = 180;
let animating = false;

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
}

async function toggleExpanded(i) {
  const el = document.querySelector(`.card[data-index="${i}"]`);
  const item = items[i];
  if (!el || !item || animating) return;
  const pk = item.gamePk;
  const opening = !expandedPks.has(pk);

  if (!opening) {
    await animateCollapse(el);
    expandedPks.delete(pk);
    return;
  }

  expandedPks.add(pk);
  const expand = animateExpand(el);
  loadStats(item).then(() => fillStats(i));
  await expand;
}

function upsertItem(ab) {
  const i = items.findIndex(x => x.gamePk === ab.gamePk);
  if (i >= 0) items[i] = ab;
  else items.push(ab);
}

function removeItem(pk) {
  items = items.filter(x => x.gamePk !== pk);
  expandedPks.delete(pk);
  if (superPk === pk) closeSuper();
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

function syncList({ onlyPk = null } = {}) {
  const list = document.getElementById("list");
  if (!items.length) {
    list.innerHTML = `<p class="empty">No live at-bats right now.</p>`;
    return;
  }
  list.querySelector(".empty")?.remove();

  const live = new Set(items.map(x => x.gamePk));
  list.querySelectorAll(".card").forEach(el => {
    if (!live.has(+el.dataset.pk)) {
      const pk = +el.dataset.pk;
      expandedPks.delete(pk);
      if (superPk === pk) closeSuper();
      el.remove();
    }
  });

  const created = new Map();
  items.forEach((item, i) => {
    let el = list.querySelector(`[data-pk="${item.gamePk}"]`);
    if (el) {
      if (onlyPk == null || item.gamePk === onlyPk) patchCard(el, item, i);
      else el.dataset.index = i;
      return;
    }
    if (onlyPk != null && item.gamePk !== onlyPk) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = card(item, i);
    el = wrap.firstElementChild;
    el.dataset.contentKey = contentKey(item);
    el.dataset.mainKey = mainKey(item);
    el.dataset.detailKey = detailKey(item);
    if (expandedPks.has(item.gamePk)) {
      applyLayout(el, true);
      el.classList.add("ready");
    }
    created.set(item.gamePk, el);
  });

  const final = items.map((item, i) => {
    const el = list.querySelector(`[data-pk="${item.gamePk}"]`) || created.get(item.gamePk);
    if (el) el.dataset.index = i;
    return el;
  }).filter(Boolean);

  CardColumns.packCards(list, final);
}

function renderList() {
  const list = document.getElementById("list");
  if (!items.length) {
    list.innerHTML = `<p class="empty">No live at-bats right now.</p>`;
    return;
  }
  const cards = items.map((item, i) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = card(item, i);
    const el = wrap.firstElementChild;
    el.dataset.contentKey = contentKey(item);
    el.dataset.mainKey = mainKey(item);
    el.dataset.detailKey = detailKey(item);
    if (expandedPks.has(item.gamePk)) {
      applyLayout(el, true);
      el.classList.add("ready");
    }
    return el;
  });
  list.innerHTML = "";
  CardColumns.packCards(list, cards);
}

function updateCard(pk) {
  if (animating) return;
  if (!document.querySelector(".card")) {
    if (items.length) renderList();
    return;
  }
  syncList({ onlyPk: pk });
}

function updateMeta(extra = "") {
  const meta = document.getElementById("meta");
  const date = today();
  meta.textContent = `${items.length} live · ${livePks.size} games · ${date} ${new Date().toLocaleTimeString()}${extra ? ` · ${extra}` : ""}`;
}

const SCHED_MS = 30000;
const POLL_ACTIVE_MS = 100;
const POLL_IDLE_MS = 500;
const POLL_BREAK_MS = 800;
const POLL_HIDDEN_MS = 2000;
const POLL_WS_FALLBACK_MS = 3000;
const MAX_IN_FLIGHT_PER_GAME = 2;

const WS_HOST = "ws.statsapi.mlb.com";
const WS_KEEPALIVE = "Gameday5";
const WS_KEEPALIVE_MS = 8000;
const WS_RECONNECT_MS = 2500;
const WS_MAX_BACKOFF_MS = 30000;

const livePks = new Set();
/** @type {Map<number, object>} */
const gameState = new Map();
let schedBusy = false;

function stateFor(pk) {
  let st = gameState.get(pk);
  if (!st) {
    st = {
      timecode: null,
      fails: 0,
      backoffUntil: 0,
      inFlight: 0,
      predGen: 0,
      activeAb: true,
      inningBreak: false,
      ws: null,
      wsConnected: false,
      wsClosed: true,
      wsAttempt: 0,
      wsKeepalive: null,
      wsReconnect: null,
      wsDebounce: null,
      pollTimer: null,
    };
    gameState.set(pk, st);
  }
  return st;
}

function noteFeedActivity(pk, feed) {
  const st = stateFor(pk);
  const play = feed?.liveData?.plays?.currentPlay;
  const inningState = (feed?.liveData?.linescore?.inningState || "").toLowerCase();
  const complete = play?.about?.isComplete === true;
  const hasResult = Boolean(play?.result?.event?.trim());
  const hasBatter = Boolean(play?.matchup?.batter?.id);
  st.activeAb = !complete && !hasResult && hasBatter;
  st.inningBreak = /^(middle|end)$/.test(inningState) && !st.activeAb;
}

function pollDelayMs(st) {
  if (document.hidden) return POLL_HIDDEN_MS;
  if (st.wsConnected) return POLL_WS_FALLBACK_MS;
  if (st.inningBreak) return POLL_BREAK_MS;
  if (st.activeAb) return POLL_ACTIVE_MS;
  return POLL_IDLE_MS;
}

async function applyFeed(pk, feed, timecode) {
  noteFeedActivity(pk, feed);
  const ab = atBat(feed, pk);
  if (!ab) {
    removeItem(pk);
    if (!animating) syncList();
    return;
  }

  const old = items.find(x => x.gamePk === pk);
  const fp = fingerprint(ab);
  const st = stateFor(pk);
  st.timecode = timecode;

  if (old && old._fp === fp) return;

  carryPreds(old, ab);
  ab._fp = fp;
  ab._predKey = predKey(ab);
  upsertItem(ab);

  const paint = () => {
    if (animating) return;
    updateCard(pk);
    ingestAccuracy();
    if (superPk === pk) refreshSuper(pk);
    if (expandedPks.has(pk) && !ab.stats) {
      loadStats(ab).then(() => {
        const i = items.findIndex(x => x.gamePk === pk);
        if (i >= 0) fillStats(i);
        if (superPk === pk) renderSuper();
      });
    }
  };

  // Paint immediately — never block the live path on /predict/
  paint();
  // Warm batter slash line for the next predict round-trip
  slash(ab.body.batter_id, year).catch(() => {});

  const needsPred = ab.view.pitches.some(p => !p.ranked)
    || (!ab.view.done && !ab.ranked);
  if (!needsPred) return;

  const gen = (st.predGen = (st.predGen || 0) + 1);
  attachPreds(ab, year).then(() => {
    if (st.predGen !== gen) return;
    if (items.find(x => x.gamePk === pk) !== ab) return;
    paint();
  });
}

async function pollOneGame(pk, { force = false } = {}) {
  const st = stateFor(pk);
  if (!livePks.has(pk)) return;
  if (st.inFlight >= MAX_IN_FLIGHT_PER_GAME) return;
  if (!force && Date.now() < st.backoffUntil) return;

  st.inFlight += 1;
  try {
    let latest = null;
    if (!force) {
      try {
        const stamps = await get(`${MLB}/v1.1/game/${pk}/feed/live/timestamps`);
        latest = Array.isArray(stamps) && stamps.length ? stamps[stamps.length - 1] : null;
        if (latest && latest === st.timecode) {
          st.fails = 0;
          return;
        }
      } catch {
        /* fall through to full feed */
      }
    }

    const feed = await get(`${MLB}/v1.1/game/${pk}/feed/live`);
    const tc = latest || feed.metaData?.timeStamp || feed.metaData?.wait || `t${Date.now()}`;
    if (!force && st.timecode && tc === st.timecode) {
      noteFeedActivity(pk, feed);
      st.fails = 0;
      return;
    }
    await applyFeed(pk, feed, tc);
    st.fails = 0;
    updateMeta();
  } catch (e) {
    st.fails += 1;
    st.backoffUntil = Date.now() + Math.min(30000, 1000 * (2 ** Math.min(st.fails, 5)));
  } finally {
    st.inFlight = Math.max(0, st.inFlight - 1);
  }
}

function clearWsTimers(st) {
  if (st.wsKeepalive) { clearInterval(st.wsKeepalive); st.wsKeepalive = null; }
  if (st.wsReconnect) { clearTimeout(st.wsReconnect); st.wsReconnect = null; }
  if (st.wsDebounce) { clearTimeout(st.wsDebounce); st.wsDebounce = null; }
}

function scheduleWsReconnect(pk) {
  const st = stateFor(pk);
  if (st.wsClosed || st.wsReconnect) return;
  const delay = Math.min(WS_RECONNECT_MS * (1.6 ** st.wsAttempt), WS_MAX_BACKOFF_MS);
  st.wsAttempt += 1;
  st.wsReconnect = setTimeout(() => {
    st.wsReconnect = null;
    subscribeGameday(pk);
  }, delay);
}

function subscribeGameday(pk) {
  const st = stateFor(pk);
  if (st.ws && (st.ws.readyState === WebSocket.OPEN || st.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  st.wsClosed = false;

  let ws;
  try {
    ws = new WebSocket(`wss://${WS_HOST}/api/v1/game/push/subscribe/gameday/${pk}`);
  } catch {
    scheduleWsReconnect(pk);
    return;
  }
  st.ws = ws;

  ws.onopen = () => {
    if (st.wsClosed) return;
    st.wsConnected = true;
    st.wsAttempt = 0;
    try { ws.send(WS_KEEPALIVE); } catch { /* ignore */ }
    st.wsKeepalive = setInterval(() => {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(WS_KEEPALIVE);
      } catch { /* ignore */ }
    }, WS_KEEPALIVE_MS);
    scheduleGamePoll(pk);
  };

  ws.onmessage = () => {
    if (st.wsClosed) return;
    if (st.wsDebounce) clearTimeout(st.wsDebounce);
    st.wsDebounce = setTimeout(() => {
      st.wsDebounce = null;
      pollOneGame(pk, { force: true });
    }, 80);
  };

  ws.onerror = () => { /* onclose reconnects */ };

  ws.onclose = () => {
    clearWsTimers(st);
    st.ws = null;
    st.wsConnected = false;
    if (st.wsClosed || !livePks.has(pk)) return;
    scheduleWsReconnect(pk);
    scheduleGamePoll(pk);
  };
}

function unsubscribeGameday(pk) {
  const st = gameState.get(pk);
  if (!st) return;
  st.wsClosed = true;
  st.wsConnected = false;
  clearWsTimers(st);
  try { st.ws?.close(); } catch { /* ignore */ }
  st.ws = null;
}

function scheduleGamePoll(pk) {
  const st = stateFor(pk);
  if (st.pollTimer) clearTimeout(st.pollTimer);
  if (!livePks.has(pk)) return;

  st.pollTimer = setTimeout(async () => {
    st.pollTimer = null;
    if (!livePks.has(pk)) return;
    await pollOneGame(pk);
    scheduleGamePoll(pk);
  }, pollDelayMs(st));
}

function startGame(pk) {
  livePks.add(pk);
  stateFor(pk);
  subscribeGameday(pk);
  scheduleGamePoll(pk);
  pollOneGame(pk, { force: true });
}

function stopGame(pk) {
  livePks.delete(pk);
  const st = gameState.get(pk);
  if (st?.pollTimer) clearTimeout(st.pollTimer);
  unsubscribeGameday(pk);
  gameState.delete(pk);
  removeItem(pk);
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
      if (!next.has(pk)) stopGame(pk);
    }
    for (const pk of next) {
      if (!livePks.has(pk)) startGame(pk);
    }

    expandedPks = new Set([...expandedPks].filter(pk => next.has(pk)));
    updateMeta();
    if (!animating) syncList();
  } catch (e) {
    meta.textContent = `Schedule error · ${esc(e.message)}`;
  } finally {
    schedBusy = false;
  }
}

CardColumns.observeColumns(document.getElementById("list"));
document.getElementById("list").addEventListener("click", e => {
  const superBtn = e.target.closest(".super-btn");
  if (superBtn) {
    e.stopPropagation();
    e.preventDefault();
    openSuper(+superBtn.dataset.superPk);
    return;
  }
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
    if (e.target.closest(".super-btn")) return;
    const c = e.target.closest(".card");
    if (c) toggleExpanded(+c.dataset.index);
  }
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (superPk != null) {
    closeSuper();
    return;
  }
  if (expandedPks.size) {
    const open = document.querySelectorAll(".card.expanded");
    const last = open[open.length - 1];
    if (last) toggleExpanded(+last.dataset.index);
  }
});

const superModal = document.getElementById("super-modal");
superModal?.addEventListener("click", e => {
  if (e.target === superModal || e.target.classList.contains("super-backdrop")) {
    closeSuper();
    return;
  }
  if (e.target.closest(".super-close")) {
    closeSuper();
    return;
  }
  if (e.target.closest(".pitcher-name")) e.stopPropagation();
});
superModal?.addEventListener("mouseover", e => {
  const el = e.target.closest(".pitcher-name");
  if (!el || el.contains(e.relatedTarget)) return;
  fillPitcherTip(el);
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  refreshSchedule();
  for (const pk of livePks) {
    pollOneGame(pk, { force: true });
    scheduleGamePoll(pk);
  }
});
window.addEventListener("focus", () => {
  for (const pk of livePks) pollOneGame(pk, { force: true });
});

refreshSchedule();
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
