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
    const o = g.odds; if (!o) return 'No line posted yet.';
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

  // ---------- Cards ----------
  function footballCard(g, key) {
    const o = g.odds || {}; const sp = o.spread || {}, ml = o.moneyline || {};
    const row = (t, side) => `<div class="tm"><div class="tm-id">${logo(t)}<div class="tm-name"><div>${t.rank ? `<span class="rk">${t.rank}</span>` : ''}${E.esc(t.short || t.name)}${g.status.state !== 'pre' && t.score != null ? ` <b class="score">${t.score}</b>` : ''}</div><div class="tm-sub">${E.esc(t.record || '')} ${injBadge(key, t)}</div></div></div>
      <div class="oc"><span>${sp[side] && sp[side].line != null ? sgn(sp[side].line) : '—'}</span><small>${sp[side] ? O(sp[side].odds) : ''}</small></div>
      <div class="oc"><span>${ml[side] && ml[side].odds != null ? O(ml[side].odds) : '—'}</span><small>${ml[side] && ml[side].odds != null ? E.pct(E.implied(ml[side].odds), 0) : ''}</small></div></div>`;
    const live = g.status.state === 'in', fin = g.status.state === 'post';
    return `<button class="game" data-key="${E.esc(g.id)}">
      <div class="g-top"><span class="tag">${g.sport === 'NFL' ? 'NFL' : 'College'}</span><span class="g-time${live ? ' live' : ''}">${live ? 'LIVE · ' + E.esc(g.status.detail) : fin ? 'Final' : kick(g.start)}</span></div>
      <div class="g-head"><span></span><span>Spread</span><span>Win (ML)</span></div>
      ${row(g.away, 'away')}${row(g.home, 'home')}
      <div class="g-foot"><span>${o.total && o.total.line != null ? `Total <b>${o.total.line}</b>` : ''}${o.total && o.total.openLine != null && o.total.openLine !== o.total.line ? ` <span class="mv">(opened ${o.total.openLine})</span>` : ''}</span><span class="prov">${o.provider ? 'Odds: ' + E.esc(o.provider) : 'No odds yet'}</span></div>
      <div class="g-explain">${E.esc(explain(g))}</div></button>`;
  }
  function fighter(f, side) {
    return `<div class="ft ${side}"><div class="hs-wrap">${f.headshot ? `<img class="hs" src="${E.esc(f.headshot)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'hs ph',textContent:'${E.esc((f.name || '?')[0])}'}))">` : `<span class="hs ph">${E.esc((f.name || '?')[0])}</span>`}</div>
      <div class="ft-name">${E.esc(f.name)}</div><div class="tm-sub">${E.esc(f.record || '')}${f.country ? ' · ' + E.esc(f.country) : ''}</div>
      <div class="ft-ml">${f.ml != null ? O(f.ml) : '—'}</div><div class="tm-sub">${f.ml != null ? E.pct(E.implied(f.ml), 0) + ' implied' : 'no line'}</div></div>`;
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
        <p class="muted small">This is one book's price. "Shop" copies it into the Line shop so you can add FanDuel's number and compare.</p>` : '<p class="muted small">No line posted yet.</p>'}</div>
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
        <div class="sh-sec"><div class="card-label">Research this fight</div>${links(SITES.UFC(f))}</div>`;
    }
    $('sheetBody').innerHTML = html;
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
    render(); renderHome(); renderInjuries(true);
    window.EdgeData = { games, inj, meta };
    document.dispatchEvent(new Event('edge:data'));
  }
  function renderHome() {
    const hs = $('homeSlate'); if (!hs || !games) return;
    const up = [];
    ['nfl', 'cfb'].forEach((k) => (games[k] && games[k].games || []).forEach((g) => { if (g.status.state === 'pre') { up.push({ g, k }); index[g.id] = { type: 'fb', g, key: k }; } }));
    up.sort((a, b) => new Date(a.g.start) - new Date(b.g.start));
    const nfl = up.filter((x) => x.k === 'nfl').slice(0, 2), cfb = up.filter((x) => x.k === 'cfb' && (x.g.home.rank || x.g.away.rank)).slice(0, 2);
    let html = [...nfl, ...cfb].map((x) => footballCard(x.g, x.k)).join('');
    const ev = games.ufc && games.ufc.events[0]; const main = ev && ev.fights.find((f) => f.status.state === 'pre');
    if (main) { index[ev.id + ':' + main.id] = { type: 'ufc', ev, f: main }; html += fightCard(ev, main, ev.fights.indexOf(main)); }
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
  function init() {
    E = window.Edge; if (!E) return;
    $('slateFilters').addEventListener('click', (e) => {
      const c = e.target.closest('.chip'); if (!c) return;
      if (c.id === 'slateUpcoming') { upcoming = !upcoming; c.classList.toggle('active', upcoming); c.setAttribute('aria-pressed', upcoming); }
      else { sport = c.dataset.sport; $('slateFilters').querySelectorAll('.chip[data-sport]').forEach((x) => x.classList.toggle('active', x === c)); }
      render();
    });
    $('slateUpcoming').classList.add('active');
    ['slateList', 'homeSlate'].forEach((id) => $(id) && $(id).addEventListener('click', (e) => { const g = e.target.closest('.game'); if (g) openSheet(g.dataset.key); }));
    $('injSport').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (!c) return; injSport = c.dataset.s; $('injSport').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === c)); renderInjuries(true); });
    $('injTeam').addEventListener('change', () => renderInjuries(false)); $('injStatus').addEventListener('change', () => renderInjuries(false));
    $('sheet').addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) return closeSheet();
      const b = e.target.closest('[data-shop]'); if (b) { try { shop(JSON.parse(b.dataset.shop)); } catch (err) {} }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('sheet').hidden) closeSheet(); });
    window.addEventListener('hashchange', () => { if (!$('sheet').hidden) closeSheet(); });
    load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
