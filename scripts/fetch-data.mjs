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
const inj = { nfl: nflInj || oldInj.nfl || {}, cfb: cfbInj || oldInj.cfb || {} };
const gStr = JSON.stringify(games), iStr = JSON.stringify(inj);
const changed = gStr !== JSON.stringify(oldGames) || iStr !== JSON.stringify(oldInj);
await mkdir(OUT, { recursive: true });
if (changed || !(await readOld('meta.json'))) {
  await writeFile(new URL('games.json', OUT), gStr);
  await writeFile(new URL('injuries.json', OUT), iStr);
  await writeFile(new URL('meta.json', OUT), JSON.stringify({ updated: new Date().toISOString(), source: 'ESPN public site API (site.api.espn.com, sports.core.api.espn.com)', oddsNote: 'Odds provider is labeled exactly as ESPN returns it.', sources }, null, 2));
  console.log('Data changed — files written.');
} else console.log('No data change.');
console.log(JSON.stringify(sources, null, 2));
if (!nfl && !cfb && !mma) process.exitCode = 1;
