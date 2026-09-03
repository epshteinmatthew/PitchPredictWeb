const MLB = "https://statsapi.mlb.com/api";
const params = new URLSearchParams(location.search);
const API = params.get("api")
  || "https://pitchpredict-910442.tail42c403.ts.net";

const TYPE = {SI:0,CH:1,FF:2,ST:3,FC:4,FS:5,SL:6,CU:7,SV:8,KC:9,FO:10,PO:11,FA:12,UN:13,CS:14,EP:15,KN:16,SC:17};
const TYPE_ALIAS = {FT:"SI", SF:"FS"};
const TYPE_CODE = Object.fromEntries(Object.entries(TYPE).map(([k, v]) => [v, k]));
const typeIndex = code => TYPE[TYPE_ALIAS[code] || code] ?? TYPE.UN;
const CALL = {
  called_strike:0,ball:1,swinging_strike:2,blocked_ball:3,foul:4,foul_bunt:5,foul_tip:6,
  automatic_ball:7,swinging_strike_blocked:8,automatic_strike:9,pitchout:10,missed_bunt:11,
  bunt_foul_tip:12,hit_into_play:13,hit_by_pitch:14,swinging_pitchout:15,
};
const CODE = {
  B:"ball","*":"blocked_ball",C:"called_strike",S:"swinging_strike",W:"swinging_strike_blocked",
  T:"foul_tip",F:"foul",L:"foul_bunt",M:"missed_bunt",O:"bunt_foul_tip",P:"pitchout",
  Q:"swinging_pitchout",X:"hit_into_play",D:"hit_into_play",E:"hit_into_play",H:"hit_by_pitch",
  V:"automatic_ball",A:"automatic_strike",
};
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

const LOOKBACK_DAYS = 10;
const MAX_GAME_TRIES = 12;
const DAILY_PITCHES = 10;
const DAILY_TZ = "America/Los_Angeles";

const isDailyMode = params.get("mode") !== "free";

const codeFrom = t => TYPE_CODE[t] ?? TYPE_CODE[+t] ?? t;
const normCode = c => TYPE_ALIAS[c] || c || "";
const name = c => NAME[normCode(c)] || NAME[codeFrom(c)] || normCode(c) || c;
const outcomeName = c => OUTCOME[c] || c;
const normalizeRanked = ranked => (ranked || [])
  .map(([t, p]) => [codeFrom(t), p])
  .filter(([t]) => t !== "UN");

