// Edge data feed: pulls ESPN's public JSON (no API key) and writes data/games.json,
// data/injuries.json and data/meta.json. Node 18+ (uses global fetch). Never throws on
// a single failed source; failures are recorded in meta.json.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const CORE = 'https://sports.core.api.espn.com/v2/sports';
const ATH = 'https://site.web.api.espn.com/apis/common/v3/sports';
const OUT = new URL('../data/', import.meta.url);
const sources = {};

async function getJSON(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'edge-betting-feed/1.0 (+github pages)' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (i === tries - 1) throw e; await new Promise((res) => setTimeout(res, 1500)); }
  }
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch { out[k] = null; } } }));
  return out;
}
const num = (v) => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(/^[ou]/i, '')); return Number.isFinite(n) ? n : null; };
const odds = (v) => { if (v == null) return null; if (String(v).toUpperCase() === 'EVEN') return 100; const n = num(v); return n != null && Math.abs(n) >= 100 ? Math.round(n) : null; };

function team(c) {
  const t = c.team || {};
  const rec = (c.records || []).find((r) => r.type === 'total' || r.name === 'overall');
  const rank = c.curatedRank && c.curatedRank.current && c.curatedRank.current < 99 ? c.curatedRank.current : null;
  return { id: t.id || null, name: t.displayName || t.name || 'TBD', short: t.shortDisplayName || t.name || '', abbr: t.abbreviation || '', logo: t.logo || null, color: t.color ? '#' + t.color : null, record: rec ? rec.summary : null, rank, score: c.score != null && c.score !== '' ? Number(c.score) : null };
}
function gameOdds(o) {
  if (!o) return null;
  const side = (s) => s ? { line: num(s.close && s.close.line), odds: odds(s.close && s.close.odds), openLine: num(s.open && s.open.line), openOdds: odds(s.open && s.open.odds) } : null;
  const ml = (s) => s ? { odds: odds(s.close && s.close.odds), open: odds(s.open && s.open.odds) } : null;
  const ps = o.pointSpread || {}, tot = o.total || {}, m = o.moneyline || {};
  const res = {
    provider: (o.provider && (o.provider.displayName || o.provider.name)) || null,
    details: o.details || null,
    spread: { home: side(ps.home), away: side(ps.away) },
    total: { line: num(o.overUnder) ?? num(tot.over && tot.over.close && tot.over.close.line), overOdds: odds(tot.over && tot.over.close && tot.over.close.odds), underOdds: odds(tot.under && tot.under.close && tot.under.close.odds), openLine: num(tot.over && tot.over.open && tot.over.open.line) },
    moneyline: { home: ml(m.home), away: ml(m.away) },
  };
  // Older payload shape fallback
  if (!res.spread.home && o.spread != null && o.homeTeamOdds) {
    const hf = o.homeTeamOdds.favorite; const s = Math.abs(num(o.spread));
    res.spread = { home: { line: hf ? -s : s, odds: odds(o.homeTeamOdds.spreadOdds) }, away: { line: hf ? s : -s, odds: odds(o.awayTeamOdds && o.awayTeamOdds.spreadOdds) } };
  }
  if (!res.moneyline.home && o.homeTeamOdds) res.moneyline = { home: { odds: odds(o.homeTeamOdds.moneyLine) }, away: { odds: odds(o.awayTeamOdds && o.awayTeamOdds.moneyLine) } };
  return res;
}

