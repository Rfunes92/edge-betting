/* Edge — Slate: this week's NFL, college and UFC games from data/*.json (ESPN feed). */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let E, games = null, inj = null, meta = null, sport = 'all', upcoming = true, index = {};

  const SITES = {
    NFL: (g) => [
      ['ESPN game page', g.espnUrl], ['NFL.com injuries', 'https://www.nfl.com/injuries/'], ['rbsdm (EPA)', 'https://rbsdm.com/stats/stats/'],
      ['Next Gen Stats', 'https://nextgenstats.nfl.com'], ['Pro-Football-Reference', 'https://www.pro-football-reference.com/boxscores/'],
      ['Action Network splits', 'https://www.actionnetwork.com/nfl/public-betting'], ['Covers matchups', 'https://www.covers.com/sports/nfl/matchups'],
      ['VegasInsider odds', 'https://www.vegasinsider.com/nfl/odds/las-vegas/'], ['SBR line history', 'https://www.sportsbookreview.com/betting-odds/nfl-football/'],
      ['NFLPenalties (refs)', 'https://www.nflpenalties.com'], ['TeamRankings', 'https://www.teamrankings.com/nfl/']],
    'College Football': (g) => [
      ['ESPN game page', g.espnUrl], ['SP+ (Punt and Rally)', 'https://www.puntandrally.com'], ['ESPN FPI', 'https://www.espn.com/college-football/fpi'],
      ['collegefootballdata', 'https://collegefootballdata.com'], [g.away.short + ' on Sports-Reference', 'https://www.sports-reference.com/cfb/search/search.fcgi?search=' + encodeURIComponent(g.away.short || g.away.name)],
      [g.home.short + ' on Sports-Reference', 'https://www.sports-reference.com/cfb/search/search.fcgi?search=' + encodeURIComponent(g.home.short || g.home.name)],
      ['Action Network splits', 'https://www.actionnetwork.com/ncaaf/public-betting'], ['VegasInsider odds', 'https://www.vegasinsider.com/college-football/odds/las-vegas/'],
      ['SBR line history', 'https://www.sportsbookreview.com/betting-odds/college-football/']],
    UFC: (f) => f.fighters.flatMap((x) => {
      const q = encodeURIComponent(x.name); const last = encodeURIComponent(x.name.split(' ').slice(-1)[0]);
      return [[x.name + ' · ESPN', 'https://www.espn.com/mma/fighter/_/id/' + x.id], [x.name + ' · Tapology', 'https://www.tapology.com/search?term=' + q], [x.name + ' · BestFightOdds', 'https://www.bestfightodds.com/search?query=' + q]];
    }).concat([['Sherdog Fight Finder', 'https://www.sherdog.com/stats/fightfinder'], ['Fight Matrix', 'https://www.fightmatrix.com'], ['UFC athletes', 'https://www.ufc.com/athletes']]),
  };

  const darkLogo = (u) => (u ? u.replace('/500/scoreboard/', '/500-dark/scoreboard/').replace(/\/500\/(?!-dark)/, '/500-dark/') : '');
  const logo = (t, cls) => t.logo ? `<img class="${cls || 'tlogo'}" src="${E.esc(darkLogo(t.logo))}" data-fallback="${E.esc(t.logo)}" alt="" loading="lazy" onerror="if(this.dataset.fallback&&this.src!==this.dataset.fallback){this.src=this.dataset.fallback}else{this.style.visibility='hidden'}">` : `<span class="${cls || 'tlogo'} ph">${E.esc((t.abbr || t.name || '?').slice(0, 3))}</span>`;
  const sgn = (n) => (n == null ? '—' : n > 0 ? '+' + n : String(n));
  const O = (o) => (o == null ? '' : E.fmtOdds(o));
  const kick = (iso) => (iso ? E.fmtET(iso) : 'TBD');

  function injSummary(sportKey, teamId) {
    const t = inj && inj[sportKey] && inj[sportKey][teamId]; if (!t) return null;
    const c = { Out: 0, Doubtful: 0, Questionable: 0, IR: 0 };
    t.items.forEach((i) => { const s = (i.status || '').toLowerCase(); if (s.includes('reserve') || s === 'ir' || s.includes('pup')) c.IR++; else if (s.includes('out') || s.includes('suspend')) c.Out++; else if (s.includes('doubt')) c.Doubtful++; else if (s.includes('quest') || s.includes('day-to-day')) c.Questionable++; });
    return c;
  }
  function injBadge(sportKey, t) {
    const c = injSummary(sportKey, t.id); if (!c) return '';
    const parts = []; if (c.Out) parts.push(`<span class="ib out">${c.Out} Out</span>`); if (c.Doubtful) parts.push(`<span class="ib dbt">${c.Doubtful} D</span>`); if (c.Questionable) parts.push(`<span class="ib q">${c.Questionable} Q</span>`);
    return parts.length ? `<span class="ibs">${parts.join('')}</span>` : '';
  }
  function explain(g) {
    const o = g.odds; if (!o) return g.books ? 'ESPN has no line yet; DraftKings and FanDuel prices are above.' : 'No line posted yet.';
    const a = o.spread && o.spread.away && o.spread.away.line, h = o.spread && o.spread.home && o.spread.home.line;
    let s = '';
    if (a != null || h != null) {
      const favAway = a != null ? a < 0 : h > 0; const line = Math.abs(a != null ? a : h);
      const fav = favAway ? g.away : g.home, dog = favAway ? g.home : g.away;
      if (line === 0) s = 'Pick\'em: whoever wins covers.';
      else {
        const half = !Number.isInteger(line); const F = fav.abbr || fav.short, D = dog.abbr || dog.short;
        s = half ? `${F} −${line}: must win by ${Math.ceil(line)}+. ${D} +${line}: covers if it wins or loses by ${Math.floor(line)} or less.`
                 : `${F} −${line}: must win by ${line + 1}+ (win by exactly ${line} = push, stake back). ${D} +${line}: covers if it wins or loses by ${line - 1} or less.`;
      }
    } else if (o.details) s = o.details + '.';
    if (o.total && o.total.line != null) s += ` Total ${o.total.line}: Over needs ${Math.floor(o.total.line) + 1}+ combined points.`;
    return s;
  }
  function mlExplain(name, ml) {
    if (ml == null) return '';
    return ml < 0 ? `${name} ${E.fmtOdds(ml)}: bet $${Math.abs(ml)} to win $100 (${E.pct(E.implied(ml), 0)} implied).` : `${name} ${E.fmtOdds(ml)}: $100 wins $${ml} (${E.pct(E.implied(ml), 0)} implied).`;
  }
  const noVig = (a, b) => { if (!E.validOdds(a) || !E.validOdds(b)) return null; const x = E.implied(a), y = E.implied(b); return { a: x / (x + y), b: y / (x + y), hold: x + y - 1 }; };

  // ---------- DraftKings vs FanDuel (The Odds API) ----------
  const DEC = (o) => (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));
  // Which book gives the bettor the better deal. kind: 'spread' (higher line better), 'over' (lower line better), 'under' (higher), 'ml'.
  function bestBook(dk, fd, kind) {
    if (!dk || !fd || dk.odds == null || fd.odds == null) return null;
    if (kind !== 'ml' && dk.line != null && fd.line != null && dk.line !== fd.line) return (kind === 'over' ? dk.line < fd.line : dk.line > fd.line) ? 'DraftKings' : 'FanDuel';
    return DEC(dk.odds) === DEC(fd.odds) ? null : DEC(dk.odds) > DEC(fd.odds) ? 'DraftKings' : 'FanDuel';
  }
  function bookSides(g) { // normalized {market: {DraftKings:{line,odds}, FanDuel:{...}}}
    const b = g.books || {}; const out = {};
    const put = (k, bk, v) => { if (v && v.odds != null) (out[k] = out[k] || {})[bk] = v; };
    for (const bk of ['DraftKings', 'FanDuel']) { const o = b[bk]; if (!o) continue;
      if (o.spread) { put('spread_away', bk, o.spread.away); put('spread_home', bk, o.spread.home); }
      if (o.ml) { put('ml_away', bk, o.ml.away != null ? { odds: o.ml.away } : null); put('ml_home', bk, o.ml.home != null ? { odds: o.ml.home } : null); }
      if (o.total && o.total.line != null) { put('over', bk, { line: o.total.line, odds: o.total.over }); put('under', bk, { line: o.total.line, odds: o.total.under }); } }
    return out;
  }
  const KIND = (k) => (k.startsWith('spread') ? 'spread' : k.startsWith('ml') ? 'ml' : k);
  const cellTxt = (v, k) => (!v ? '—' : (k.startsWith('spread') ? sgn(v.line) + ' ' : k === 'over' ? 'o' + v.line + ' ' : k === 'under' ? 'u' + v.line + ' ' : '') + E.fmtOdds(v.odds));
  function bookCell(m, k, bk) {
    const v = m && m[bk]; const best = m && bestBook(m.DraftKings, m.FanDuel, KIND(k)) === bk;
    const ln = !v ? '—' : k.startsWith('spread') ? sgn(v.line) : k === 'over' ? 'o' + v.line : k === 'under' ? 'u' + v.line : E.fmtOdds(v.odds);
    const sub = v && !k.startsWith('ml') ? `<small>${E.esc(E.fmtOdds(v.odds))}</small>` : '';
    return `<span class="bkc${best ? ' best' : ''}"${best ? ' title="Best price"' : ''}><b>${E.esc(ln)}</b>${sub}</span>`;
  }
  function cardBooks(g) {
    const s = bookSides(g); if (!Object.keys(s).length) return '';
    const row = (t, side) => `<div class="bk-row"><span class="bk-t">${E.esc(t.abbr || t.short)}</span>${bookCell(s['spread_' + side], 'spread_' + side, 'DraftKings')}${bookCell(s['spread_' + side], 'spread_' + side, 'FanDuel')}${bookCell(s['ml_' + side], 'ml_' + side, 'DraftKings')}${bookCell(s['ml_' + side], 'ml_' + side, 'FanDuel')}</div>`;
    return `<div class="bk"><div class="bk-row bk-h"><span></span><span>Spread DK</span><span>Spread FD</span><span>Win DK</span><span>Win FD</span></div>${row(g.away, 'away')}${row(g.home, 'home')}
      ${s.over ? `<div class="bk-row bk-tot"><span class="bk-t">Total</span>${bookCell(s.over, 'over', 'DraftKings')}${bookCell(s.over, 'over', 'FanDuel')}${bookCell(s.under, 'under', 'DraftKings')}${bookCell(s.under, 'under', 'FanDuel')}</div>` : ''}
      <div class="bk-leg"><span class="bkc best">cyan</span> = best price between DraftKings and FanDuel</div></div>`;
  }
  function sheetBooks(g) {
    const s = bookSides(g); if (!Object.keys(s).length) return '';
    const A = g.away.abbr || g.away.short, H = g.home.abbr || g.home.short;
    const rows = [['spread_away', A + ' spread'], ['spread_home', H + ' spread'], ['ml_away', A + ' to win'], ['ml_home', H + ' to win'], ['over', 'Over'], ['under', 'Under']].filter(([k]) => s[k]);
    return `<div class="sh-sec"><div class="card-label">DraftKings vs FanDuel</div><table class="otbl bktbl"><thead><tr><th>Bet</th><th class="r">DraftKings</th><th class="r">FanDuel</th></tr></thead><tbody>
      ${rows.map(([k, l]) => { const b = bestBook(s[k].DraftKings, s[k].FanDuel, KIND(k)); return `<tr><td>${E.esc(l)}${b ? ` <span class="bp">Best: ${b === 'DraftKings' ? 'DK' : 'FD'}</span>` : ''}</td><td class="r">${bookCell(s[k], k, 'DraftKings')}</td><td class="r">${bookCell(s[k], k, 'FanDuel')}</td></tr>`; }).join('')}
      </tbody></table><p class="muted small">Prices via The Odds API${g.booksUpdated ? ', pulled ' + E.esc(E.fmtET(g.booksUpdated)) : ''}. Always confirm in the app before betting.</p></div>`;
  }
  function fighterBooks(x, o) {
    const b = x.books; if (!b || (b.DraftKings == null && b.FanDuel == null)) return '';
    const m = { DraftKings: b.DraftKings != null ? { odds: b.DraftKings } : null, FanDuel: b.FanDuel != null ? { odds: b.FanDuel } : null };
    const best = bestBook(m.DraftKings, m.FanDuel, 'ml');
    return `<div class="fbk"><span class="bkc${best === 'DraftKings' ? ' best' : ''}">DK ${b.DraftKings != null ? E.esc(E.fmtOdds(b.DraftKings)) : '—'}</span><span class="bkc${best === 'FanDuel' ? ' best' : ''}">FD ${b.FanDuel != null ? E.esc(E.fmtOdds(b.FanDuel)) : '—'}</span></div>`;
  }
  window.EdgeBooks = { bestBook, bookSides, DEC };

  // ---------- Research extras: weather, fair price, model vs market, line history ----------
  function wxBadge(g) {
    if (g.indoor) return '<span class="wx">Dome</span>';
    const w = g.wx; if (!w) return '';
    const warn = w.wind >= 15 || w.gust >= 25 || (w.precip != null && w.precip >= 50);
    return `<span class="wx${warn ? ' warn' : ''}" title="Kickoff forecast (Open-Meteo)">${w.wind}mph${w.gust >= w.wind + 8 ? '/' + w.gust : ''} · ${w.temp}°${w.precip ? ' · ' + w.precip + '%☂' : ''}</span>`;
  }
  const pairNV = (a, b) => (E.validOdds(a) && E.validOdds(b) ? noVig(a, b) : null);
  // Market win chance with the bookmaker's cut removed, averaged over DK and FD (falls back to ESPN's line).
  function marketProb(g) {
    const bs = []; for (const bk of ['DraftKings', 'FanDuel']) { const o = g.books && g.books[bk]; const nv = o && o.ml && pairNV(o.ml.away, o.ml.home); if (nv) bs.push(nv); }
    if (!bs.length) { const ml = (g.odds && g.odds.moneyline) || {}; const nv = pairNV(ml.away && ml.away.odds, ml.home && ml.home.odds); if (nv) bs.push(nv); }
    if (!bs.length) return null; return { away: bs.reduce((s, x) => s + x.a, 0) / bs.length, home: bs.reduce((s, x) => s + x.b, 0) / bs.length, n: bs.length };
  }
  function bestML(g, side) {
    const c = []; for (const bk of ['DraftKings', 'FanDuel']) { const o = g.books && g.books[bk]; if (o && o.ml && E.validOdds(o.ml[side])) c.push([bk, o.ml[side]]); }
    if (!c.length) { const ml = g.odds && g.odds.moneyline && g.odds.moneyline[side]; if (ml && E.validOdds(ml.odds)) c.push([g.odds.provider || 'ESPN', ml.odds]); }
    return c.sort((a, b) => DEC(b[1]) - DEC(a[1]))[0] || null;
  }
  const toAm = (p) => (E.probToAmerican ? E.probToAmerican(p) : null);
  const ev = (p, odds) => p * DEC(odds) - 1;
  function valueRows() {
    const rows = [];
    for (const k of ['nfl', 'cfb']) for (const g of (games && games[k] && games[k].games) || []) {
      if (!g.model || g.status.state !== 'pre') continue; const mk = marketProb(g); if (!mk) continue;
      for (const side of ['away', 'home']) { const gap = g.model[side] - mk[side]; const b = bestML(g, side); if (gap >= 0.05 && b) rows.push({ g, k, side, gap, model: g.model[side], mkt: mk[side], book: b[0], odds: b[1], ev: ev(g.model[side], b[1]) }); }
    }
    return rows.sort((a, b) => b.gap - a.gap);
  }
  function renderValue() {
    const el = $('valueBoard'); if (!el || !games) return;
    const sk = Object.keys({ all: 1, nfl: 1, cfb: 1 }).includes(sportKeyLocal()) ? sportKeyLocal() : null;
    const rows = valueRows().filter((r) => !sk || sk === 'all' || r.k === sk).slice(0, 6);
    $('valueSec').hidden = sk === null;
    rows.forEach((r) => (index[r.g.id] = { type: 'fb', g: r.g, key: r.k }));
    el.innerHTML = rows.length ? rows.map((r) => { const t = r.g[r.side], o = r.g[r.side === 'away' ? 'home' : 'away'];
      return `<button class="vb-row" data-key="${E.esc(r.g.id)}"><span class="vb-team">${logo(t)}<span><b>${E.esc(t.short || t.name)}</b> <span class="muted small">${r.side === 'away' ? '@' : 'vs'} ${E.esc(o.abbr || o.short)}</span><br><span class="muted small">${E.esc(r.k === 'nfl' ? 'NFL' : 'College')} · ${kick(r.g.start)}</span></span></span>
        <span class="vb-num"><small>ESPN model</small><b>${E.pct(r.model, 0)}</b></span><span class="vb-num"><small>Market</small><b>${E.pct(r.mkt, 0)}</b></span>
        <span class="vb-num gap"><small>Gap</small><b>+${Math.round(r.gap * 100)}</b></span><span class="vb-num"><small>Best ML</small><b class="cy">${E.esc(E.fmtOdds(r.odds))}</b><small>${E.esc(r.book === 'DraftKings' ? 'DK' : r.book === 'FanDuel' ? 'FD' : r.book)}</small></span></button>`; }).join('')
      : '<div class="empty">No model-vs-market gaps of 5+ points right now.</div>';
  }
  const sportKeyLocal = () => sportKey();
  let hist = null, histLoading = null;
  function loadHist() { if (hist || histLoading) return histLoading; histLoading = fetch('data/history.json?t=' + Math.floor(Date.now() / 6e5)).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => { hist = j || { games: {} }; return hist; }); return histLoading; }
  function spark(pts, label, fmt) {
    const v = pts.map((p) => p[1]).filter((x) => x != null); if (v.length < 2) return '';
    const W = 260, Hh = 46, min = Math.min(...v), max = Math.max(...v), rng = max - min || 1;
    const xy = pts.filter((p) => p[1] != null).map((p, i, a) => [(i / (a.length - 1)) * (W - 8) + 4, Hh - 6 - ((p[1] - min) / rng) * (Hh - 14)]);
    return `<div class="spark"><div class="sp-l"><span>${E.esc(label)}</span><b>${E.esc(fmt(v[0]))} → ${E.esc(fmt(v[v.length - 1]))}</b></div><svg viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="#00e5ff" stroke-width="2" points="${xy.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')}"/>${xy.map((p, i) => i === xy.length - 1 ? `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="#00e5ff"/>` : '').join('')}</svg></div>`;
  }
  async function fillHistory(id, kind, names) {
    const el = $('shHist'); if (!el) return; const h = await loadHist(); const arr = (h && h.games && h.games[id]) || [];
    if (arr.length < 2) { el.innerHTML = `<p class="muted small">History builds from our own 3-hour snapshots (${arr.length} so far). Check back after a few updates.</p>`; return; }
    const pick = (i) => arr.map((p) => [p[0], p[i]]);
    el.innerHTML = (kind === 'fb' ? spark(pick(1), names[0] + ' spread', sgn) + spark(pick(2), 'Total', String) + spark(pick(3), names[0] + ' moneyline', E.fmtOdds)
      : spark(pick(1), names[0], E.fmtOdds) + spark(pick(2), names[1], E.fmtOdds)) + `<p class="muted small">${arr.length} points since ${arr[0][0] === 'open' ? 'the opening line' : E.esc(E.fmtET(arr[0][0]))} (ESPN/DraftKings line, snapshot every 3h).</p>`;
  }
  function sheetModel(g) {
    const mk = marketProb(g); const A = g.away.abbr || g.away.short, H = g.home.abbr || g.home.short;
    if (!g.model && !mk) return '';
    const row = (side, nm) => { const b = bestML(g, side); const m = g.model ? g.model[side] : null, k = mk ? mk[side] : null; const fair = k != null ? toAm(k) : null;
      return `<tr><td>${E.esc(nm)}</td><td class="r">${m != null ? E.pct(m, 0) : '—'}</td><td class="r">${k != null ? E.pct(k, 0) : '—'}</td><td class="r">${fair != null ? E.esc(E.fmtOdds(fair)) : '—'}</td><td class="r">${b ? `<span class="cy">${E.esc(E.fmtOdds(b[1]))}</span>` : '—'}</td><td class="r ${k != null && b ? (ev(k, b[1]) >= 0 ? 'pos' : 'muted') : ''}">${k != null && b ? (ev(k, b[1]) * 100).toFixed(1) + '%' : '—'}</td></tr>`; };
    return `<div class="sh-sec"><div class="card-label">Fair price & model check</div><table class="otbl fair"><thead><tr><th>Win</th><th class="r">ESPN model</th><th class="r">Market</th><th class="r">Fair</th><th class="r">Best</th><th class="r">Edge</th></tr></thead><tbody>${row('away', A)}${row('home', H)}</tbody></table>
      <p class="muted small"><b>Market</b> = win chance from the moneylines with the book's cut removed${mk && mk.n === 2 ? ' (DK and FD averaged)' : ''}. <b>Fair</b> = that chance as odds. <b>Edge</b> = what the best available price pays vs fair; near 0% or negative is normal. ESPN's model can miss late news, so a big model gap is a lead to check, not a bet.</p></div>`;
  }

  // ---------- Cards ----------
  function footballCard(g, key) {
    const o = g.odds || {}; const sp = o.spread || {}, ml = o.moneyline || {};
    const row = (t, side) => `<div class="tm"><div class="tm-id">${logo(t)}<div class="tm-name"><div>${t.rank ? `<span class="rk">${t.rank}</span>` : ''}${E.esc(t.short || t.name)}${g.status.state !== 'pre' && t.score != null ? ` <b class="score">${t.score}</b>` : ''}</div><div class="tm-sub">${E.esc(t.record || '')} ${injBadge(key, t)}</div></div></div>
      <div class="oc"><span>${sp[side] && sp[side].line != null ? sgn(sp[side].line) : '—'}</span><small>${sp[side] ? O(sp[side].odds) : ''}</small></div>
      <div class="oc"><span>${ml[side] && ml[side].odds != null ? O(ml[side].odds) : '—'}</span><small>${ml[side] && ml[side].odds != null ? E.pct(E.implied(ml[side].odds), 0) : ''}</small></div></div>`;
    const live = g.status.state === 'in', fin = g.status.state === 'post';
    return `<button class="game" data-key="${E.esc(g.id)}">
      <div class="g-top"><span class="tag">${g.sport === 'NFL' ? 'NFL' : 'College'}</span>${wxBadge(g)}<span class="g-time${live ? ' live' : ''}">${live ? 'LIVE · ' + E.esc(g.status.detail) : fin ? 'Final' : kick(g.start)}</span></div>
      <div class="g-head"><span></span><span>Spread</span><span>Win (ML)</span></div>
      ${row(g.away, 'away')}${row(g.home, 'home')}
      ${g.status.state === 'pre' ? cardBooks(g) : ''}
      <div class="g-foot"><span>${o.total && o.total.line != null ? `Total <b>${o.total.line}</b>` : ''}${o.total && o.total.openLine != null && o.total.openLine !== o.total.line ? ` <span class="mv">(opened ${o.total.openLine})</span>` : ''}</span><span class="prov">${o.provider ? 'Odds: ' + E.esc(o.provider) : g.books ? 'DK/FD via The Odds API' : 'No odds yet'}</span></div>
      <div class="g-explain">${E.esc(explain(g))}</div></button>`;
  }
  function fighter(f, side) {
    return `<div class="ft ${side}"><div class="hs-wrap">${f.headshot ? `<img class="hs" src="${E.esc(f.headshot)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'hs ph',textContent:'${E.esc((f.name || '?')[0])}'}))">` : `<span class="hs ph">${E.esc((f.name || '?')[0])}</span>`}</div>
      <div class="ft-name">${E.esc(f.name)}</div><div class="tm-sub">${E.esc(f.record || '')}${f.country ? ' · ' + E.esc(f.country) : ''}</div>
      <div class="ft-ml">${f.ml != null ? O(f.ml) : '—'}</div><div class="tm-sub">${f.ml != null ? E.pct(E.implied(f.ml), 0) + ' implied' : 'no line'}</div>${fighterBooks(f)}</div>`;
  }
  function fightCard(ev, f, i) {
    const [a, b] = f.fighters; if (!a || !b) return '';
    const fin = f.status.state === 'post';
    return `<button class="game fight" data-key="${E.esc(ev.id + ':' + f.id)}">
      <div class="g-top"><span class="tag">UFC${i === 0 ? ' · Main event' : ''}</span><span class="g-time">${fin ? 'Final' : kick(f.start)}</span></div>
      <div class="wc">${E.esc(f.weightClass || '')}</div>
      <div class="ft-row">${fighter(a, 'l')}<div class="vs">vs</div>${fighter(b, 'r')}</div>
      <div class="g-foot"><span>${f.odds && f.odds.rounds != null ? `Rounds O/U <b>${f.odds.rounds}</b>` : ''}</span><span class="prov">${f.odds && f.odds.provider ? 'Odds: ' + E.esc(f.odds.provider) : 'No odds yet'}</span></div>
      <div class="g-explain">${E.esc(a.ml != null && b.ml != null ? (a.ml < b.ml ? mlExplain(a.short || a.name, a.ml) : mlExplain(b.short || b.name, b.ml)) : 'Moneyline = who wins the fight.')}</div></button>`;
  }

  function render() {
    const list = $('slateList'); if (!list) return;
    if (!games) { list.innerHTML = '<div class="empty">Couldn\'t load the slate right now. Try again later.</div>'; return; }
    const out = [];
    const fb = (blk, key) => {
      if (!blk || !blk.games) return;
      const gs = blk.games.filter((g) => (!upcoming || g.status.state !== 'post')).sort((x, y) => new Date(x.start) - new Date(y.start));
      gs.forEach((g) => (index[g.id] = { type: 'fb', g, key }));
      if (!gs.length) return;
      const label = key === 'nfl' ? `NFL${blk.week ? ' · Week ' + blk.week : ''}` : `College football${blk.week ? ' · Week ' + blk.week : ''} · FBS`;
      out.push(`<div class="slate-group"><div class="sg-head">${label}<span>${gs.length} game${gs.length === 1 ? '' : 's'}</span></div><div class="games">${gs.map((g) => footballCard(g, key)).join('')}</div>${key === 'nfl' && blk.byes && blk.byes.length ? `<p class="muted small">On bye: ${blk.byes.map(E.esc).join(', ')}</p>` : ''}</div>`);
    };
    if (sport === 'all' || sport === 'NFL') fb(games.nfl, 'nfl');
    if (sport === 'all' || sport === 'College Football') fb(games.cfb, 'cfb');
    if ((sport === 'all' || sport === 'UFC') && games.ufc) games.ufc.events.forEach((ev) => {
      const fs = ev.fights.filter((f) => !upcoming || f.status.state !== 'post');
      fs.forEach((f) => (index[ev.id + ':' + f.id] = { type: 'ufc', ev, f }));
      if (fs.length) out.push(`<div class="slate-group"><div class="sg-head">${E.esc(ev.name)}<span>${E.esc([ev.venue, ev.city].filter(Boolean).join(' · '))}</span></div><div class="games">${fs.map((f) => fightCard(ev, f, ev.fights.indexOf(f))).join('')}</div></div>`);
    });
    list.innerHTML = out.length ? out.join('') : '<div class="empty">No upcoming games in this filter.</div>';
  }

  // ---------- Detail sheet ----------
  function oddsRow(label, sel, line, odds, openLine, openOdds, shop) {
    const moved = openLine != null && line != null && openLine !== line ? `<span class="mv">opened ${E.esc(sgn(openLine))}${openOdds != null ? ' (' + O(openOdds) + ')' : ''}</span>` : openOdds != null && odds != null && openOdds !== odds ? `<span class="mv">opened ${O(openOdds)}</span>` : '';
    return `<tr><td>${E.esc(label)}<div class="tm-sub">${moved}</div></td><td class="r"><b>${line != null ? E.esc(typeof line === 'number' ? sgn(line) : line) : ''}</b> ${odds != null ? O(odds) : '—'}</td><td class="r muted">${odds != null ? E.pct(E.implied(odds), 1) : ''}</td><td class="r">${shop ? `<button class="btn btn-sm" data-shop='${E.esc(JSON.stringify(shop))}'>Shop</button>` : ''}</td></tr>`;
  }
  function injList(key, t) {
    const d = inj && inj[key] && inj[key][t.id];
    if (!d || !d.items.length) return `<p class="muted small">No injuries listed by ESPN.</p>`;
    const sev = (st) => (/out|susp/i.test(st) ? 0 : /doubt/i.test(st) ? 1 : /quest|day/i.test(st) ? 2 : 3);
    const act = d.items.filter((i) => !/reserve|pup/i.test(i.status)).sort((x, y) => sev(x.status) - sev(y.status)); const ir = d.items.length - act.length;
    return `<div class="inj">${act.map((i) => `<div class="inj-row">${i.headshot ? `<img src="${E.esc(i.headshot)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span class="inj-ph"></span>'}<div><div><b>${E.esc(i.name)}</b> <span class="muted small">${E.esc(i.pos)}</span> <span class="ib ${['out', 'dbt', 'q', 'ok'][sev(i.status)]}">${E.esc(i.status)}</span></div>${i.injury ? `<div class="tm-sub">${E.esc(i.injury)}</div>` : ''}${i.note ? `<div class="inj-note">${E.esc(i.note)}</div>` : ''}</div></div>`).join('') || '<p class="muted small">Nobody listed as Out/Doubtful/Questionable.</p>'}${ir ? `<p class="muted small">+ ${ir} on IR / reserve lists</p>` : ''}</div>`;
  }
  function links(arr) { return `<div class="link-row">${arr.filter(([, u]) => u).map(([n, u]) => `<a class="btn btn-sm" href="${E.esc(u)}" target="_blank" rel="noopener">${E.esc(n)} ↗</a>`).join('')}</div>`; }

  function openSheet(key) {
    const it = index[key]; if (!it) return; let html = '';
    if (it.type === 'fb') {
      const g = it.g, o = g.odds || {}, sp = o.spread || {}, ml = o.moneyline || {}, t = o.total || {};
      const isDK = /draftkings/i.test(o.provider || '');
      const ev = `${g.away.short || g.away.name} @ ${g.home.short || g.home.name}`;
      const shop = (market, sel, dk, dko) => (isDK && E.validOdds(dk) ? { event: ev, sport: g.sport, market, sel, dk, dko } : null);
      const nv = noVig(ml.away && ml.away.odds, ml.home && ml.home.odds);
      html = `<div class="sh-head"><div class="sh-teams">${logo(g.away, 'tlogo lg')}<span class="vs">@</span>${logo(g.home, 'tlogo lg')}</div>
        <h3 id="sheetTitle">${E.esc(g.away.name)} @ ${E.esc(g.home.name)}</h3><div class="muted small">${kick(g.start)}${g.venue ? ' · ' + E.esc(g.venue) : ''}${g.neutral ? ' (neutral)' : ''}${g.broadcast ? ' · ' + E.esc(g.broadcast) : ''}</div></div>
        <div class="sh-sec"><div class="card-label">Odds ${o.provider ? '· ' + E.esc(o.provider) + ' via ESPN' : ''}</div>
        ${g.odds ? `<table class="otbl"><thead><tr><th>Bet</th><th class="r">Price</th><th class="r">Implied</th><th></th></tr></thead><tbody>
          ${sp.away ? oddsRow(g.away.abbr + ' spread', '', sp.away.line, sp.away.odds, sp.away.openLine, sp.away.openOdds, shop('spread', `${g.away.abbr} ${sgn(sp.away.line)}`, sp.away.odds, sp.home && sp.home.odds)) : ''}
          ${sp.home ? oddsRow(g.home.abbr + ' spread', '', sp.home.line, sp.home.odds, sp.home.openLine, sp.home.openOdds, shop('spread', `${g.home.abbr} ${sgn(sp.home.line)}`, sp.home.odds, sp.away && sp.away.odds)) : ''}
          ${ml.away ? oddsRow(g.away.abbr + ' to win', '', null, ml.away.odds, null, ml.away.open, shop('moneyline', `${g.away.abbr} ML`, ml.away.odds, ml.home && ml.home.odds)) : ''}
          ${ml.home ? oddsRow(g.home.abbr + ' to win', '', null, ml.home.odds, null, ml.home.open, shop('moneyline', `${g.home.abbr} ML`, ml.home.odds, ml.away && ml.away.odds)) : ''}
          ${t.line != null ? oddsRow('Over', '', 'o' + t.line, t.overOdds, t.openLine != null ? 'o' + t.openLine : null, null, shop('total', `Over ${t.line}`, t.overOdds, t.underOdds)) : ''}
          ${t.line != null ? oddsRow('Under', '', 'u' + t.line, t.underOdds, t.openLine != null ? 'u' + t.openLine : null, null, shop('total', `Under ${t.line}`, t.underOdds, t.overOdds)) : ''}
        </tbody></table>
        <p class="explain">${E.esc(explain(g))}</p>
        ${nv ? `<p class="muted small">No-vig win chance (from moneylines): ${E.esc(g.away.abbr)} ${E.pct(nv.a)} · ${E.esc(g.home.abbr)} ${E.pct(nv.b)} · book's cut ${E.pct(nv.hold)}</p>` : ''}
        ${g.books ? '' : `<p class="muted small">This is one book's price. "Shop" copies it into the Line shop so you can add FanDuel's number and compare.</p>`}` : '<p class="muted small">No line posted yet.</p>'}</div>
        ${sheetBooks(g)}
        ${sheetModel(g)}
        ${g.wx ? `<div class="sh-sec"><div class="card-label">Kickoff weather</div><p class="small">${g.wx.temp}°F · wind ${g.wx.wind} mph (gusts ${g.wx.gust}) · rain chance ${g.wx.precip ?? '—'}% <span class="muted">· Open-Meteo forecast</span></p>${g.wx.wind >= 15 || g.wx.gust >= 25 ? '<p class="muted small">Strong wind tends to hurt passing and kicking, which can push totals down. Check the forecast again close to kickoff.</p>' : ''}</div>` : g.indoor ? '<div class="sh-sec"><div class="card-label">Kickoff weather</div><p class="small muted">Indoor stadium: weather is not a factor.</p></div>' : ''}
        <div class="sh-sec"><div class="card-label">Line movement</div><div id="shHist"><p class="muted small">Loading…</p></div></div>
        <div class="sh-sec"><div class="card-label">${E.esc(g.away.short || g.away.name)} injuries</div>${injList(it.key, g.away)}</div>
        <div class="sh-sec"><div class="card-label">${E.esc(g.home.short || g.home.name)} injuries</div>${injList(it.key, g.home)}</div>
        <div class="sh-sec"><div class="card-label">Research this matchup</div>${links(SITES[g.sport](g))}</div>`;
    } else {
      const f = it.f, [a, b] = f.fighters, o = f.odds || {};
      const isDK = /draftkings/i.test(o.provider || '');
      const ev = `${a.name} vs ${b.name}`;
      const nv = noVig(a.ml, b.ml);
      const tape = [['Record', 'wld', 'record'], ['KO/TKO (W-L)', 'ko'], ['Submissions (W-L)', 'sub'], ['Age', 'age'], ['Height', 'height'], ['Reach', 'reach'], ['Stance', 'stance'], ['Style', 'style']];
      html = `<div class="sh-head"><div class="sh-fighters">${fighter(a, 'l')}<div class="vs">vs</div>${fighter(b, 'r')}</div>
        <h3 id="sheetTitle">${E.esc(ev)}</h3><div class="muted small">${E.esc(f.weightClass || '')} · ${kick(f.start)} · ${E.esc(it.ev.name)}</div></div>
        <div class="sh-sec"><div class="card-label">Tale of the tape</div><table class="otbl tape"><tbody>${tape.map(([l, k, k2]) => `<tr><td class="r">${E.esc(a[k] ?? (k2 ? a[k2] : '') ?? '—')}</td><td class="c muted">${l}</td><td>${E.esc(b[k] ?? (k2 ? b[k2] : '') ?? '—')}</td></tr>`).join('')}</tbody></table></div>
        <div class="sh-sec"><div class="card-label">Odds ${o.provider ? '· ' + E.esc(o.provider) + ' via ESPN' : ''}</div>
        <table class="otbl"><tbody>
          ${oddsRow(a.name, '', null, a.ml, null, a.mlOpen, isDK && E.validOdds(a.ml) ? { event: ev, sport: 'UFC', market: 'moneyline', sel: a.name, dk: a.ml, dko: b.ml } : null)}
          ${oddsRow(b.name, '', null, b.ml, null, b.mlOpen, isDK && E.validOdds(b.ml) ? { event: ev, sport: 'UFC', market: 'moneyline', sel: b.name, dk: b.ml, dko: a.ml } : null)}
          ${o.rounds != null ? oddsRow('Over ' + o.rounds + ' rounds', '', null, o.overOdds, null, null, null) + oddsRow('Under ' + o.rounds + ' rounds', '', null, o.underOdds, null, null, null) : ''}
        </tbody></table>
        <p class="explain">${E.esc([mlExplain(a.short || a.name, a.ml), mlExplain(b.short || b.name, b.ml)].filter(Boolean).join(' '))}</p>
        ${nv ? `<p class="muted small">No-vig win chance: ${E.esc(a.short)} ${E.pct(nv.a)} · ${E.esc(b.short)} ${E.pct(nv.b)} · book's cut ${E.pct(nv.hold)}</p>` : ''}
        <p class="muted small">Check weigh-in results Friday. A missed weight or a late replacement changes everything.</p></div>
        ${a.books || b.books ? `<div class="sh-sec"><div class="card-label">DraftKings vs FanDuel</div><table class="otbl bktbl"><thead><tr><th>Fighter</th><th class="r">DraftKings</th><th class="r">FanDuel</th></tr></thead><tbody>${[a, b].map((x) => { const m = { DraftKings: x.books && x.books.DraftKings != null ? { odds: x.books.DraftKings } : null, FanDuel: x.books && x.books.FanDuel != null ? { odds: x.books.FanDuel } : null }; const bb = bestBook(m.DraftKings, m.FanDuel, 'ml'); return `<tr><td>${E.esc(x.name)}${bb ? ` <span class="bp">Best: ${bb === 'DraftKings' ? 'DK' : 'FD'}</span>` : ''}</td><td class="r">${bookCell(m, 'ml', 'DraftKings')}</td><td class="r">${bookCell(m, 'ml', 'FanDuel')}</td></tr>`; }).join('')}</tbody></table><p class="muted small">Prices via The Odds API. Confirm in the app before betting.</p></div>` : ''}
        <div class="sh-sec"><div class="card-label">Line movement</div><div id="shHist"><p class="muted small">Loading…</p></div></div>
        <div class="sh-sec"><div class="card-label">Research this fight</div>${links(SITES.UFC(f))}</div>`;
    }
    $('sheetBody').innerHTML = html;
    if (it.type === 'fb') fillHistory(it.g.id, 'fb', [it.g.home.abbr || it.g.home.short]); else fillHistory('ufc-' + it.f.id, 'ufc', it.f.fighters.map((x) => x.short || x.name));
    const sh = $('sheet'); sh.hidden = false; sh.setAttribute('aria-hidden', 'false'); document.body.classList.add('no-scroll');
    requestAnimationFrame(() => sh.classList.add('open'));
    sh.querySelector('.sheet-panel').scrollTop = 0;
  }
  function closeSheet() { const sh = $('sheet'); sh.classList.remove('open'); document.body.classList.remove('no-scroll'); setTimeout(() => { sh.hidden = true; sh.setAttribute('aria-hidden', 'true'); }, 250); }
  function shop(d) {
    closeSheet(); location.hash = '#lineshop';
    setTimeout(() => {
      $('lsEvent').value = d.event || ''; $('lsSel').value = d.sel || ''; $('lsSport').value = d.sport; $('lsMarket').value = d.market;
      $('lsDK').value = d.dk != null ? d.dk : ''; $('lsDKo').value = d.dko != null ? d.dko : ''; $('lsFD').value = ''; $('lsFDo').value = '';
      $('lsForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('lsFD').focus({ preventScroll: true });
      E.toast('DraftKings price copied. Add FanDuel\'s number, then tap Add row.');
    }, 80);
  }

  async function load() {
    const get = (f) => fetch('data/' + f + '?t=' + Math.floor(Date.now() / 6e5), { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    [games, inj, meta] = await Promise.all([get('games.json'), get('injuries.json'), get('meta.json')]);
    if (meta && meta.updated) $('slateUpdated').textContent = 'Updated ' + E.fmtET(meta.updated);
    render(); renderHome(); renderInjuries(true); counts();
    window.EdgeData = { games, inj, meta };
    document.dispatchEvent(new Event('edge:data'));
  }
  function renderHome() {
    renderValue();
    const hs = $('homeSlate'); if (!hs || !games) return;
    const up = [];
    ['nfl', 'cfb'].forEach((k) => (games[k] && games[k].games || []).forEach((g) => { if (g.status.state === 'pre') { up.push({ g, k }); index[g.id] = { type: 'fb', g, key: k }; } }));
    up.sort((a, b) => new Date(a.g.start) - new Date(b.g.start));
    const sk = sportKey(), n = sk === 'all' ? 2 : 4;
    const nfl = sk === 'all' || sk === 'nfl' ? up.filter((x) => x.k === 'nfl').slice(0, n) : [];
    const cfb = sk === 'all' || sk === 'cfb' ? up.filter((x) => x.k === 'cfb' && (sk === 'cfb' || x.g.home.rank || x.g.away.rank)).slice(0, n) : [];
    let html = [...nfl, ...cfb].map((x) => footballCard(x.g, x.k)).join('');
    const ev = games.ufc && games.ufc.events[0];
    if (ev && (sk === 'all' || sk === 'ufc')) ev.fights.filter((f) => f.status.state === 'pre').slice(0, sk === 'ufc' ? 4 : 1).forEach((f) => { index[ev.id + ':' + f.id] = { type: 'ufc', ev, f }; html += fightCard(ev, f, ev.fights.indexOf(f)); });
    hs.innerHTML = html || '<div class="empty">No upcoming games in the feed.</div>';
    const fg = $('freshGrid');
    if (fg) {
      const src = (meta && meta.sources) || {}; const c = (k, f) => (src[k] && src[k].ok ? src[k][f] : '—');
      $('freshUpdated').textContent = meta && meta.updated ? 'Feed updated ' + E.fmtET(meta.updated) : '';
      const tiles = [['NFL games', c('nfl_scoreboard', 'count'), `${c('nfl_scoreboard', 'withOdds')} with odds`, '#slate'], ['College games', c('cfb_scoreboard', 'count'), `${c('cfb_scoreboard', 'withOdds')} with odds`, '#slate'],
        ['UFC fights', c('ufc_scoreboard', 'fights'), `${c('ufc_scoreboard', 'withOdds')} with odds`, '#slate'], ['NFL injuries', c('nfl_injuries', 'players'), `${c('nfl_injuries', 'teams')} teams`, '#injuries']];
      fg.innerHTML = tiles.map(([l, v, sub, h]) => `<a class="kpi fresh-tile" href="${h}"><div class="kpi-label">${l}</div><div class="kpi-val">${E.esc(v)}</div><div class="kpi-sub">${E.esc(sub)}</div></a>`).join('') + `<p class="muted small fresh-note">Odds via ESPN (${E.esc(((games.nfl && games.nfl.games.find((g) => g.odds)) || {}).odds?.provider || 'provider as listed')}). Refreshes every 3 hours.</p>`;
    }
  }
  let injSport = 'nfl';
  function renderInjuries(rebuildTeams) {
    const list = $('injList'); if (!list) return;
    if (meta && meta.updated) $('injUpdated').textContent = 'Updated ' + E.fmtET(meta.updated);
    const data = (inj && inj[injSport]) || {};
    const teams = Object.entries(data).sort((a, b) => a[1].team.localeCompare(b[1].team));
    if (rebuildTeams) { const sel = $('injTeam'); sel.innerHTML = '<option value="">All teams</option>' + teams.map(([id, t]) => `<option value="${E.esc(id)}">${E.esc(t.team)}</option>`).join(''); }
    const team = $('injTeam').value, mode = $('injStatus').value;
    const sev = (st) => (/reserve|pup/i.test(st) ? 4 : /out|susp/i.test(st) ? 0 : /doubt/i.test(st) ? 1 : /quest|day/i.test(st) ? 2 : 3);
    const keep = (i) => { const v = sev(i.status); return mode === 'all' ? true : mode === 'out' ? v === 0 : v <= 2; };
    const html = teams.filter(([id]) => !team || id === team).map(([id, t]) => {
      const items = t.items.filter(keep).sort((a, b) => sev(a.status) - sev(b.status)); if (!items.length) return '';
      return `<div class="card inj-team"><div class="card-label">${E.esc(t.team)} <span class="muted">· ${items.length}</span></div>${items.map((i) => `<div class="inj-row">${i.headshot ? `<img src="${E.esc(i.headshot)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span class="inj-ph"></span>'}<div><div><b>${E.esc(i.name)}</b> <span class="muted small">${E.esc(i.pos)}</span> <span class="ib ${['out', 'dbt', 'q', 'ok', 'q'][sev(i.status)]}">${E.esc(i.status)}</span></div>${i.injury ? `<div class="tm-sub">${E.esc(i.injury)}${i.date ? ' · ' + E.esc(E.fmtET(i.date)) : ''}</div>` : ''}${i.note ? `<div class="inj-note">${E.esc(i.note)}</div>` : ''}</div></div>`).join('')}</div>`;
    }).join('');
    list.innerHTML = html || `<div class="empty">${teams.length ? 'Nobody matches this filter.' : 'No injury data from ESPN for this league right now.'}</div>`;
  }
  // ---------- Sport selector (left rail / sticky bar) ----------
  const SK = { all: 'all', nfl: 'nfl', cfb: 'cfb', college: 'cfb', ufc: 'ufc' };
  const SPORT = { all: 'all', nfl: 'NFL', cfb: 'College Football', ufc: 'UFC' };
  const LS_KEY = 'edge.sport';
  const sportKey = () => Object.keys(SPORT).find((k) => SPORT[k] === sport) || 'all';
  function setSport(k, scroll) {
    sport = SPORT[k] || 'all';
    try { localStorage.setItem(LS_KEY, k); } catch (e) {}
    document.querySelectorAll('#sportNav .sn').forEach((a) => { const on = a.dataset.sk === k; a.classList.toggle('active', on); a.toggleAttribute('aria-current', on); });
    if ((k === 'nfl' || k === 'cfb') && typeof injSport !== 'undefined' && injSport !== k) { const ic = document.querySelector('#injSport .chip[data-s="' + k + '"]'); if (ic) ic.click(); }
    if (games) { render(); renderHome(); }
    window.EdgeSport = k; document.dispatchEvent(new CustomEvent('edge:sport', { detail: k }));
    if (scroll) setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 40);
  }
  function counts() {
    if (!games) return;
    const live = (g) => !upcoming || g.status.state !== 'post';
    const c = { nfl: ((games.nfl && games.nfl.games) || []).filter(live).length, cfb: ((games.cfb && games.cfb.games) || []).filter(live).length,
      ufc: ((games.ufc && games.ufc.events) || []).reduce((n, ev) => n + ev.fights.filter(live).length, 0) };
    c.all = c.nfl + c.cfb + c.ufc;
    document.querySelectorAll('#sportNav .sn-c').forEach((el) => { el.textContent = c[el.dataset.c]; });
  }
  function initSportNav() {
    const nav = $('sportNav'); if (!nav) return;
    let saved = null; try { saved = localStorage.getItem(LS_KEY); } catch (e) {}
    const k = SK[location.hash.slice(1)] || SK[saved] || 'all';
    setSport(k, false);
    nav.addEventListener('click', (e) => { const a = e.target.closest('.sn'); if (a && location.hash === '#' + a.dataset.sk) { e.preventDefault(); setSport(a.dataset.sk, true); } });
    const tb = document.querySelector('.topbar');
    const sync = () => document.documentElement.style.setProperty('--tb-h', tb.offsetHeight + 'px');
    if (tb) { sync(); if (window.ResizeObserver) new ResizeObserver(sync).observe(tb); else window.addEventListener('resize', sync); }
  }
  function init() {
    E = window.Edge; if (!E) return;
    $('slateFilters').addEventListener('click', (e) => {
      const c = e.target.closest('.chip'); if (!c) return;
      if (c.id === 'slateUpcoming') { upcoming = !upcoming; c.classList.toggle('active', upcoming); c.setAttribute('aria-pressed', upcoming); }
      render(); counts();
    });
    $('slateUpcoming').classList.add('active');
    ['slateList', 'homeSlate', 'valueBoard'].forEach((id) => $(id) && $(id).addEventListener('click', (e) => { const g = e.target.closest('.game,.vb-row'); if (g) openSheet(g.dataset.key); }));
    $('injSport').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (!c) return; injSport = c.dataset.s; $('injSport').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === c)); renderInjuries(true); });
    $('injTeam').addEventListener('change', () => renderInjuries(false)); $('injStatus').addEventListener('change', () => renderInjuries(false));
    $('sheet').addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) return closeSheet();
      const b = e.target.closest('[data-shop]'); if (b) { try { shop(JSON.parse(b.dataset.shop)); } catch (err) {} }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('sheet').hidden) closeSheet(); });
    window.addEventListener('hashchange', () => { if (!$('sheet').hidden) closeSheet(); const k = SK[location.hash.slice(1)]; if (k) setSport(k, true); });
    initSportNav();
    load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