const pad = n => String(n).padStart(2, "0");
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const num = x => parseFloat(x) || 0;
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const get = url => fetch(url).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
const fmtRate = n => (n || n === 0) ? (n < 1 ? n.toFixed(3).slice(1) : n.toFixed(3)) : "—";
const fmtEra = n => (n || n === 0) ? num(n).toFixed(2) : "—";
const pct = (n, d) => d ? `${((n / d) * 100).toFixed(0)}%` : "—";
const shuffle = arr => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function dailyKey(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DAILY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dailyStorageKey(key = dailyKey()) {
  return `pitch-daily:${key}`;
}

function loadDailyProgress(key = dailyKey()) {
  try {
    const raw = localStorage.getItem(dailyStorageKey(key));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveDailyProgress(data) {
  try {
    localStorage.setItem(dailyStorageKey(data.date), JSON.stringify(data));
  } catch { /* quota */ }
}

function dailyProgressSnapshot(done = false) {
  return {
    date: source.dateKey || dailyKey(),
    done,
    pitchNum: pitchMarks.length,
    marks: pitchMarks.slice(),
    you: { hits: score.you.hits, total: score.you.total },
    model: { hits: score.model.hits, total: score.model.total },
  };
}

function persistDailyProgress(done = false) {
  if (!isDailyMode) return;
  const data = dailyProgressSnapshot(done);
  saveDailyProgress(data);
  dailySaved = data;
}

function restoreDailyProgress(saved) {
  if (!saved) return;
  pitchMarks = (saved.marks || []).slice();
  score.you = { hits: saved.you?.hits ?? 0, total: saved.you?.total ?? 0 };
  score.model = { hits: saved.model?.hits ?? 0, total: saved.model?.total ?? 0 };
  dailyPitchNum = saved.pitchNum ?? pitchMarks.length;
  if (DailySource) DailySource.cursor = dailyPitchNum;
  dailySaved = saved;
}

function shareText(result) {
  const marks = (result.marks || []).map(h => (h ? "🟩" : "🟥")).join("");
  const you = result.you || { hits: 0, total: 0 };
  const model = result.model || { hits: 0, total: 0 };
  const beat = you.hits > model.hits
    ? "Beat the model ✓"
    : you.hits === model.hits
      ? "Tied the model"
      : "Model won";
  return [
    `Pitch Predict Daily ${result.date}`,
    marks || "—",
    `You ${you.hits}/${you.total} · Model ${model.hits}/${model.total}`,
    beat,
  ].join("\n");
}

async function loadFinalGames(lookback = LOOKBACK_DAYS) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - lookback);
  const sched = await get(
    `${MLB}/v1/schedule?sportId=1&startDate=${isoDate(start)}&endDate=${isoDate(end)}`
  );
  const games = [];
  for (const day of sched.dates || []) {
    for (const g of day.games || []) {
      if (g.status?.abstractGameState !== "Final") continue;
      if (!g.gamePk) continue;
      games.push({
        gamePk: g.gamePk,
        date: g.officialDate || day.date,
      });
    }
  }
  return games;
}

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

async function slash(id, yr) {
  const key = `slash:${id}:${yr}`;
  const hit = sessionStorage.getItem(key);
  if (hit) return JSON.parse(hit);
  const load = async y => {
    const j = await get(`${MLB}/v1/people/${id}/stats?stats=season&group=hitting&season=${y}`);
    const splits = j.stats?.[0]?.splits || [];
    const combined = splits.find(s => s.numTeams) || splits.find(s => !s.team) || splits[0];
    return combined?.stat || {};
  };
  let st = await load(yr);
  if (num(st.plateAppearances) < 100) {
    const prev = await load(yr - 1);
    if (num(prev.plateAppearances) > num(st.plateAppearances)) st = prev;
  }
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

const PROFILE_GAMES = 6;
const MIN_COUNT_N = 10;
const MIN_HAND_N = 20;
const MIN_BATTER_N = 8;

function emptyBucket() {
  return { total: 0, counts: {} };
}

function addToBucket(bucket, code) {
  if (!code || code === "UN") return;
  bucket.total += 1;
  bucket.counts[code] = (bucket.counts[code] || 0) + 1;
}

function bucketShare(bucket, code) {
  if (!bucket?.total) return null;
  return (bucket.counts[code] || 0) / bucket.total;
}

async function pitcherGameLog(id, yr, n) {
  const j = await get(`${MLB}/v1/people/${id}/stats?stats=gameLog&group=pitching&season=${yr}`);
  return (j.stats?.[0]?.splits || [])
    .map(s => ({ date: s.date, gamePk: s.game?.gamePk }))
    .filter(g => g.gamePk)
    .slice(0, n);
}

function ingestPlayIntoProfile(profile, play, pitcherId) {
  if (play.matchup?.pitcher?.id !== pitcherId) return;
  const events = (play.playEvents || []).filter(e => e.isPitch);
  if (!events.length) return;
  const stand = play.matchup?.batSide?.code === "L" ? "L" : "R";
  const batterId = play.matchup?.batter?.id;
  if (!profile.byHand[stand]) profile.byHand[stand] = emptyBucket();
  if (batterId && !profile.byBatter[batterId]) profile.byBatter[batterId] = emptyBucket();

  for (let i = 0; i < events.length; i++) {
    const type = normCode(events[i].details?.type?.code || "");
    if (!type || type === "UN") continue;
    const cnt = countBefore(events, i);
    const countKey = `${cnt.balls}-${cnt.strikes}`;
    if (!profile.byCount[countKey]) profile.byCount[countKey] = emptyBucket();
    addToBucket(profile.byCount[countKey], type);
    addToBucket(profile.byHand[stand], type);
    if (batterId) addToBucket(profile.byBatter[batterId], type);
  }
}

async function pitcherProfile(id, yr, excludeGamePk) {
  const key = `pprof:${id}:${yr}:${excludeGamePk || 0}`;
  const hit = sessionStorage.getItem(key);
  if (hit) return JSON.parse(hit);

  let games = await pitcherGameLog(id, yr, PROFILE_GAMES + 3);
  let usedYear = yr;
  if (!games.length) {
    games = await pitcherGameLog(id, yr - 1, PROFILE_GAMES + 3);
    usedYear = yr - 1;
  }
  games = games.filter(g => g.gamePk !== excludeGamePk).slice(0, PROFILE_GAMES);

  const profile = { byCount: {}, byHand: { L: emptyBucket(), R: emptyBucket() }, byBatter: {}, games: 0, year: usedYear };
  const feeds = await Promise.all(games.map(g => get(`${MLB}/v1.1/game/${g.gamePk}/feed/live`).catch(() => null)));
  for (const feed of feeds) {
    if (!feed) continue;
    profile.games += 1;
    for (const play of feed.liveData?.plays?.allPlays || []) {
      ingestPlayIntoProfile(profile, play, id);
    }
  }

  try { sessionStorage.setItem(key, JSON.stringify(profile)); } catch { /* quota */ }
  return profile;
}

function contextMix(profile, { count, stand, batterId, batterName }) {
  if (!profile) return null;
  const countBucket = profile.byCount?.[count];
  const vsBatter = batterId ? profile.byBatter?.[batterId] : null;
  const useBatter = vsBatter && vsBatter.total >= MIN_BATTER_N;
  const handBucket = profile.byHand?.[stand === "L" ? "L" : "R"];
  const last = (batterName || "").trim().split(/\s+/).pop() || "batter";
  return {
    countLabel: `on ${count}`,
    countBucket: countBucket?.total >= MIN_COUNT_N ? countBucket : null,
    countN: countBucket?.total || 0,
    vsLabel: useBatter ? `vs ${last}` : (stand === "L" ? "vs LHH" : "vs RHH"),
    vsBucket: useBatter
      ? vsBatter
      : (handBucket?.total >= MIN_HAND_N ? handBucket : (handBucket?.total ? handBucket : null)),
    vsN: useBatter ? vsBatter.total : (handBucket?.total || 0),
    games: profile.games || 0,
  };
}

const predMemo = new Map();

async function predict(body, yr) {
  const key = `gp:${body.pitcher_id}:${body.batter_id}:${body.at_bat_number}:${body.pitch_number}:${body.pitch_types_so_far.join("-")}:${body.pitch_calls_so_far.join("-")}`;
  if (predMemo.has(key)) return predMemo.get(key);
  const hit = sessionStorage.getItem(key);
  if (hit) {
    const ranked = normalizeRanked(JSON.parse(hit));
    predMemo.set(key, ranked);
    return ranked;
  }
  const job = (async () => {
    const [avg, obp, slg] = await slash(body.batter_id, yr);
    const r = await fetch(`${API.replace(/\/$/, "")}/predict/`, {
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

function headshot(id, alt) {
  const src = `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/${id}/headshot/67/current`;
  return `<img class="headshot" src="${src}" alt="${esc(alt || "")}" width="40" height="40" loading="lazy">`;
}

function situationHtml(v) {
  const [balls, strikes] = String(v.count || "0-0").split("-");
  const outs = Math.max(0, Math.min(3, +v.outs || 0));
  const base = (on, cls, label) =>
    `<span class="base ${cls}${on ? " on" : ""}" title="${label}"></span>`;
  const outDots = [0, 1, 2].map(i =>
    `<span class="out-dot${i < outs ? " on" : ""}"></span>`
  ).join("");
  return `<div class="situation" aria-label="${esc(balls)} and ${esc(strikes)}, ${outs} out${outs === 1 ? "" : "s"}">
    <div class="diamond" aria-hidden="true">
      <svg class="diamond-outline" viewBox="0 0 100 100">
        <path d="M50 88 L12 50 L50 12 L88 50 Z" fill="none" stroke="currentColor" stroke-width="1.5"/>
      </svg>
      ${base(v.on_2b, "b2", "2B")}
      ${base(v.on_3b, "b3", "3B")}
      ${base(v.on_1b, "b1", "1B")}
    </div>
    <div class="sit-count">${esc(balls)}-${esc(strikes)}</div>
    <div class="outs">${outDots}</div>
  </div>`;
}

function outsBefore(events, i) {
  if (!events.length) return 0;
  if (i === 0) {
    const c = events[0].count?.outs ?? 0;
    return events[0].details?.isOut ? Math.max(0, c - 1) : c;
  }
  return events[i - 1].count?.outs ?? 0;
}

function countBefore(events, i) {
  if (i === 0) return { balls: 0, strikes: 0 };
  const c = events[i - 1].count || {};
  return { balls: c.balls ?? 0, strikes: c.strikes ?? 0 };
}

function basesAtStart(play) {
  const on = { on_1b: 0, on_2b: 0, on_3b: 0 };
  for (const r of play.runners || []) {
    const start = r.movement?.start;
    if (start === "1B") on.on_1b = 1;
    if (start === "2B") on.on_2b = 1;
    if (start === "3B") on.on_3b = 1;
  }
  return on;
}

function pitchKind(call, details, code) {
  let kind = KIND[call] || "ball";
  if (call === "hit_into_play" && (details?.isOut || code === "X")) kind = "out";
  return kind;
}

function sliceDailyAb(ab, pitchIndex) {
  const pitch = ab.pitches[pitchIndex];
  if (!pitch) return null;
  return {
    ...ab,
    id: `${ab.id}:${pitchIndex}`,
    priorPitches: ab.pitches.slice(0, pitchIndex),
    pitchTotal: ab.pitches.length,
    pitches: [{ ...pitch, n: pitchIndex + 1 }],
  };
}

function pitchesThrownSoFar(ab, pitchIndex, includeCurrent = false) {
  const prior = ab.priorPitches ?? ab.pitches.slice(0, pitchIndex);
  if (!includeCurrent) return prior;
  const cur = ab.pitches[pitchIndex];
  return cur ? [...prior, cur] : prior;
}

function pitchTipHtml(p) {
  return `<div class="tip"><div class="tip-h">${esc(name(p.type))}</div><div class="outcome">${esc(p.outcome || outcomeName(p.call))}</div></div>`;
}

function pastPitchLogRow(p) {
  return `<li>
    <span class="dot-wrap"><span class="dot ${p.kind}">${p.n}</span>${pitchTipHtml(p)}</span>
    <div>
      <div class="actual">${esc(name(p.type))}</div>
      <div class="outcome">${esc(p.outcome || outcomeName(p.call))}</div>
    </div>
  </li>`;
}

function pastPitchLogHtml(ab, pitchIndex, includeCurrent) {
  const thrown = pitchesThrownSoFar(ab, pitchIndex, includeCurrent);
  if (!thrown.length) return "";
  return `<h3 class="section-title">Past pitches</h3><ul class="pitch-log">${thrown.map(pastPitchLogRow).join("")}</ul>`;
}

function atBatsFromFeed(feed, gamePk, gameDate, mode = "historical") {
  const teams = feed.gameData?.teams || {};
  const awayAbbr = teams.away?.abbreviation || "AWY";
  const homeAbbr = teams.home?.abbreviation || "HME";
  const out = [];
  let awayScore = 0;
  let homeScore = 0;

  for (const play of feed.liveData?.plays?.allPlays || []) {
    const about = play.about || {};
    const mu = play.matchup || {};
    const res = play.result || {};
    const events = (play.playEvents || []).filter(e => e.isPitch);
    const startAway = awayScore;
    const startHome = homeScore;
    awayScore = res.awayScore ?? awayScore;
    homeScore = res.homeScore ?? homeScore;

    if (!about.isComplete || !mu.pitcher?.id || !mu.batter?.id || !events.length) continue;

    const pitches = [];
    for (let i = 0; i < events.length; i++) {
      const d = events[i].details || {};
      const type = normCode(d.type?.code || "");
      if (!type || type === "UN") continue;
      const code = d.call?.code || d.code;
      const call = CODE[code] || "ball";
      const kind = pitchKind(call, d, code);
      const calls = [];
      const types = [];
      for (let j = 0; j < i; j++) {
        const pd = events[j].details || {};
        const pc = pd.call?.code || pd.code;
        const pcall = CODE[pc] || "ball";
        calls.push(CALL[pcall] ?? CALL.ball);
        types.push(typeIndex(pd.type?.code));
      }
      const half = about.halfInning === "bottom" ? 1 : 0;
      const bases = basesAtStart(play);
      const cnt = countBefore(events, i);
      pitches.push({
        n: i + 1,
        type,
        call,
        kind,
        outcome: d.call?.description || outcomeName(call),
        body: {
          game_date: +String(gameDate).replaceAll("-", ""),
          at_bat_number: (about.atBatIndex ?? 0) + 1,
          pitch_number: i + 1,
          pitcher_id: mu.pitcher.id,
          batter_id: mu.batter.id,
          pitch_calls_so_far: calls,
          pitch_types_so_far: types,
          outs: outsBefore(events, i),
          on_1b: bases.on_1b,
          on_2b: bases.on_2b,
          on_3b: bases.on_3b,
          offense_score: half ? startHome : startAway,
          defense_score: half ? startAway : startHome,
          inning: about.inning || 1,
          inning_half: half,
          p_throws: mu.pitchHand?.code === "L" ? 1 : 0,
          stand: mu.batSide?.code === "L" ? 1 : 0,
        },
        view: {
          count: `${cnt.balls}-${cnt.strikes}`,
          outs: outsBefore(events, i),
          on_1b: !!bases.on_1b,
          on_2b: !!bases.on_2b,
          on_3b: !!bases.on_3b,
        },
      });
    }

    if (pitches.length < 1) continue;

    const half = about.halfInning === "bottom" ? 1 : 0;
    const abKey = `${gamePk}:${about.atBatIndex ?? 0}`;
    out.push({
      id: abKey,
      mode,
      gamePk,
      gameDate,
      year: +String(gameDate).slice(0, 4),
      result: res.description || res.event || "",
      view: {
        game: `${awayAbbr} ${startAway} @ ${homeAbbr} ${startHome}`,
        inning: `${half ? "Bot" : "Top"} ${about.inning || 1}`,
        pitcher: { id: mu.pitcher.id, name: mu.pitcher.fullName },
        batter: { id: mu.batter.id, name: mu.batter.fullName },
        matchup: `${mu.pitcher.fullName} vs ${mu.batter.fullName}`,
        batSide: mu.batSide?.code === "L" ? "L" : "R",
      },
      pitches,
    });
  }
  return out;
}

/** Historical source — swap later for a live feed that yields the same shape. */
const HistoricalSource = {
  mode: "historical",
  gamePool: null,
  seenAbs: new Set(),

  async loadGamePool() {
    if (this.gamePool) return this.gamePool;
    this.gamePool = shuffle(await loadFinalGames());
    return this.gamePool;
  },

  async nextAtBat() {
    const pool = await this.loadGamePool();
    if (!pool.length) throw new Error("No recent final games found");

    for (let attempt = 0; attempt < MAX_GAME_TRIES; attempt++) {
      const g = pool[Math.floor(Math.random() * pool.length)];
      const feed = await get(`${MLB}/v1.1/game/${g.gamePk}/feed/live`);
      const abs = shuffle(
        atBatsFromFeed(feed, g.gamePk, g.date, "historical").filter(ab => !this.seenAbs.has(ab.id))
      );
      if (!abs.length) continue;
      const ab = abs[0];
      this.seenAbs.add(ab.id);
      if (this.seenAbs.size > 200) {
        const first = this.seenAbs.values().next().value;
        this.seenAbs.delete(first);
      }
      return ab;
    }
    throw new Error("Could not find a playable at-bat — try again");
  },

  hasMore() {
    return true;
  },
};

/** Same 10 pitches for everyone on a given Pacific (PST/PDT) calendar day. */
const DailySource = {
  mode: "daily",
  dateKey: dailyKey(),
  playlist: null,
  cursor: 0,
  total: DAILY_PITCHES,

  async ensurePlaylist() {
    if (this.playlist) return this.playlist;
    const rng = mulberry32(hashStr(`pitch-daily:${this.dateKey}`));
    const games = seededShuffle(
      [...(await loadFinalGames())].sort((a, b) => a.gamePk - b.gamePk),
      rng
    );
    if (!games.length) throw new Error("No recent final games found");

    const candidates = [];
    for (const g of games) {
      if (candidates.length >= DAILY_PITCHES * 4) break;
      let feed;
      try {
        feed = await get(`${MLB}/v1.1/game/${g.gamePk}/feed/live`);
      } catch {
        continue;
      }
      for (const ab of atBatsFromFeed(feed, g.gamePk, g.date, "daily")) {
        for (let i = 0; i < ab.pitches.length; i++) {
          candidates.push({ ab, pitchIndex: i });
        }
      }
    }
    if (!candidates.length) throw new Error("Could not build today's daily — try again later");

    this.playlist = seededShuffle(candidates, rng)
      .slice(0, DAILY_PITCHES)
      .map(({ ab, pitchIndex }) => sliceDailyAb(ab, pitchIndex))
      .filter(Boolean);
    if (this.playlist.length < DAILY_PITCHES) {
      throw new Error("Could not build today's daily — try again later");
    }
    this.total = this.playlist.length;
    return this.playlist;
  },

  async nextAtBat() {
    await this.ensurePlaylist();
    if (this.cursor >= this.playlist.length) {
      const err = new Error("Daily complete");
      err.code = "DAILY_COMPLETE";
      throw err;
    }
    return this.playlist[this.cursor++];
  },

  hasMore() {
    return !this.playlist || this.cursor < this.playlist.length;
  },
};

const source = isDailyMode ? DailySource : HistoricalSource;

const score = {
  you: { hits: 0, total: 0 },
  model: { hits: 0, total: 0 },
};

let pitchMarks = [];
let dailyPitchNum = 0;
let dailySaved = isDailyMode ? loadDailyProgress() : null;
const readyQueue = [];

let state = {
  ab: null,
  pitchIndex: 0,
  phase: "loading", // loading | guess | reveal | done | daily-results | error
  lastGuess: null,
  lastActual: null,
  lastHit: null,
  history: [], // revealed pitches in current AB
  stats: null,
  mix: [],
  busy: false,
};

const board = document.getElementById("board");
const meta = document.getElementById("meta");
const nextAbBtn = document.getElementById("next-ab");
const skipBtn = document.getElementById("skip");

function gameQuery(extra = {}) {
  const q = new URLSearchParams();
  const api = params.get("api");
  if (api) q.set("api", api);
  for (const [k, v] of Object.entries(extra)) {
    if (v != null && v !== "") q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

function setupChrome() {
  document.title = isDailyMode
    ? `Daily ${dailyKey()} — Pitch Predict`
    : "Free play — Pitch Predict";
  document.body.classList.toggle("daily-mode", isDailyMode);
  const scoreEl = document.getElementById("game-score");
  if (scoreEl) scoreEl.hidden = isDailyMode;
  const daily = document.getElementById("mode-daily");
  const free = document.getElementById("mode-free");
  if (daily) {
    daily.href = `game.html${gameQuery()}`;
    daily.classList.toggle("active", isDailyMode);
    daily.setAttribute("aria-current", isDailyMode ? "page" : "false");
  }
  if (free) {
    free.href = `game.html${gameQuery({ mode: "free" })}`;
    free.classList.toggle("active", !isDailyMode);
    free.setAttribute("aria-current", !isDailyMode ? "page" : "false");
  }
}

function dailyHasMorePlay() {
  return isDailyMode && (source.hasMore() || readyQueue.length > 0);
}

function renderScore() {
  const you = score.you;
  const model = score.model;
  document.getElementById("you-acc").textContent = pct(you.hits, you.total);
  document.getElementById("you-sub").textContent = `${you.hits} / ${you.total}`;
  document.getElementById("model-acc").textContent = pct(model.hits, model.total);
  document.getElementById("model-sub").textContent = `${model.hits} / ${model.total}`;
}

function setMeta(text) {
  meta.textContent = text;
}

function fmtHintPct(share) {
  if (share == null) return "—";
  return `${(share * 100).toFixed(0)}%`;
}

function arsenalButtons(mix, disabled, ensureCode, ctx) {
  const codes = arsenalCodes(mix);
  const list = mix.length
    ? mix.filter(m => codes.has(TYPE_ALIAS[m.code] || m.code)).map(m => ({
        code: TYPE_ALIAS[m.code] || m.code,
        pct: m.pct,
      }))
    : [...codes].map(code => ({ code, pct: 0 }));
  const ensure = normCode(ensureCode);
  if (ensure && ensure !== "UN" && !list.some(m => m.code === ensure)) {
    list.push({ code: ensure, pct: 0 });
  }
  if (!list.length) {
    return `<p class="empty">No arsenal data for this pitcher.</p>`;
  }

  list.sort((a, b) => {
    const ac = ctx?.countBucket ? (bucketShare(ctx.countBucket, a.code) ?? -1) : -1;
    const bc = ctx?.countBucket ? (bucketShare(ctx.countBucket, b.code) ?? -1) : -1;
    if (bc !== ac) return bc - ac;
    const av = ctx?.vsBucket ? (bucketShare(ctx.vsBucket, a.code) ?? -1) : -1;
    const bv = ctx?.vsBucket ? (bucketShare(ctx.vsBucket, b.code) ?? -1) : -1;
    if (bv !== av) return bv - av;
    return (b.pct || 0) - (a.pct || 0);
  });

  const note = ctx?.games
    ? `<p class="arsenal-note">Recent starts (${ctx.games} game${ctx.games === 1 ? "" : "s"})${
        ctx.countBucket ? ` · ${esc(ctx.countLabel)} n=${ctx.countN}` : ""
      }${ctx.vsBucket ? ` · ${esc(ctx.vsLabel)} n=${ctx.vsN}` : ""}</p>`
    : "";

  return `${note}<div class="arsenal" role="group" aria-label="Pitch arsenal">
    ${list.map(m => {
      const season = m.pct ? `${(m.pct * 100).toFixed(0)}%` : "—";
      const countShare = ctx?.countBucket ? bucketShare(ctx.countBucket, m.code) : null;
      const vsShare = ctx?.vsBucket ? bucketShare(ctx.vsBucket, m.code) : null;
      const hints = [
        ctx?.countBucket ? `<span>${esc(ctx.countLabel)} <strong>${fmtHintPct(countShare)}</strong></span>` : "",
        ctx?.vsBucket ? `<span>${esc(ctx.vsLabel)} <strong>${fmtHintPct(vsShare)}</strong></span>` : "",
      ].filter(Boolean).join("");
      return `<button type="button" class="arsenal-btn" data-code="${esc(m.code)}" ${disabled ? "disabled" : ""}>
        <span class="arsenal-main">
          <span class="arsenal-name">${esc(name(m.code))}</span>
          ${hints ? `<span class="arsenal-hints">${hints}</span>` : ""}
        </span>
        <span class="arsenal-pct"><span class="arsenal-pct-lbl">season</span> ${esc(season)}</span>
      </button>`;
    }).join("")}
  </div>`;
}

function dailyShareGridHtml(marks, { total = DAILY_PITCHES, current = -1 } = {}) {
  const cells = [];
  for (let i = 0; i < total; i++) {
    if (i < marks.length) {
      cells.push(`<span class="daily-grid-cell done ${marks[i] ? "hit" : "miss"}"></span>`);
    } else {
      const cur = i === current ? " current" : "";
      cells.push(`<span class="daily-grid-cell pending${cur}" aria-hidden="true"></span>`);
    }
  }
  return cells.join("");
}

function renderDailyGrid() {
  const el = document.getElementById("daily-grid");
  if (!el) return;
  if (!isDailyMode) {
    el.hidden = true;
    return;
  }
  const total = source.total || DAILY_PITCHES;
  const marks = pitchMarks;
  const current = (state.phase === "guess" || state.phase === "reveal")
    ? marks.length
    : -1;
  el.hidden = false;
  el.innerHTML = dailyShareGridHtml(marks, { total, current });
  el.setAttribute("aria-label", `Daily progress, ${marks.length} of ${total} pitches`);
}

function dailyResultsHtml(result) {
  const you = result.you || { hits: 0, total: 0 };
  const model = result.model || { hits: 0, total: 0 };
  return `
    <div class="daily-results">
      <p class="daily-results-kicker">Daily ${esc(result.date)}</p>
      <p class="daily-results-score">You ${you.hits}/${you.total} · Model ${model.hits}/${model.total}</p>
      <button type="button" class="game-btn" id="copy-daily">Copy results</button>
      <p class="empty"><a href="game.html${esc(gameQuery({ mode: "free" }))}">Free play</a> anytime</p>
    </div>`;
}

function renderBoard() {
  const { ab, phase, pitchIndex, history, stats, mix, profile, lastGuess, lastActual, lastHit } = state;
  const moreDaily = dailyHasMorePlay();
  const showResultsCta = isDailyMode && phase === "done" && !moreDaily;
  nextAbBtn.hidden = phase !== "error" && phase !== "done";
  skipBtn.hidden = isDailyMode || phase === "loading" || phase === "done" || phase === "error" || phase === "daily-results";
  if (phase === "error") {
    nextAbBtn.textContent = "Try again";
  } else if (showResultsCta) {
    nextAbBtn.textContent = "See daily results";
  } else if (isDailyMode) {
    nextAbBtn.textContent = dailyPitchNum >= (source.total || DAILY_PITCHES)
      ? "See daily results"
      : `Next pitch (${dailyPitchNum + 1}/${source.total || DAILY_PITCHES})`;
  } else {
    nextAbBtn.textContent = "Next at-bat";
  }

  if (phase === "daily-results") {
    board.innerHTML = dailyResultsHtml(dailySaved || state.dailyResult);
    renderDailyGrid();
    return;
  }
  if (phase === "loading") {
    board.innerHTML = `<p class="empty">${isDailyMode ? "Loading today’s challenge…" : "Loading at-bat…"}</p>`;
    renderDailyGrid();
    return;
  }
  if (phase === "error" || !ab) {
    board.innerHTML = `<p class="err">${esc(state.error || "Something went wrong.")}</p>`;
    renderDailyGrid();
    return;
  }

  const pitch = ab.pitches[pitchIndex];
  const pitchTotal = ab.pitchTotal ?? ab.pitches.length;
  const includeCurrent = phase === "reveal";
  const pastLog = pastPitchLogHtml(ab, pitchIndex, includeCurrent);
  const viewSit = pitch?.view || history[history.length - 1]?.view || {
    count: "0-0", outs: 0, on_1b: false, on_2b: false, on_3b: false,
  };

  const ctx = phase === "guess" && pitch
    ? contextMix(profile, {
        count: viewSit.count || "0-0",
        stand: ab.view.batSide || "R",
        batterId: ab.view.batter.id,
        batterName: ab.view.batter.name,
      })
    : null;

  let mainAction = "";
  if (phase === "guess" && pitch) {
    mainAction = `
      <p class="game-prompt">Pitch ${pitch.n} of ${pitchTotal} — what's coming?</p>
      ${arsenalButtons(mix, state.busy, pitch.type, ctx)}`;
  } else if (phase === "reveal") {
    const atAbEnd = pitchIndex + 1 >= ab.pitches.length;
    let continueLabel = "Next pitch";
    if (isDailyMode && atAbEnd && !dailyHasMorePlay()) {
      continueLabel = "See daily results";
    } else if (!isDailyMode && atAbEnd) {
      continueLabel = "Next at-bat";
    }
    mainAction = `
      <div class="game-reveal ${lastHit ? "hit" : "miss"}">
        <div class="game-reveal-line">You guessed <strong>${esc(name(lastGuess))}</strong></div>
        <div class="game-reveal-line">Actual: <strong>${esc(name(lastActual))}</strong>
          <span class="game-reveal-tag">${lastHit ? "Correct" : "Miss"}</span>
        </div>
        ${isDailyMode ? "" : `<div class="game-reveal-outcome">${esc(pitch?.outcome || "")}</div>`}
      </div>
      <button type="button" class="game-btn" id="continue-pitch">${continueLabel}</button>`;
  } else if (phase === "done") {
    mainAction = `
      <p class="ab-result">${esc(ab.result || "At-bat complete")}</p>
      <p class="empty">You ${score.you.hits}/${score.you.total} · Model ${score.model.hits}/${score.model.total}</p>`;
  }

  board.innerHTML = `
    <article class="card game-card expanded ready">
      <div class="card-body">
        <div class="card-main">
          <header class="game-card-head">
            <div class="game-card-meta">
              <span class="game">${esc(ab.view.game)}</span>
              <span class="inning">${esc(ab.view.inning)}</span>
            </div>
            <div class="matchup">${esc(ab.view.matchup)}</div>
            ${phase === "done" ? "" : situationHtml(viewSit)}
          </header>
          <div class="game-card-body">
            ${mainAction}
          </div>
        </div>
        <div class="card-detail"><div class="inner">
          <div class="stats">
            <div class="stat-box">
              <div class="lbl">Pitching</div>
              <div class="stat-player">
                ${headshot(ab.view.pitcher.id, ab.view.pitcher.name)}
                <div>
                  <div class="name">${esc(ab.view.pitcher.name)}</div>
                  <div class="nums era">${stats ? "ERA " + fmtEra(stats.era) : "ERA —"}</div>
                </div>
              </div>
            </div>
            <div class="stat-box">
              <div class="lbl">At bat</div>
              <div class="stat-player">
                ${headshot(ab.view.batter.id, ab.view.batter.name)}
                <div>
                  <div class="name">${esc(ab.view.batter.name)}</div>
                  <div class="nums slash">${stats ? `${fmtRate(stats.avg)} / ${fmtRate(stats.obp)} / ${fmtRate(stats.slg)}` : "— / — / —"}</div>
                </div>
              </div>
            </div>
          </div>
          ${pastLog}
        </div></div>
      </div>
    </article>`;
  renderDailyGrid();
}

function finalizeDaily() {
  persistDailyProgress(true);
  state.phase = "daily-results";
  state.dailyResult = dailySaved;
  state.ab = null;
  nextAbBtn.hidden = true;
  skipBtn.hidden = true;
  setMeta(`Daily ${dailySaved.date} complete`);
  renderBoard();
}

function showStoredDaily(result) {
  dailySaved = result;
  score.you = { hits: result.you?.hits || 0, total: result.you?.total || 0 };
  score.model = { hits: result.model?.hits || 0, total: result.model?.total || 0 };
  pitchMarks = (result.marks || []).slice();
  state.phase = "daily-results";
  state.dailyResult = result;
  state.ab = null;
  renderScore();
  setMeta(result.done ? `Daily ${result.date} — already played` : `Daily ${result.date}`);
  renderBoard();
}

async function gradeModel(pitch, yr, mix) {
  try {
    const allowed = arsenalCodes(mix);
    let ranked = await predict(pitch.body, yr);
    ranked = maskRanked(ranked, allowed);
    const top = ranked[0]?.[0];
    const hit = top && normCode(top) === normCode(pitch.type);
    score.model.total += 1;
    if (hit) score.model.hits += 1;
    renderScore();
    if (isDailyMode) persistDailyProgress(false);
  } catch {
    /* model miss doesn't block play */
  }
}

async function onGuess(code) {
  if (state.phase !== "guess" || state.busy || !state.ab) return;
  const pitch = state.ab.pitches[state.pitchIndex];
  if (!pitch) return;

  state.busy = true;
  renderBoard();

  const actual = normCode(pitch.type);
  const guess = normCode(code);
  const hit = guess === actual;

  score.you.total += 1;
  if (hit) score.you.hits += 1;
  if (isDailyMode) {
    pitchMarks.push(hit);
    persistDailyProgress(false);
  }
  renderScore();

  const revealed = {
    ...pitch,
    userGuess: guess,
    userHit: hit,
  };
  state.history.push(revealed);
  state.lastGuess = guess;
  state.lastActual = actual;
  state.lastHit = hit;
  state.phase = "reveal";
  state.busy = false;
  renderBoard();

  gradeModel(pitch, state.ab.year, state.mix);
}

function continueAfterReveal() {
  if (state.phase !== "reveal" || !state.ab) return;
  const next = state.pitchIndex + 1;
  if (next >= state.ab.pitches.length) {
    if (isDailyMode && !dailyHasMorePlay()) {
      finalizeDaily();
      return;
    }
    loadAtBat();
    return;
  }
  state.pitchIndex = next;
  state.phase = "guess";
  state.lastGuess = null;
  state.lastActual = null;
  state.lastHit = null;
  const p = state.ab.pitches[next];
  setMeta(`${state.ab.view.game} · ${state.ab.view.inning} · pitch ${p.n} of ${state.ab.pitches.length}`);
  renderBoard();
}

async function hydrateAtBat(ab) {
  const yr = ab.year || new Date().getFullYear();
  const [[avg, obp, slg], pitcherEra, mix, profile] = await Promise.all([
    slash(ab.view.batter.id, yr),
    era(ab.view.pitcher.id, yr),
    pitchMix(ab.view.pitcher.id, yr),
    pitcherProfile(ab.view.pitcher.id, yr, ab.gamePk),
  ]);
  return {
    ab,
    stats: { avg, obp, slg, era: pitcherEra },
    mix,
    profile,
  };
}

const PRELOAD_TARGET = isDailyMode ? DAILY_PITCHES : 3;
let preloadBusy = false;
let preloadError = null;
let readyWaiters = [];

function notifyReady() {
  const waiters = readyWaiters;
  readyWaiters = [];
  for (const w of waiters) w.resolve();
}

function waitForReadyPack() {
  if (readyQueue.length) return Promise.resolve();
  return new Promise((resolve, reject) => {
    readyWaiters.push({ resolve, reject });
  });
}

function failReadyWaiters(err) {
  const waiters = readyWaiters;
  readyWaiters = [];
  for (const w of waiters) w.reject(err);
}

async function pumpPreload() {
  if (preloadBusy) return;
  preloadBusy = true;
  preloadError = null;
  try {
    while (readyQueue.length < PRELOAD_TARGET) {
      try {
        const pack = await hydrateAtBat(await source.nextAtBat());
        readyQueue.push(pack);
        notifyReady();
      } catch (e) {
        if (e.code === "DAILY_COMPLETE") break;
        throw e;
      }
    }
  } catch (e) {
    preloadError = e;
    if (!readyQueue.length) failReadyWaiters(e);
  } finally {
    preloadBusy = false;
    if (
      readyQueue.length < PRELOAD_TARGET
      && !preloadError
      && (!isDailyMode || source.hasMore())
    ) {
      queueMicrotask(() => { pumpPreload(); });
    }
  }
}

async function takeReadyAtBat() {
  for (;;) {
    if (readyQueue.length) {
      const pack = readyQueue.shift();
      pumpPreload();
      return pack;
    }
    preloadError = null;
    pumpPreload();
    try {
      await waitForReadyPack();
    } catch (e) {
      if (readyQueue.length) continue;
      throw e;
    }
    if (readyQueue.length) continue;
    if (!preloadBusy) {
      throw preloadError || new Error("Could not find a playable at-bat — try again");
    }
  }
}

function applyPack(pack) {
  if (isDailyMode) dailyPitchNum += 1;
  state = {
    ab: pack.ab,
    pitchIndex: 0,
    phase: "guess",
    lastGuess: null,
    lastActual: null,
    lastHit: null,
    history: [],
    stats: pack.stats,
    mix: pack.mix,
    profile: pack.profile,
    busy: false,
    error: null,
  };
  const dailyBit = isDailyMode ? ` · pitch ${dailyPitchNum}/${source.total || DAILY_PITCHES}` : ` · ${source.mode}`;
  setMeta(`${pack.ab.view.game} · ${pack.ab.view.inning}${dailyBit} · pitch 1 of ${pack.ab.pitches.length}`);
  renderBoard();
}

async function loadAtBat() {
  if (isDailyMode && dailySaved?.done) {
    showStoredDaily(dailySaved);
    return;
  }
  if (isDailyMode && state.phase === "daily-results") return;

  if (isDailyMode && state.phase === "done" && !dailyHasMorePlay()) {
    finalizeDaily();
    return;
  }

  const instant = readyQueue.length > 0;
  if (!instant) {
    state = {
      ab: null,
      pitchIndex: 0,
      phase: "loading",
      lastGuess: null,
      lastActual: null,
      lastHit: null,
      history: [],
      stats: null,
      mix: [],
      profile: null,
      busy: false,
      error: null,
    };
    renderScore();
    renderBoard();
    setMeta(isDailyMode ? "Loading today’s challenge…" : "Loading a random at-bat…");
  }

  try {
    const pack = await takeReadyAtBat();
    applyPack(pack);
  } catch (e) {
    if (e.code === "DAILY_COMPLETE") {
      finalizeDaily();
      return;
    }
    state.phase = "error";
    state.error = e.message || String(e);
    setMeta("Could not load an at-bat");
    renderBoard();
  }
}

async function copyDailyResults() {
  const result = dailySaved || state.dailyResult;
  if (!result) return;
  const text = shareText(result);
  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById("copy-daily");
    if (btn) {
      btn.textContent = "Copied";
      setTimeout(() => { btn.textContent = "Copy results"; }, 1500);
    }
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

board.addEventListener("click", e => {
  const arsenal = e.target.closest(".arsenal-btn");
  if (arsenal) {
    onGuess(arsenal.dataset.code);
    return;
  }
  if (e.target.closest("#continue-pitch")) {
    continueAfterReveal();
    return;
  }
  if (e.target.closest("#copy-daily")) {
    copyDailyResults();
  }
});

nextAbBtn.addEventListener("click", () => loadAtBat());
skipBtn.addEventListener("click", () => {
  if (!isDailyMode) loadAtBat();
});

setupChrome();

if (isDailyMode && dailySaved) {
  restoreDailyProgress(dailySaved);
}

renderScore();
renderDailyGrid();

if (isDailyMode && dailySaved?.done) {
  showStoredDaily(dailySaved);
} else {
  pumpPreload();
  loadAtBat();
}