async function football(key, label, path, query) {
  try {
    const d = await getJSON(`${SITE}/football/${path}/scoreboard${query}`);
    const games = (d.events || []).map((e) => {
      const c = (e.competitions || [])[0] || {};
      const comp = c.competitors || [];
      const home = comp.find((x) => x.homeAway === 'home') || comp[0] || {};
      const away = comp.find((x) => x.homeAway === 'away') || comp[1] || {};
      const st = (c.status || e.status || {}).type || {};
      const link = (e.links || []).find((l) => (l.rel || []).includes('summary')) || (e.links || [])[0];
      return {
        id: e.id, sport: label, name: e.name || '', short: e.shortName || '', start: e.date || c.date || null,
        status: { state: st.state || 'pre', detail: st.shortDetail || st.detail || '' },
        venue: c.venue ? [c.venue.fullName, c.venue.address && c.venue.address.city].filter(Boolean).join(' · ') : null,
        indoor: c.venue ? !!c.venue.indoor : null, city: c.venue && c.venue.address ? c.venue.address.city || null : null, state: c.venue && c.venue.address ? c.venue.address.state || null : null,
        espnWeather: e.weather ? { temp: e.weather.temperature ?? null, text: e.weather.displayValue || '' } : null,
        neutral: !!c.neutralSite, broadcast: c.broadcast || ((c.broadcasts || [])[0] || {}).names?.[0] || null,
        home: team(home), away: team(away), odds: gameOdds((c.odds || [])[0]), espnUrl: link ? link.href : null,
      };
    });
    // Fill missing odds from the game summary (pickcenter) for scheduled games, capped to stay light.
    const missing = games.filter((g) => !g.odds && g.status.state === 'pre').slice(0, 25);
    await pool(missing, 5, async (g) => {
      const s = await getJSON(`${SITE}/football/${path}/summary?event=${g.id}`, 1);
      const pc = (s.pickcenter || [])[0]; if (pc) g.odds = gameOdds(pc);
    });
    sources[key + '_scoreboard'] = { ok: true, count: games.length, withOdds: games.filter((g) => g.odds).length };
    const week = d.week ? d.week.number : null;
    return { week, season: d.season ? d.season.year : null, byes: (d.week && d.week.teamsOnBye || []).map((t) => t.abbreviation), games };
  } catch (e) { sources[key + '_scoreboard'] = { ok: false, error: String(e.message || e) }; return null; }
}

