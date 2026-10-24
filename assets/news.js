/* Edge — News feed, breaking ticker, and the live "Why" evidence on Top Picks. Reads data/news.json, data/experts.json + window.EdgeData / EdgePicks. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let E, news = null, experts = null, newsUpdated = null;
  const SK = { NFL: 'nfl', 'College Football': 'cfb', UFC: 'ufc' };
  const sportOf = (p) => SK[p.sport] || String(p.sport || '').toLowerCase();
  const cur = () => window.EdgeSport || 'all';
  const D = () => window.EdgeData || {};
  const picks = () => { const d = window.EdgePicks; return d && Array.isArray(d.picks) ? d.picks : []; };
  const esc = (s) => E.esc(s == null ? '' : String(s));
  const nid = (i) => 'n-' + String(i.id || '').replace(/[^\w-]/g, '_');
  const ts = (iso) => Date.parse(iso) || 0;
  function rel(iso) {
    const t = ts(iso); if (!t) return '';
    const m = Math.round((Date.now() - t) / 6e4);
    if (m < 0) return 'upcoming'; if (m < 60) return (m || 1) + 'm ago'; if (m < 1440) return Math.round(m / 60) + 'h ago'; return Math.round(m / 1440) + 'd ago';
  }
  const TYPES = { 'weigh in': 'Weigh-in', weighin: 'Weigh-in', injury: 'Injury', lineup: 'Lineup', 'line move': 'Line move', news: 'News' };
  const typeLabel = (t) => TYPES[String(t || 'news').toLowerCase().replace(/[-_]/g, ' ')] || String(t || 'News');
  const typeCls = (t) => 't-' + typeLabel(t).toLowerCase().replace(/[^a-z]/g, '');
  const imp = (i) => (['high', 'medium', 'low'].includes(i.impact) ? i.impact : 'low');
  const safeUrl = (u) => (/^https?:\/\//.test(u || '') ? u : '');
  const inSport = (s) => cur() === 'all' || s === cur();

  // ---------- Matching a pick to games / injuries / news / experts ----------
  function findGame(p) {
    const g = D().games; if (!g) return null; const k = sportOf(p), ev = (p.event || '') + ' ' + (p.selection || '');
    if (k === 'ufc') {
      for (const e of (g.ufc && g.ufc.events) || []) for (const f of e.fights) if (f.fighters.length === 2 && f.fighters.every((x) => ev.includes(x.name.split(' ').slice(-1)[0]))) return { type: 'ufc', ev: e, f };
      return null;
    }
    const gm = ((g[k] && g[k].games) || []).find((x) => [x.away, x.home].every((t) => ev.includes(t.name) || (t.short && ev.includes(t.short))));
    return gm ? { type: 'fb', g: gm, key: k } : null;
  }
  function sideOf(p, m) {
    const s = (p.selection || '').toLowerCase();
    if (m.type === 'fb') { for (const side of ['away', 'home']) { const t = m.g[side]; if ([t.name, t.short, t.abbr].some((n) => n && s.includes(n.toLowerCase()))) return side; } return null; }
    const i = m.f.fighters.findIndex((x) => s.includes(x.name.split(' ').slice(-1)[0].toLowerCase())); return i < 0 ? null : i;
  }
  function terms(p, m) {
    const out = [];
    if (m && m.type === 'fb') [m.g.away, m.g.home].forEach((t) => out.push(t.name, t.short));
    else if (m && m.type === 'ufc') m.f.fighters.forEach((x) => out.push(x.name));
    else String(p.event || '').split(/\s+(?:@|vs\.?|at)\s+/i).forEach((x) => out.push(x.replace(/\(.*?\)/g, '').trim()));
    return out.filter((x) => x && x.length >= 4);
  }
  const itemText = (i) => [i.title, i.summary, i.event, (i.fighters_or_teams || []).join(' ')].join(' ').toLowerCase();
  const newsFor = (p, m) => { const t = terms(p, m).map((x) => x.toLowerCase()); return (news || []).filter((i) => i.sport === sportOf(p) && t.some((x) => itemText(i).includes(x))); };
  const cents = (o) => (o > 0 ? o - 100 : o + 100);
  // Best live DraftKings/FanDuel price for the pick's side (The Odds API), falling back to ESPN.
  function liveBest(p, m, side) {
    const B = window.EdgeBooks; if (!B || !m) return null;
    if (m.type === 'ufc') { const x = m.f.fighters[side], b = x && x.books; if (!b) return null; const mm = { DraftKings: b.DraftKings != null ? { odds: b.DraftKings } : null, FanDuel: b.FanDuel != null ? { odds: b.FanDuel } : null }; const bk = B.bestBook(mm.DraftKings, mm.FanDuel, 'ml') || (mm.DraftKings ? 'DraftKings' : 'FanDuel'); return mm[bk] ? { bk, ...mm[bk], all: mm } : null; }
    const s = B.bookSides(m.g), k = (/money|ml/i.test(p.market || '') ? 'ml_' : 'spread_') + side, mm = s[k]; if (!mm) return null;
    const bk = B.bestBook(mm.DraftKings, mm.FanDuel, k.startsWith('ml') ? 'ml' : 'spread') || (mm.DraftKings ? 'DraftKings' : 'FanDuel'); return mm[bk] ? { bk, ...mm[bk], all: mm, k } : null;
  }
  function lineMove(p, m) {
    if (!m) return null; const side = sideOf(p, m); const posted = p.books && p.books[p.book] ? p.books[p.book] : {};
    if (m.type === 'ufc') {
      if (side == null) return null; const f = m.f.fighters[side]; const lb = liveBest(p, m, side); const now = lb ? lb.odds : f.ml; if (now == null) return null;
      const against = E.validOdds(Number(p.odds)) && cents(Number(p.odds)) - cents(now) >= 20;
      return { text: `${f.name} ML opened ${f.mlOpen != null ? E.fmtOdds(f.mlOpen) : '—'} → best now ${E.fmtOdds(now)}${lb ? ' at ' + lb.bk : ''}${p.odds != null ? ` (we posted ${E.fmtOdds(Number(p.odds))})` : ''}`, against, live: lb };
    }
    const o = m.g.odds; if (!o || side == null) return null;
    const isML = /money|ml/i.test(p.market || ''); const sp = o.spread && o.spread[side], ml = o.moneyline && o.moneyline[side]; const t = m.g[side].abbr || m.g[side].short;
    let against = false, text; const lb = liveBest(p, m, side);
    if (lb) {
      const pl = parseFloat(posted.line);
      if (isML) { text = `${t} ML best now ${E.fmtOdds(lb.odds)} at ${lb.bk}${ml && ml.open != null ? ` (opened ${E.fmtOdds(ml.open)})` : ''}${p.odds != null ? `, we posted ${E.fmtOdds(Number(p.odds))}` : ''}`; against = E.validOdds(Number(p.odds)) && cents(Number(p.odds)) - cents(lb.odds) >= 20; }
      else { text = `${t} spread best now ${(lb.line > 0 ? '+' : '') + lb.line} (${E.fmtOdds(lb.odds)}) at ${lb.bk}${sp && sp.openLine != null ? `, opened ${(sp.openLine > 0 ? '+' : '') + sp.openLine}` : ''}${Number.isFinite(pl) ? `, we posted ${(pl > 0 ? '+' : '') + pl}` : ''}`; against = Number.isFinite(pl) && pl - lb.line >= 1.5; }
      return { text, against, live: lb };
    }
    if (isML && ml) { text = `${t} ML opened ${ml.open != null ? E.fmtOdds(ml.open) : '—'} → now ${E.fmtOdds(ml.odds)}${p.odds != null ? ` (we posted ${E.fmtOdds(Number(p.odds))})` : ''}`; against = E.validOdds(Number(p.odds)) && ml.odds != null && cents(Number(p.odds)) - cents(ml.odds) >= 20; }
    else if (sp && sp.line != null) { const pl = parseFloat(posted.line); text = `${t} spread opened ${sp.openLine != null ? (sp.openLine > 0 ? '+' : '') + sp.openLine : '—'} → now ${(sp.line > 0 ? '+' : '') + sp.line} (${o.provider || 'ESPN'})${Number.isFinite(pl) ? `, we posted ${(pl > 0 ? '+' : '') + pl}` : ''}`; against = Number.isFinite(pl) && pl - sp.line >= 1.5; }
    else return null;
    return { text, against };
  }
  const SEV = (st) => (/out|susp/i.test(st) && !/reserve/i.test(st) ? 'Out' : /doubt/i.test(st) ? 'Doubtful' : /quest/i.test(st) ? 'Questionable' : null);
  function injFor(p, m, sideOnly) {
    const inj = D().inj; if (!m || m.type !== 'fb' || !inj || !inj[m.key]) return [];
    const side = sideOf(p, m); const sides = sideOnly ? (side ? [side] : []) : ['away', 'home'];
    return sides.flatMap((s) => { const t = m.g[s], rec = inj[m.key][t.id]; return rec ? rec.items.filter((i) => SEV(i.status)).map((i) => ({ team: t.abbr || t.short, ours: s === side, ...i, sev: SEV(i.status) })) : []; })
      .sort((a, b) => ['Out', 'Doubtful', 'Questionable'].indexOf(a.sev) - ['Out', 'Doubtful', 'Questionable'].indexOf(b.sev));
  }
  function expertsFor(p, m) {
    const list = (experts && experts.experts) || []; const t = terms(p, m).map((x) => x.toLowerCase());
    return list.flatMap((x) => (x.picks || []).filter((k) => (m && m.type === 'fb' && k.espnGameId === m.g.id) || t.filter((y) => String(k.event || '').toLowerCase().includes(y)).length >= 2).map((k) => ({ handle: x.handle, label: x.label, ...k })));
  }
  const active = (p) => !p.start || ts(p.start) > Date.now() - 4 * 36e5;

  // ---------- "Why" evidence on each Top Pick ----------
  function why(p, i) {
    const m = findGame(p), lm = lineMove(p, m), inj = injFor(p, m, false), nw = newsFor(p, m), ex = expertsFor(p, m);
    const li = (a) => a.join('');
    return `<details class="pick-why" data-k="w${i}"><summary>Why — live evidence${lm && lm.against ? ' <span class="cc red">Line moved against us</span>' : ''}</summary><div class="why-grid">
      ${lm && lm.live && lm.live.all ? `<div><h4>Live prices now</h4><div class="fbk">${['DraftKings', 'FanDuel'].map((bk) => { const v = lm.live.all[bk]; return `<span class="bkc${v && bk === lm.live.bk && lm.live.all.DraftKings && lm.live.all.FanDuel ? ' best' : ''}">${bk === 'DraftKings' ? 'DK' : 'FD'} ${v ? esc((v.line != null ? (v.line > 0 ? '+' : '') + v.line + ' ' : '') + E.fmtOdds(v.odds)) : '—'}</span>`; }).join('')}<span class="muted small">cyan = best price</span></div></div>` : ''}
      <div><h4>Line move</h4><p>${lm ? esc(lm.text) + (lm.against ? ' <b class="neg">— moved against the pick</b>' : '') : '<span class="muted">No live line for this game in the feed.</span>'}</p></div>
      ${m && m.type === 'fb' ? `<div><h4>Injuries (ESPN)</h4>${inj.length ? `<ul>${li(inj.slice(0, 8).map((x) => `<li><b>${esc(x.team)}</b> ${esc(x.name)} <span class="muted small">${esc(x.pos)}</span> <span class="ib ${x.sev === 'Out' ? 'out' : x.sev === 'Doubtful' ? 'dbt' : 'q'}">${esc(x.sev)}</span>${x.ours ? ' <span class="cc amber">our side</span>' : ''}</li>`))}</ul>` : '<p class="muted">No Out/Doubtful/Questionable listed.</p>'}</div>` : ''}
      <div><h4>News</h4>${nw.length ? `<ul>${li(nw.slice(0, 5).map((n) => `<li><a href="#news" data-nid="${esc(nid(n))}">${esc(n.title)}</a> <span class="muted small">${esc(rel(n.published))}</span>${n.edge_take ? `<div class="small">Edge: ${esc(n.edge_take)}</div>` : ''}</li>`))}</ul>` : '<p class="muted">No matching news in the feed.</p>'}</div>
      <div><h4>Expert consensus</h4>${ex.length ? `<ul>${li(ex.map((k) => `<li>@${esc(k.handle)}: ${esc(k.selection)}${safeUrl(k.postUrl) ? ` <a href="${esc(k.postUrl)}" target="_blank" rel="noopener">post</a>` : ''}</li>`))}</ul>` : '<p class="muted">No graded pick from tracked experts on this game.</p>'}</div>
    </div></details>`;
  }
  function decoratePicks() {
    const list = $('picksList'); if (!list || !E) return; const ps = picks();
    list.querySelectorAll('article[data-pid]').forEach((a) => {
      const p = ps[+a.dataset.pid]; if (!p) return; const old = a.querySelector('.pick-why'); if (old) old.remove();
      const btn = a.querySelector('button[data-pick]'); const tmp = document.createElement('div'); tmp.innerHTML = why(p, a.dataset.pid);
      a.insertBefore(tmp.firstElementChild, btn || null);
    });
  }

  // ---------- Concerns + ticker ----------
  function concerns() {
    const out = []; const ps = picks();
    ps.forEach((p, i) => {
      if (!active(p)) return; const m = findGame(p); const tag = p.selection || p.event;
      const lm = lineMove(p, m); if (lm && lm.against) out.push({ sport: sportOf(p), lvl: 'red', text: `${tag}: line moved against us — ${lm.text}`, pid: i });
      if (m && m.type === 'ufc' && /cancel|postpon/i.test(m.f.status.detail || '')) out.push({ sport: 'ufc', lvl: 'red', text: `${tag}: fight ${m.f.status.detail}`, pid: i });
      injFor(p, m, true).filter((x) => x.sev !== 'Questionable').slice(0, 3).forEach((x) => out.push({ sport: sportOf(p), lvl: x.sev === 'Out' ? 'red' : 'amber', text: `${tag}: ${x.team} ${x.pos} ${x.name} ${x.sev}`, pid: i }));
      newsFor(p, m).slice(0, 3).forEach((n) => out.push({ sport: n.sport, lvl: imp(n) === 'high' ? 'red' : 'amber', text: `${tag}: ${n.title}`, nid: nid(n), seen: n.id }));
    });
    const seen = new Set(out.map((c) => c.seen).filter(Boolean));
    (news || []).forEach((n) => {
      if (seen.has(n.id)) return; const tx = itemText(n);
      if (/miss(ed|es)? weight|weigh-in miss|failed to make weight|over the limit/.test(tx)) { out.push({ sport: n.sport, lvl: 'red', text: 'Weigh-in miss: ' + n.title, nid: nid(n) }); seen.add(n.id); }
      else if (n.sport === 'ufc' && /cancel|scrapped|off the card|withdr[ae]w|pulled out|out of (the|his|her) fight/.test(tx)) { out.push({ sport: 'ufc', lvl: 'red', text: 'Fight off: ' + n.title, nid: nid(n) }); seen.add(n.id); }
    });
    const ufc = D().games && D().games.ufc;
    ((ufc && ufc.events) || []).forEach((e) => e.fights.forEach((f) => { if (/cancel/i.test((f.status && f.status.detail) || '')) out.push({ sport: 'ufc', lvl: 'red', text: `Fight cancelled: ${f.fighters.map((x) => x.name).join(' vs ')}` }); }));
    const inj = D().inj; if (inj && inj.nfl) Object.values(inj.nfl).forEach((t) => t.items.forEach((x) => { const s = SEV(x.status); if (x.pos === 'QB' && (s === 'Out' || s === 'Doubtful') && ts(x.date) > Date.now() - 7 * 864e5) out.push({ sport: 'nfl', lvl: 'amber', text: `${t.team} QB ${x.name} ${s}`, href: '#injuries' }); }));
    return { list: out, seen };
  }
  // Constant ~50px/sec regardless of content length.
  function tickSpeed() { const tr = $('tickerTrack'), run = tr && tr.querySelector('.tk-run'); if (run && run.offsetWidth) tr.style.animationDuration = (run.offsetWidth / 50).toFixed(1) + 's'; }
  function renderTicker() {
    const tk = $('ticker'), tr = $('tickerTrack'); if (!tk || !E) return;
    const { list, seen } = concerns();
    const rest = (news || []).filter((n) => !seen.has(n.id) && (imp(n) === 'high' || imp(n) === 'medium')).sort((a, b) => (imp(a) === 'high' ? 0 : 1) - (imp(b) === 'high' ? 0 : 1) || ts(b.published) - ts(a.published)).slice(0, 12);
    const IC = { nfl: '🏈', cfb: '🎓', ufc: '🥊' }; const ic = (k) => (IC[k] ? `<span class="tk-ic" aria-hidden="true">${IC[k]}</span>` : '');
    const items = list.map((c) => `<a class="tk-item" href="${c.pid != null ? '#picks' : c.nid ? '#news' : c.href || '#news'}"${c.pid != null ? ` data-pid="${c.pid}"` : ''}${c.nid ? ` data-nid="${esc(c.nid)}"` : ''}>${ic(c.sport)}<span class="tk-pill ${c.lvl === 'red' ? 'concern' : 'alert'}">${c.lvl === 'red' ? 'Concern' : 'Alert'}</span><span class="tk-tx">${esc(c.text)}</span></a>`)
      .concat(rest.map((n) => `<a class="tk-item" href="#news" data-nid="${esc(nid(n))}">${ic(n.sport)}<span class="tk-pill news">${esc(typeLabel(n.type))}</span><span class="tk-tx">${esc(n.title)}</span></a>`));
    if (!items.length) { tk.hidden = true; document.documentElement.classList.remove('has-tk'); return; }
    tk.hidden = false; document.documentElement.classList.add('has-tk'); const html = items.join('<span class="tk-sep" aria-hidden="true"></span>');
    const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    tr.innerHTML = still ? html : `<span class="tk-run">${html}<span class="tk-sep" aria-hidden="true"></span></span><span class="tk-run" aria-hidden="true">${html}<span class="tk-sep" aria-hidden="true"></span></span>`;
    tr.classList.toggle('still', !!still);
    tickSpeed();
  }

  // ---------- News list / home / slate strip ----------
  function card(n) {
    const lvl = imp(n), url = safeUrl(n.source_url);
    return `<article class="news-card imp-${lvl}" id="${esc(nid(n))}">
      <div class="nc-top"><span class="tk-t ${typeCls(n.type)}">${esc(typeLabel(n.type))}</span><span class="tag">${esc((n.sport || '').toUpperCase() === 'CFB' ? 'College' : (n.sport || '').toUpperCase())}</span>${lvl !== 'low' ? `<span class="nc-imp ${lvl}">${lvl === 'high' ? 'High impact' : 'Medium'}</span>` : ''}<span class="nc-time">${esc(rel(n.published))}</span></div>
      <h3 class="nc-title">${esc(n.title)}</h3>
      ${n.summary ? `<p class="nc-sum">${esc(n.summary)}</p>` : ''}
      ${n.edge_take ? `<div class="nc-take"><b>Edge take:</b> ${esc(n.edge_take)}</div>` : ''}
      <div class="nc-foot">${(n.fighters_or_teams || []).length ? `<span class="muted small">${esc(n.fighters_or_teams.slice(0, 3).join(' · '))}</span>` : '<span></span>'}${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(n.source_name || 'Source')} ↗</a>` : ''}</div>
    </article>`;
  }
  const sorted = (arr) => arr.slice().sort((a, b) => (imp(a) === 'high' ? 0 : 1) - (imp(b) === 'high' ? 0 : 1) || ts(b.published) - ts(a.published));
  function renderNews() {
    const el = $('newsList'); if (!el || !E) return;
    if (newsUpdated) $('newsUpdated').textContent = 'Updated ' + E.fmtET(newsUpdated);
    if (!news) { el.innerHTML = '<div class="empty">Couldn\'t load news right now.</div>'; return; }
    const list = sorted(news.filter((n) => inSport(n.sport)));
    el.innerHTML = list.length ? list.map(card).join('') : '<div class="empty">No news for this sport right now.</div>';
    const hs = $('homeNewsSec'), hn = $('homeNews');
    if (hs) { const top = sorted(news.filter((n) => imp(n) === 'high' && inSport(n.sport))).slice(0, 3); hs.hidden = !top.length; hn.innerHTML = top.map(card).join(''); }
  }
  function renderStrip() {
    const el = $('slatePicks'); if (!el || !E || !window.EdgePicks) return;
    const R = { High: 0, Medium: 1, Low: 2 };
    const ps = picks().map((p, i) => [p, i]).filter(([p]) => active(p) && inSport(sportOf(p))).sort((a, b) => (R[a[0].confidence] ?? 3) - (R[b[0].confidence] ?? 3));
    el.hidden = false;
    el.innerHTML = `<div class="ps-head">Edge top picks${cur() !== 'all' ? ' · ' + esc(cur() === 'cfb' ? 'College' : cur().toUpperCase()) : ''}</div>` + (ps.length ? `<div class="ps-row">${ps.map(([p, i], r) => `<a class="ps-item" href="#picks" data-pid="${i}"><span class="ps-rank">#${r + 1}</span><span class="ps-sel">${esc(p.selection)}</span><span class="ps-meta">${p.odds != null && E.validOdds(Number(p.odds)) ? esc(E.fmtOdds(Number(p.odds))) + ' ' : ''}${esc(p.book === 'DraftKings' ? 'DK' : p.book === 'FanDuel' ? 'FD' : p.book || '')} · ${esc(p.units)}u · ${esc(p.confidence)}${p.start ? ' · ' + esc(E.fmtET(p.start)) : ''}</span></a>`).join('')}</div>` : '<div class="ps-none">No strong plays here right now — passing is a win.</div>');
  }
  function renderAll() { renderNews(); renderStrip(); renderTicker(); decoratePicks(); }

  // ---------- Navigation from ticker / strip / evidence ----------
  function jump(e) {
    const a = e.target.closest('a[data-pid],a[data-nid]'); if (!a) return; e.preventDefault();
    const href = a.getAttribute('href'), target = a.dataset.nid ? () => $(a.dataset.nid) : () => document.querySelector(`#picksList article[data-pid="${a.dataset.pid}"]`);
    if (a.dataset.nid && cur() !== 'all') { const n = (news || []).find((x) => nid(x) === a.dataset.nid); if (n && n.sport !== cur()) { window.EdgeSport = 'all'; renderNews(); } }
    const go = () => { const el = target(); if (!el) return; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); };
    if (location.hash !== href) { location.hash = href; setTimeout(go, 380); } else go();
  }
  async function load() {
    const get = (f) => fetch('data/' + f + '?t=' + Math.floor(Date.now() / 6e5), { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [n, x] = await Promise.all([get('news.json'), get('experts.json')]);
    news = n && Array.isArray(n.items) ? n.items.filter((i) => i && i.title) : null; newsUpdated = n && n.updated; experts = x;
    renderAll();
  }
  function init() {
    E = window.Edge; if (!E) return;
    document.addEventListener('edge:data', renderAll);
    document.addEventListener('edge:picks', () => { decoratePicks(); renderStrip(); renderTicker(); });
    document.addEventListener('edge:sport', () => { renderNews(); renderStrip(); });
    document.addEventListener('click', jump);
    const tk = $('ticker'); if (tk) { let t; tk.addEventListener('touchstart', () => { clearTimeout(t); tk.classList.add('paused'); }, { passive: true }); tk.addEventListener('touchend', () => { t = setTimeout(() => tk.classList.remove('paused'), 2500); }, { passive: true }); }
    setInterval(renderNews, 120e3);
    window.addEventListener('resize', tickSpeed);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(tickSpeed);
    load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
