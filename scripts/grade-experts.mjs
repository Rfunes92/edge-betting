// Grades pending expert picks in data/experts.json against ESPN final scores and recomputes
// each expert's record, hit rate and ROI. Picks it can't parse stay pending for manual grading.
// Structured pick fields used for grading: market (spread|moneyline|total|teamTotal),
// team (name/abbr, for spread/moneyline/teamTotal), side (over|under for totals), line (number),
// espnGameId (optional, fastest), date (YYYY-MM-DD, ET), sport.
import { readFile, writeFile } from 'node:fs/promises';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const PATHS = { NFL: 'football/nfl', 'College Football': 'football/college-football', UFC: 'mma/ufc' };
const FILE = process.env.EXPERTS_FILE ? new URL('file://' + process.env.EXPERTS_FILE) : new URL('../data/experts.json', import.meta.url);
const cache = new Map();

async function getJSON(url) {
  if (cache.has(url)) return cache.get(url);
  const p = fetch(url, { headers: { 'user-agent': 'edge-betting-grader/1.0' }, signal: AbortSignal.timeout(20000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  cache.set(url, p); return p;
}
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const teamMatch = (c, name) => { const n = norm(name); if (!n) return false; const t = c.team || c.athlete || {}; return [t.displayName, t.shortDisplayName, t.name, t.abbreviation, t.location, t.fullName, t.shortName].some((x) => x && (norm(x) === n || (n.length > 4 && norm(x).includes(n)))); };

async function findEvent(p) {
  const path = PATHS[p.sport]; if (!path) return null;
  if (p.espnGameId && p.sport !== 'UFC') { const s = await getJSON(`${SITE}/${path}/summary?event=${p.espnGameId}`); const c = s && s.header && s.header.competitions && s.header.competitions[0]; if (c) return c; }
  if (!p.date) return null;
  const day = p.date.replace(/-/g, '');
  const q = p.sport === 'College Football' ? `?dates=${day}&groups=80&limit=300` : `?dates=${day}`;
  const d = await getJSON(`${SITE}/${path}/scoreboard${q}`); if (!d) return null;
  for (const e of d.events || []) for (const c of e.competitions || []) if ((c.competitors || []).some((x) => teamMatch(x, p.team || p.selection))) return c;
  return null;
}

export function grade(p, c) {
  const st = (c.status || {}).type || {}; if (!(st.completed || st.state === 'post')) return null;
  const comp = c.competitors || []; if (comp.length !== 2) return null;
  const sc = (x) => Number(x.score && typeof x.score === 'object' ? x.score.value ?? x.score.displayValue : x.score);
  const mine = comp.find((x) => teamMatch(x, p.team)); const opp = mine && comp.find((x) => x !== mine);
  const line = Number(p.line);
  const cmp = (v) => (v > 0 ? 'win' : v < 0 ? 'loss' : 'push');
  switch (p.market) {
    case 'moneyline':
      if (!mine) return null;
      if (p.sport === 'UFC') return mine.winner ? 'win' : opp && opp.winner ? 'loss' : null;
      return cmp(sc(mine) - sc(opp));
    case 'spread': if (!mine || !Number.isFinite(line)) return null; return cmp(sc(mine) + line - sc(opp));
    case 'total': { if (!Number.isFinite(line) || !/^(over|under)$/.test(p.side)) return null; const t = sc(comp[0]) + sc(comp[1]); return cmp(p.side === 'over' ? t - line : line - t); }
    case 'teamTotal': { if (!mine || !Number.isFinite(line) || !/^(over|under)$/.test(p.side)) return null; const t = sc(mine); return cmp(p.side === 'over' ? t - line : line - t); }
    default: return null;
  }
}

export function stats(picks) {
  let w = 0, l = 0, pu = 0, pend = 0, risk = 0, profit = 0, assumed = 0;
  for (const p of picks) {
    if (p.result === 'pending' || !p.result) { pend++; continue; }
    if (p.result === 'void') continue;
    const odds = Number.isFinite(Number(p.odds)) && Math.abs(Number(p.odds)) >= 100 ? Number(p.odds) : (assumed++, -110);
    const u = 1; // flat 1u for comparability
    risk += u;
    if (p.result === 'win') { w++; profit += odds > 0 ? u * odds / 100 : u * 100 / -odds; }
    else if (p.result === 'loss') { l++; profit -= u; }
    else pu++;
  }
  const graded = w + l + pu;
  return { wins: w, losses: l, pushes: pu, pending: pend, graded, hitRate: w + l ? +(w / (w + l)).toFixed(4) : null, units: +profit.toFixed(2), roi: risk ? +(profit / risk).toFixed(4) : null, assumedOddsPicks: assumed, method: 'Flat 1u per pick; -110 assumed when odds were not stated.' };
}

const data = JSON.parse(await readFile(FILE, 'utf8'));
const before = JSON.stringify(data.experts);
let graded = 0, left = 0;
for (const ex of data.experts) {
  for (const p of ex.picks || []) {
    if (p.result && p.result !== 'pending') continue;
    if (!p.market || !['spread', 'moneyline', 'total', 'teamTotal'].includes(p.market)) { left++; continue; }
    const c = await findEvent(p); const r = c && grade(p, c);
    if (r) { p.result = r; p.gradedBy = 'auto:espn'; p.gradedAt = new Date().toISOString(); graded++; } else left++;
  }
  ex.record = stats(ex.picks || []);
}
if (JSON.stringify(data.experts) !== before) { data.updated = new Date().toISOString(); await writeFile(FILE, JSON.stringify(data, null, 1)); console.log('experts.json updated'); }
else console.log('No changes');
console.log(`graded ${graded}, still pending ${left}`);