async function ufc() {
  try {
    const d = await getJSON(`${SITE}/mma/ufc/scoreboard`);
    const events = [];
    for (const e of d.events || []) {
      const fights = (e.competitions || []).map((c, idx) => {
        const comp = (c.competitors || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
        return {
          id: c.id, order: idx, weightClass: (c.type && c.type.abbreviation) || null, start: c.date || e.date,
          status: { state: (c.status && c.status.type && c.status.type.state) || 'pre', detail: (c.status && c.status.type && c.status.type.shortDetail) || '' },
          fighters: comp.map((f) => {
            const a = f.athlete || {}; const rec = (f.records || [])[0];
            return { id: f.id, name: a.displayName || a.fullName || 'TBD', short: a.shortName || '', record: rec ? rec.summary : null, country: a.flag ? a.flag.alt : null, flag: a.flag ? a.flag.href : null, headshot: f.id ? `https://a.espncdn.com/i/headshots/mma/players/full/${f.id}.png` : null, winner: !!f.winner, ml: null, mlOpen: null };
          }),
          odds: null,
        };
      });
      // Odds per fight (ESPN core API). order 1 = "home" athlete, verified against "details" when possible.
      await pool(fights, 6, async (f) => {
        const o = await getJSON(`${CORE}/mma/leagues/ufc/events/${e.id}/competitions/${f.id}/odds`, 1);
        const it = (o.items || [])[0]; if (!it) return;
        const [h, a] = f.fighters;
        const hm = odds(it.homeAthleteOdds && it.homeAthleteOdds.moneyLine), am = odds(it.awayAthleteOdds && it.awayAthleteOdds.moneyLine);
        const ho = odds(it.homeAthleteOdds && it.homeAthleteOdds.open && it.homeAthleteOdds.open.moneyLine && it.homeAthleteOdds.open.moneyLine.american);
        const ao = odds(it.awayAthleteOdds && it.awayAthleteOdds.open && it.awayAthleteOdds.open.moneyLine && it.awayAthleteOdds.open.moneyLine.american);
        let swap = false;
        const det = it.details || ''; const m = det.match(/^(.*)\s([+-]\d+|EVEN)$/i);
        if (m && a && h && hm !== am) { const nm = m[1].trim(); const p = odds(m[2]); if (a.short === nm && p === am) swap = false; else if (a.short === nm && p === hm) swap = true; else if (h.short === nm && p === am) swap = true; }
        if (h) { h.ml = swap ? am : hm; h.mlOpen = swap ? ao : ho; }
        if (a) { a.ml = swap ? hm : am; a.mlOpen = swap ? ho : ao; }
        f.odds = { provider: (it.provider && (it.provider.displayName || it.provider.name)) || null, details: det || null, rounds: num(it.overUnder), overOdds: odds(it.overOdds), underOdds: odds(it.underOdds) };
      });
      // Fighter profile (height, reach, stance, finish record)
      const all = fights.flatMap((f) => f.fighters).filter((f) => f.id);
      await pool(all, 6, async (f) => {
        const p = (await getJSON(`${ATH}/mma/athletes/${f.id}`, 1)).athlete || {};
        f.height = p.displayHeight || null; f.reach = p.displayReach || null; f.stance = p.stance && (p.stance.text || p.stance) || null;
        f.age = p.age || null; f.nickname = p.nickname || null; f.style = p.displayFightingStyle || null;
        if (p.headshot && p.headshot.href) f.headshot = p.headshot.href;
        const st = (p.statsSummary && p.statsSummary.statistics) || [];
        const g = (n) => (st.find((s) => s.name === n) || {}).displayValue || null;
        f.wld = g('wins-losses-draws'); f.ko = g('tkos-tkoLosses'); f.sub = g('submissions-submissionLosses');
      });
      // Main event first (ESPN lists prelims first)
      fights.reverse().forEach((f, i) => (f.order = i));
      events.push({ id: e.id, name: e.name || e.shortName || 'UFC', start: e.date, venue: (e.competitions || [])[0]?.venue?.fullName || null, city: (e.competitions || [])[0]?.venue?.address?.city || null, espnUrl: (e.links || [])[0]?.href || null, fights });
    }
    sources.ufc_scoreboard = { ok: true, events: events.length, fights: events.reduce((a, e) => a + e.fights.length, 0), withOdds: events.reduce((a, e) => a + e.fights.filter((f) => f.odds).length, 0) };
    return { events };
  } catch (e) { sources.ufc_scoreboard = { ok: false, error: String(e.message || e) }; return null; }
}

async function injuries(key, path) {
  try {
    const d = await getJSON(`${SITE}/football/${path}/injuries`);
    const teams = {};
    for (const t of d.injuries || []) {
      teams[t.id] = {
        team: t.displayName,
        items: (t.injuries || []).map((i) => ({
          name: i.athlete?.displayName || '', pos: i.athlete?.position?.abbreviation || '', status: i.status || i.type?.description || '',
          abbr: i.type?.abbreviation || '', injury: [i.details?.type, i.details?.detail].filter(Boolean).join(' – ') || null,
          note: i.shortComment || null, date: i.date || null, returnDate: i.details?.returnDate || null,
          headshot: i.athlete?.headshot?.href || null,
        })),
      };
    }
    sources[key + '_injuries'] = { ok: true, teams: Object.keys(teams).length, players: Object.values(teams).reduce((a, t) => a + t.items.length, 0) };
    return teams;
  } catch (e) { sources[key + '_injuries'] = { ok: false, error: String(e.message || e) }; return null; }
}

// ---------- News: ESPN public news, merged with hand-curated items (never overwritten) ----------
async function newsFeed(key, path) {
  try {
    const d = await getJSON(`${SITE}/${path}/news?limit=25`);
    const items = (d.articles || []).filter((a) => a.headline && a.type !== 'Media').map((a) => ({
      id: `espn-${key}-${a.id}`, sport: key, type: 'news', title: a.headline, summary: a.description || '', event: '',
      fighters_or_teams: (a.categories || []).filter((c) => c.type === 'athlete' || c.type === 'team').map((c) => c.description).filter(Boolean).slice(0, 4),
      impact: 'low', edge_take: '', source_name: 'ESPN', source_url: (a.links && a.links.web && a.links.web.href) || '', published: a.published || a.lastModified || '',
    }));
    sources[key + '_news'] = { ok: true, count: items.length };
    return items;
  } catch (e) { sources[key + '_news'] = { ok: false, error: String(e.message || e) }; return null; }
}
const isCurated = (i) => !!(i.edge_take || (i.type && i.type !== 'news') || !String(i.id || '').startsWith('espn-'));
async function writeNews() {
  const fresh = (await Promise.all([newsFeed('nfl', 'football/nfl'), newsFeed('cfb', 'football/college-football'), newsFeed('ufc', 'mma/ufc')])).flat().filter(Boolean);
  let old = { items: [] }; try { old = JSON.parse((await readOld('news.json')) || '{"items":[]}'); } catch {}
  const oldItems = Array.isArray(old.items) ? old.items : [];
  const curated = oldItems.filter(isCurated), curIds = new Set(curated.map((i) => i.id));
  const cutoff = Date.now() - 7 * 864e5, ts = (i) => Date.parse(i.published) || 0;
  const auto = new Map();
  oldItems.filter((i) => !isCurated(i)).concat(fresh).forEach((i) => { if (!curIds.has(i.id) && ts(i) >= cutoff) auto.set(i.id, i); });
  const room = Math.max(0, 60 - curated.length);
  const autoKeep = [...auto.values()].sort((a, b) => ts(b) - ts(a)).slice(0, room);
  const items = curated.concat(autoKeep).sort((a, b) => ts(b) - ts(a));
  if (JSON.stringify(items) === JSON.stringify(oldItems)) return console.log('No news change.');
  await writeFile(new URL('news.json', OUT), JSON.stringify({ updated: new Date().toISOString(), items }, null, 2));
  console.log(`News written: ${curated.length} curated + ${autoKeep.length} auto.`);
}

// ---------- The Odds API (DraftKings + FanDuel). Key from env ODDS_API_KEY only; never logged or written. ----------
// Budget: free tier = 500 credits/month. Cost per sport call = markets returned x 1 region (empty responses are free).
// We only call when (a) the sport has events in the next 7 days (free /events check) and (b) enough hours have passed
// that the remaining credits stretch to month end with a 50-credit reserve (≤ ~450 used/month) (minimum 6h between pulls).
const OA = 'https://api.the-odds-api.com/v4/sports';
const OA_SPORTS = [['nfl', 'americanfootball_nfl', 'h2h,spreads,totals'], ['cfb', 'americanfootball_ncaaf', 'h2h,spreads,totals'], ['ufc', 'mma_mixed_martial_arts', 'h2h']];
const BK = { draftkings: 'DraftKings', fanduel: 'FanDuel' };
async function oaGet(path, params) {
  const key = process.env.ODDS_API_KEY;
  const qs = new URLSearchParams({ ...params, apiKey: key });
  const r = await fetch(`${OA}/${path}?${qs}`, { signal: AbortSignal.timeout(20000) });
  const h = { remaining: num(r.headers.get('x-requests-remaining')), used: num(r.headers.get('x-requests-used')), last: num(r.headers.get('x-requests-last')) };
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.h = h; throw e; }
  return { data: await r.json(), h };
}
function compactEvent(key, ev) {
  const b = {};
  for (const bm of ev.bookmakers || []) {
    const name = BK[bm.key]; if (!name) continue; const o = { updated: bm.last_update };
    for (const m of bm.markets || []) {
      const by = (n) => m.outcomes.find((x) => x.name === n);
      if (m.key === 'h2h') o.ml = { home: by(ev.home_team)?.price ?? null, away: by(ev.away_team)?.price ?? null };
      if (m.key === 'spreads') { const hh = by(ev.home_team), aa = by(ev.away_team); o.spread = { home: hh ? { line: hh.point, odds: hh.price } : null, away: aa ? { line: aa.point, odds: aa.price } : null }; }
      if (m.key === 'totals') { const ov = by('Over'), un = by('Under'); o.total = { line: ov?.point ?? un?.point ?? null, over: ov?.price ?? null, under: un?.price ?? null }; }
    }
    b[name] = o;
  }
  return { id: ev.id, sport: key, start: ev.commence_time, home: ev.home_team, away: ev.away_team, books: b };
}
async function oddsApi(oldMeta, oldCache) {
  const prev = (oldMeta && oldMeta.oddsApi) || {};
  if (!process.env.ODDS_API_KEY) { sources.oddsapi = { ok: false, error: 'ODDS_API_KEY not set — kept last prices' }; return { cache: oldCache, info: { ...prev, skipped: 'no key' } }; }
  const now = Date.now(), monthEnd = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1);
  const hoursLeft = (monthEnd - now) / 36e5, sinceH = prev.lastFetch ? (now - Date.parse(prev.lastFetch)) / 36e5 : 1e9;
  const remaining = prev.remaining != null && prev.lastFetch && new Date(prev.lastFetch).getUTCMonth() === new Date().getUTCMonth() ? prev.remaining : 500;
  const perRound = prev.lastRoundCost || 7;
  const minGap = Math.max(6, (hoursLeft * perRound) / Math.max(1, remaining - 50));
  if (remaining - perRound < 50 || sinceH < minGap) {
    sources.oddsapi = { ok: true, skipped: `budget: next pull in ${Math.max(0, minGap - sinceH).toFixed(1)}h`, remaining };
    return { cache: oldCache, info: prev };
  }
  const to = new Date(now + 7 * 864e5).toISOString().replace(/\.\d+Z$/, 'Z');
  const events = [...((oldCache && oldCache.events) || [])]; let cost = 0, h = null; const got = {};
  for (const [key, sk, markets] of OA_SPORTS) {
    try {
      const ev = await oaGet(`${sk}/events`, { commenceTimeTo: to }); // free
      if (!ev.data.length) { got[key] = 0; continue; }
      const r = await oaGet(`${sk}/odds`, { regions: 'us', bookmakers: 'draftkings,fanduel', markets, oddsFormat: 'american', commenceTimeTo: to });
      h = r.h; cost += r.h.last || 0;
      const fresh = r.data.map((e) => compactEvent(key, e)).filter((e) => Object.keys(e.books).length);
      for (let i = events.length - 1; i >= 0; i--) if (events[i].sport === key) events.splice(i, 1);
      events.push(...fresh); got[key] = fresh.length;
    } catch (e) { got[key] = 'error ' + e.message; if (e.h) h = e.h; if (/HTTP (401|429)/.test(e.message)) break; }
  }
  const keep = events.filter((e) => Date.parse(e.start) > now - 2 * 864e5);
  const info = { lastFetch: new Date().toISOString(), remaining: h ? h.remaining : remaining, used: h ? h.used : null, lastRoundCost: cost || perRound, events: got, budget: '≤ ~450 credits/month; auto-spaced (min 6h) so remaining credits last to month end' };
  sources.oddsapi = { ok: Object.values(got).some((v) => typeof v === 'number'), events: got, remaining: info.remaining, cost };
  return { cache: { updated: info.lastFetch, events: keep }, info };
}
const normT = (s) => String(s || '').toLowerCase().replace(/\bst\.?\b/g, 'state').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const lastN = (s) => normT(String(s || '').trim().split(/\s+/).slice(-1)[0]);
function mergeBooks(games, cache) {
  if (!cache || !cache.events) return;
  const near = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) < 18 * 36e5;
  for (const key of ['nfl', 'cfb']) for (const g of (games[key] && games[key].games) || []) {
    const H = normT(g.home.name), A = normT(g.away.name);
    const m = cache.events.find((e) => e.sport === key && near(e.start, g.start) && normT(e.home) === H && normT(e.away) === A)
      || cache.events.find((e) => e.sport === key && near(e.start, g.start) && [[e.home, H], [e.away, A]].every(([x, y]) => { const n = normT(x); return n.startsWith(y) || y.startsWith(n); }));
    if (m) { g.books = m.books; g.booksUpdated = cache.updated; } else delete g.books;
  }
  for (const ev of (games.ufc && games.ufc.events) || []) for (const f of ev.fights) {
    const [a, b] = f.fighters; if (!a || !b) continue;
    const m = cache.events.find((e) => e.sport === 'ufc' && near(e.start, f.start || ev.date) && [[a.name], [b.name]].every(([n]) => [e.home, e.away].some((x) => lastN(x) === lastN(n))));
    f.fighters.forEach((x) => delete x.books);
    if (!m) continue;
    for (const x of f.fighters) { const side = lastN(m.home) === lastN(x.name) ? 'home' : 'away'; x.books = {}; for (const [bk, o] of Object.entries(m.books)) if (o.ml && o.ml[side] != null) x.books[bk] = o.ml[side]; }
    f.booksUpdated = cache.updated;
  }
}

