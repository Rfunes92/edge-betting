/* Edge — Experts watch list, scorecard, and Consensus vs Edge. Data: data/experts.json */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let E, data = null, picks = null, filter = 'all';
  const LBL = { 'Verified record': 'ver', 'Self-reported record': 'self', 'Info source': 'info' };
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pctS = (v) => (v == null ? '—' : (v * 100).toFixed(1) + '%');
  const roiS = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%');
  const resIcon = { win: '✓', loss: '✗', push: '•', pending: '…', void: '–' };

  function pickLine(p) {
    return `<a class="ep" href="${E.esc(p.postUrl)}" target="_blank" rel="noopener"><span class="ep-r ${E.esc(p.result || 'pending')}">${resIcon[p.result] || '…'}</span><span class="ep-t"><b>${E.esc(p.selection)}</b>${p.odds != null ? ' ' + E.esc(E.fmtOdds(p.odds)) : ''}${p.units != null ? ` · ${E.esc(p.units)}u` : ''}<span class="muted small"> · ${E.esc(p.event || '')} · ${E.esc(p.date || '')}</span></span><span class="ep-go">↗</span></a>`;
  }
  function card(x) {
    const r = x.record || {}; const lab = LBL[x.label] || 'info';
    const small = (r.graded || 0) < 50;
    const recent = (x.picks || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 4);
    return `<article class="card exp">
      <div class="exp-head"><img class="exp-av" src="${E.esc(x.avatar)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <div class="exp-id"><div class="exp-name">${E.esc(x.name)}</div><a class="small" href="https://x.com/${E.esc(x.handle)}" target="_blank" rel="noopener">@${E.esc(x.handle)}</a><div class="tm-sub">${x.sports.map(E.esc).join(' · ')}</div></div>
        <span class="lab ${lab}">${E.esc(x.label)}</span></div>
      <p class="exp-why">${E.esc(x.why)} <a href="${E.esc(x.source)}" target="_blank" rel="noopener">Source ↗</a></p>
      ${x.caveats ? `<p class="exp-cav">⚠ ${E.esc(x.caveats)}</p>` : ''}
      ${x.label !== 'Info source' || (x.picks || []).length ? `<div class="exp-stats"><div><span>Tracked here</span><b>${r.wins || 0}-${r.losses || 0}-${r.pushes || 0}</b></div><div><span>Hit rate</span><b>${pctS(r.hitRate)}</b></div><div><span>ROI (1u)</span><b class="${r.roi > 0 ? 'pos' : r.roi < 0 ? 'neg' : ''}">${roiS(r.roi)}</b></div><div><span>Pending</span><b>${r.pending || 0}</b></div></div>
      ${small ? `<p class="exp-warn">Small sample: ${r.graded || 0} graded pick${r.graded === 1 ? '' : 's'} tracked here (need 50+ before reading anything into it).${r.assumedOddsPicks ? ` ${r.assumedOddsPicks} graded at assumed -110.` : ''}</p>` : ''}` : ''}
      ${recent.length ? `<div class="exp-picks"><div class="card-label">Recent picks</div>${recent.map(pickLine).join('')}</div>` : (x.label === 'Info source' ? '' : '<p class="muted small">No explicit picks posted in the last 7 days.</p>')}
    </article>`;
  }
  function render() {
    if (!data) { $('expList').innerHTML = '<div class="empty">Couldn\'t load the experts list.</div>'; return; }
    $('expUpdated').textContent = data.updated ? 'Updated ' + E.fmtET(data.updated) : '';
    $('expNote').textContent = data.note || '';
    const order = { 'Verified record': 0, 'Self-reported record': 1, 'Info source': 2 };
    const list = data.experts.filter((x) => filter === 'all' || x.label === filter || (filter === 'UFC' && x.sports.includes('UFC'))).sort((a, b) => order[a.label] - order[b.label] || b.followers - a.followers);
    $('expList').innerHTML = list.map(card).join('') || '<div class="empty">Nobody in this filter.</div>';
    renderHome(); renderConsensus();
  }
  function renderHome() {
    const el = $('homeExperts'); if (!el || !data) return;
    const all = data.experts.flatMap((x) => (x.picks || []).map((p) => ({ x, p }))).filter(({ p }) => p.result === 'pending').sort((a, b) => String(a.p.date).localeCompare(String(b.p.date)));
    const ver = data.experts.filter((x) => x.label === 'Verified record').length, self = data.experts.filter((x) => x.label === 'Self-reported record').length;
    el.innerHTML = `<div class="card"><div class="exp-sum"><div><b>${data.experts.length}</b><span>on watch list</span></div><div><b>${ver}</b><span>verified records</span></div><div><b>${self}</b><span>self-reported</span></div><div><b>${all.length}</b><span>open picks</span></div></div>
      ${all.length ? all.slice(0, 4).map(({ x, p }) => `<div class="exp-mini"><img src="${E.esc(x.avatar)}" alt="" loading="lazy"><div>${pickLine(p).replace('class="ep"', 'class="ep compact"')}<div class="muted small">@${E.esc(x.handle)} · <span class="lab ${LBL[x.label]}">${E.esc(x.label)}</span></div></div></div>`).join('') : '<p class="muted small">No explicit expert picks posted for this slate yet.</p>'}</div>`;
  }
  function gameList() {
    const g = window.EdgeData && window.EdgeData.games; if (!g) return [];
    const out = [];
    ['nfl', 'cfb'].forEach((k) => (g[k] && g[k].games || []).forEach((x) => out.push({ id: x.id, name: `${x.away.short || x.away.name} @ ${x.home.short || x.home.name}`, start: x.start, sides: [x.away, x.home], status: x.status })));
    (g.ufc && g.ufc.events || []).forEach((ev) => ev.fights.forEach((f) => out.push({ id: f.id, name: f.fighters.map((z) => z.name).join(' vs '), start: f.start, sides: f.fighters, status: f.status })));
    return out;
  }
  const matchSide = (sides, team) => { const n = norm(team); if (!n) return -1; return sides.findIndex((t) => [t.name, t.short, t.abbr, t.location].some((v) => v && (norm(v) === n || (n.length > 3 && norm(v).includes(n))))); };
  function renderConsensus() {
    const el = $('consList'); if (!el || !data) return;
    const games = gameList(); if (!games.length) { el.innerHTML = '<div class="empty">Slate not loaded yet.</div>'; return; }
    const ep = data.experts.flatMap((x) => (x.picks || []).map((p) => ({ x, p })));
    const edge = (picks && picks.picks) || [];
    const rows = games.map((g) => {
      const mine = ep.filter(({ p }) => p.espnGameId === g.id || (!p.espnGameId && matchSide(g.sides, p.team) >= 0));
      if (!mine.length) return null;
      const buckets = {};
      mine.forEach(({ x, p }) => { const k = p.market === 'total' ? `${p.side === 'under' ? 'Under' : 'Over'} ${p.line ?? ''}` : p.market === 'teamTotal' ? `${p.team} TT ${p.side === 'under' ? 'Under' : 'Over'} ${p.line ?? ''}` : `${p.team || p.selection}${p.market === 'spread' && p.line != null ? ' ' + (p.line > 0 ? '+' : '') + p.line : p.market === 'moneyline' ? ' ML' : ''}`; (buckets[k] = buckets[k] || []).push(x); });
      const ed = edge.filter((p) => g.sides.some((t) => norm(p.event).includes(norm(t.short || t.name)) || norm(p.selection).includes(norm(t.short || t.name))));
      return `<div class="card cons"><div class="cons-head"><b>${E.esc(g.name)}</b><span class="muted small">${E.esc(E.fmtET(g.start))}</span></div>
        ${Object.entries(buckets).map(([k, xs]) => `<div class="cons-row"><span class="cons-side">${E.esc(k)}</span><span class="cons-who">${xs.map((x) => `<img src="${E.esc(x.avatar)}" alt="@${E.esc(x.handle)}" title="@${E.esc(x.handle)} (${E.esc(x.label)})">`).join('')}<span class="muted small">${xs.length} · ${xs.map((x) => '@' + E.esc(x.handle)).join(', ')}</span></span></div>`).join('')}
        <div class="cons-row edge"><span class="cons-side">Edge</span><span>${ed.length ? ed.map((p) => `<b>${E.esc(p.selection)}</b> <span class="muted small">(${E.esc(p.confidence)})</span>`).join(', ') : '<span class="muted small">No Edge pick: pass or still researching</span>'}</span></div></div>`;
    }).filter(Boolean);
    el.innerHTML = rows.length ? rows.join('') : '<div class="empty">No tracked expert picks match this week\'s Slate yet.</div>';
  }
  async function load() {
    const get = (f) => fetch(f + '?t=' + Math.floor(Date.now() / 6e5), { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    [data, picks] = await Promise.all([get('data/experts.json'), get('picks.json')]);
    render();
  }
  function init() {
    E = window.Edge; if (!E) return;
    $('expFilters').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (!c) return; filter = c.dataset.f; $('expFilters').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === c)); render(); });
    document.addEventListener('edge:data', renderConsensus);
    load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