// ---------- Research extras: ESPN Matchup Predictor, Open-Meteo weather, line history ----------
const within = (iso, days) => { const t = Date.parse(iso); return t > Date.now() - 3 * 36e5 && t < Date.now() + days * 864e5; };
async function predictors(games, oldGames) {
  const prev = {}; for (const k of ['nfl', 'cfb']) for (const g of (oldGames[k] && oldGames[k].games) || []) if (g.model) prev[g.id] = g.model;
  const todo = [];
  for (const [k, path] of [['nfl', 'nfl'], ['cfb', 'college-football']]) for (const g of (games[k] && games[k].games) || []) {
    if (g.status.state !== 'pre' || !within(g.start, 8)) continue; if (k === 'cfb' && !g.odds) continue; todo.push([g, path]);
  }
  let ok = 0;
  await pool(todo.slice(0, 80), 6, async ([g, path]) => {
    try {
      const s = await getJSON(`${SITE}/football/${path}/summary?event=${g.id}`, 1); const p = s.predictor;
      const h = p && p.homeTeam && num(p.homeTeam.gameProjection), a = p && p.awayTeam && num(p.awayTeam.gameProjection);
      if (h != null && a != null) { g.model = { src: 'ESPN Matchup Predictor (FPI)', home: h / 100, away: a / 100 }; ok++; }
      else if (prev[g.id]) g.model = prev[g.id];
    } catch { if (prev[g.id]) g.model = prev[g.id]; }
  });
  sources.espn_predictor = { ok: true, games: ok };
}
const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
async function weather(games, geo) {
  const todo = []; for (const k of ['nfl', 'cfb']) for (const g of (games[k] && games[k].games) || []) if (g.status.state === 'pre' && g.indoor === false && g.city && within(g.start, 7)) todo.push(g);
  let ok = 0;
  await pool(todo, 5, async (g) => {
    try {
      if (!g.state || !STATES[g.state]) return; // US venues only
      const gk = `${g.city}|${g.state || ''}`;
      if (!geo[gk]) {
        const r = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(g.city)}&count=10&countryCode=US`, 1);
        const st = STATES[g.state] || g.state; const hit = (r.results || []).find((x) => !st || x.admin1 === st) || null;
        geo[gk] = hit ? [+hit.latitude.toFixed(3), +hit.longitude.toFixed(3)] : 0;
      }
      if (!geo[gk]) return; const [lat, lon] = geo[gk];
      const w = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_gusts_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC&forecast_days=8`, 1);
      const hr = new Date(g.start).toISOString().slice(0, 13) + ':00'; const i = (w.hourly && w.hourly.time || []).indexOf(hr); if (i < 0) return;
      const H = w.hourly; g.wx = { temp: Math.round(H.temperature_2m[i]), wind: Math.round(H.wind_speed_10m[i]), gust: Math.round(H.wind_gusts_10m[i]), precip: H.precipitation_probability[i] ?? null, src: 'Open-Meteo' }; ok++;
    } catch {}
  });
  sources.weather = { ok: true, games: ok, outdoorChecked: todo.length };
}
function snapshot(games, hist) {
  const now = new Date().toISOString().slice(0, 16) + 'Z', out = { updated: now, games: {} }, H = (hist && hist.games) || {};
  for (const k of ['nfl', 'cfb']) for (const g of (games[k] && games[k].games) || []) {
    if (!g.odds || !within(g.start, 10)) continue; const o = g.odds, sp = o.spread && o.spread.home, ml = o.moneyline || {};
    const pt = [now, sp ? sp.line : null, o.total ? o.total.line : null, ml.home ? ml.home.odds : null, ml.away ? ml.away.odds : null];
    const arr = (H[g.id] || []).slice();
    if (!arr.length) { const hs = o.spread && o.spread.home; const op = ['open', hs ? hs.openLine ?? null : null, o.total ? o.total.openLine ?? null : null, ml.home ? ml.home.open ?? null : null, ml.away ? ml.away.open ?? null : null]; if (op.slice(1).some((x) => x != null)) arr.push(op); }
    const last = arr[arr.length - 1];
    if (!last || JSON.stringify(last.slice(1)) !== JSON.stringify(pt.slice(1))) arr.push(pt);
    out.games[g.id] = arr.slice(-40);
  }
  for (const ev of (games.ufc && games.ufc.events) || []) for (const f of ev.fights) {
    if (f.status.state !== 'pre') continue; const [a, b] = f.fighters; if (!a || !b || a.ml == null) continue;
    const id = 'ufc-' + f.id, pt = [now, a.ml, b.ml]; const arr = (H[id] || []).slice(); if (!arr.length && (a.mlOpen != null || b.mlOpen != null)) arr.push(['open', a.mlOpen ?? null, b.mlOpen ?? null]); const last = arr[arr.length - 1];
    if (!last || JSON.stringify(last.slice(1)) !== JSON.stringify(pt.slice(1))) arr.push(pt); out.games[id] = arr.slice(-40);
  }
  return out;
}

async function readOld(name) { try { return await readFile(new URL(name, OUT), 'utf8'); } catch { return null; } }

const [nfl, cfb, mma, nflInj, cfbInj] = await Promise.all([
  football('nfl', 'NFL', 'nfl', ''),
  football('cfb', 'College Football', 'college-football', '?groups=80&limit=300'),
  ufc(),
  injuries('nfl', 'nfl'),
  injuries('cfb', 'college-football'),
]);

const oldGames = JSON.parse((await readOld('games.json')) || '{}');
const oldInj = JSON.parse((await readOld('injuries.json')) || '{}');
// If a source failed this run, keep the last good copy rather than blanking the site.
const games = { nfl: nfl || oldGames.nfl || null, cfb: cfb || oldGames.cfb || null, ufc: mma || oldGames.ufc || null };
let oldMeta = {}; try { oldMeta = JSON.parse((await readOld('meta.json')) || '{}'); } catch {}
let oldOdds = null; try { oldOdds = JSON.parse((await readOld('oddsapi.json')) || 'null'); } catch {}
const oa = await oddsApi(oldMeta, oldOdds);
mergeBooks(games, oa.cache);
let geo = {}; try { geo = JSON.parse((await readOld('geo.json')) || '{}'); } catch {}
let oldHist = null; try { oldHist = JSON.parse((await readOld('history.json')) || 'null'); } catch {}
try { await predictors(games, oldGames); } catch (e) { sources.espn_predictor = { ok: false, error: e.message }; }
try { await weather(games, geo); } catch (e) { sources.weather = { ok: false, error: e.message }; }
const hist = snapshot(games, oldHist);
const oaChanged = JSON.stringify(oa.cache) !== JSON.stringify(oldOdds) || JSON.stringify(oa.info) !== JSON.stringify(oldMeta.oddsApi || {});
const inj = { nfl: nflInj || oldInj.nfl || {}, cfb: cfbInj || oldInj.cfb || {} };
const gStr = JSON.stringify(games), iStr = JSON.stringify(inj);
const changed = gStr !== JSON.stringify(oldGames) || iStr !== JSON.stringify(oldInj) || oaChanged;
await mkdir(OUT, { recursive: true });
if (changed || !(await readOld('meta.json'))) {
  await writeFile(new URL('games.json', OUT), gStr);
  await writeFile(new URL('injuries.json', OUT), iStr);
  if (oa.cache) await writeFile(new URL('oddsapi.json', OUT), JSON.stringify(oa.cache));
  await writeFile(new URL('geo.json', OUT), JSON.stringify(geo));
  await writeFile(new URL('history.json', OUT), JSON.stringify(hist));
  await writeFile(new URL('meta.json', OUT), JSON.stringify({ updated: new Date().toISOString(), oddsApi: oa.info, source: 'ESPN public site API (site.api.espn.com, sports.core.api.espn.com) + The Odds API (DraftKings, FanDuel)', oddsNote: 'Odds provider is labeled exactly as ESPN returns it.', sources }, null, 2));
  console.log('Data changed — files written.');
} else console.log('No data change.');
try { await writeNews(); } catch (e) { console.log('news failed (non-fatal): ' + e.message); }
console.log(JSON.stringify(sources, null, 2));
if (!nfl && !cfb && !mma) process.exitCode = 1;
