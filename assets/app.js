/* Edge — personal betting discipline dashboard. All data stays in localStorage. */
(function () {
  'use strict';
  const TZ = 'America/New_York';
  const K = { settings: 'edge.settings.v1', bets: 'edge.bets.v1', lines: 'edge.lines.v1', watch: 'edge.watch.v1', rhythm: 'edge.rhythm.v1' };
  const MAX_PCT = 2;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Could not save — storage is full or blocked.'); } };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const num = (v) => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(/[$,\s]/g, '')); return isFinite(n) ? n : null; };
  const fmt$ = (n, sign) => { if (n == null || !isFinite(n)) return '—'; const s = Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' }); return n < 0 ? '-' + s : (sign && n > 0 ? '+' + s : s); };
  const fmtOdds = (o) => (o == null ? '—' : (o > 0 ? '+' + o : String(o)));
  const pct = (n, d = 1) => (n == null || !isFinite(n) ? '—' : (n * 100).toFixed(d) + '%');
  const cls = (n) => (n > 0.004 ? 'pos' : n < -0.004 ? 'neg' : '');

  // ---------- State ----------
  let settings = Object.assign({ bankroll: null, unitPct: 1, dailyLimit: null, weeklyLimit: null }, load(K.settings, {}));
  let bets = load(K.bets, []);
  let lines = load(K.lines, []);
  let watch = load(K.watch, []);
  let editingId = null;
  let filter = 'all';
  let trFilter = 'all';
  let picksData = null;
  let chart = null;

  // ---------- Odds math ----------
  const validOdds = (o) => o != null && isFinite(o) && Math.abs(o) >= 100;
  const implied = (o) => (o < 0 ? -o / (-o + 100) : 100 / (o + 100));
  const decimal = (o) => (o > 0 ? 1 + o / 100 : 1 + 100 / -o);
  const probToAmerican = (p) => { if (!(p > 0 && p < 1)) return null; return p >= 0.5 ? Math.round(-100 * p / (1 - p)) : Math.round(100 * (1 - p) / p); };
  const profitOf = (b) => { if (b.result === 'win') return b.stake * (decimal(b.odds) - 1); if (b.result === 'loss') return -b.stake; return 0; };
  const isSettled = (b) => b.result !== 'pending';
  // "Cents" between two American prices, treating -100 and +100 as the same point.
  const cents = (a, b) => { const t = (o) => (o > 0 ? o - 100 : o + 100); return Math.abs(t(a) - t(b)); };

  // ---------- Time (ET) ----------
  const etDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
  const dow = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
  const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
  const weekStart = (ymd) => addDays(ymd, -((dow(ymd) + 6) % 7));
  const fmtET = (iso, opts) => { const d = new Date(iso); if (isNaN(d)) return ''; return new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, opts || {})).format(d) + ' ET'; };
  const fmtDay = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }); };

  // ---------- Derived ----------
  const settledProfit = () => bets.filter(isSettled).reduce((a, b) => a + profitOf(b), 0);
  const currentBankroll = () => (settings.bankroll == null ? null : settings.bankroll + settledProfit());
  const unitDollar = () => { const c = currentBankroll(); return c == null ? null : Math.max(0, c * settings.unitPct / 100); };
  const maxDollar = () => { const c = currentBankroll(); return c == null ? null : Math.max(0, c * MAX_PCT / 100); };

  function periodPL() {
    const today = etDate(); const ws = weekStart(today); const we = addDays(ws, 6);
    let day = 0, week = 0, dayN = 0, weekN = 0, dayRisk = 0, weekRisk = 0;
    bets.forEach((b) => {
      const inDay = b.date === today, inWeek = b.date >= ws && b.date <= we;
      if (isSettled(b)) { const p = profitOf(b); if (inDay) day += p; if (inWeek) week += p; }
      else { if (inDay) dayRisk += b.stake; if (inWeek) weekRisk += b.stake; }
      if (inDay) dayN++; if (inWeek) weekN++;
    });
    return { today, ws, we, day, week, dayN, weekN, dayRisk, weekRisk };
  }
  function stopState() {
    const p = periodPL();
    const dayHit = settings.dailyLimit > 0 && p.day <= -settings.dailyLimit;
    const weekHit = settings.weeklyLimit > 0 && p.week <= -settings.weeklyLimit;
    return { dayHit, weekHit, active: dayHit || weekHit, p };
  }

  // Chasing: stake up >20% right after a loss, or 3rd+ bet within an hour after a loss.
  function chaseFlagsFor(candidate, list) {
    const flags = [];
    const t = candidate.createdAt || Date.now();
    const prior = list.filter((b) => b.id !== candidate.id && (b.createdAt || 0) < t).sort((a, b) => a.createdAt - b.createdAt);
    const prev = prior[prior.length - 1];
    if (prev && prev.result === 'loss' && candidate.stake > prev.stake * 1.2) {
      flags.push(`Stake is ${Math.round((candidate.stake / prev.stake - 1) * 100)}% bigger than the bet you just lost (${fmt$(prev.stake)}).`);
    }
    const losses = prior.filter((b) => b.result === 'loss');
    for (let i = losses.length - 1; i >= 0; i--) {
      const lt = losses[i].settledAt || losses[i].createdAt;
      if (t - lt > 3600e3 || t < lt) continue;
      const after = prior.filter((b) => b.createdAt >= lt && b.createdAt <= lt + 3600e3).length + 1;
      if (after >= 3) { flags.push(`This is bet #${after} within an hour of a loss.`); break; }
    }
    return flags;
  }
  function allChaseFlags() {
    const out = [];
    bets.forEach((b) => { const f = chaseFlagsFor(b, bets); if (f.length) out.push({ b, f }); });
    return out.sort((a, b) => b.b.createdAt - a.b.createdAt);
  }

  // ---------- Toast ----------
  let toastT;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }

  // ---------- Views / tabs ----------
  const VIEWS = ['home', 'slate', 'news', 'experts', 'injuries', 'rhythm', 'sources', 'tools'];
  const ALIAS = { picks: 'home', guide: 'home', fresh: 'home', top: 'home', consensus: 'experts', guardrails: 'tools', stats: 'tools', log: 'tools', lineshop: 'tools', tracker: 'tools', settings: 'tools', data: 'tools', all: 'slate', nfl: 'slate', cfb: 'slate', college: 'slate', ufc: 'slate' };
  function route() {
    let h = (location.hash || '#home').slice(1);
    const target = h; h = ALIAS[h] || h;
    if (!VIEWS.includes(h)) h = 'home';
    VIEWS.forEach((v) => { $('v-' + v).hidden = v !== h; });
    document.querySelectorAll('.tab').forEach((a) => {
      const on = a.dataset.view === h; a.classList.toggle('active', on);
      if (on) a.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
    if (h === 'tools' && target !== 'tools') { const tw = $('toolsWrap'); if (tw) tw.open = true; }
    if (ALIAS[target] && target !== 'top') { const el = $(target); if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 30); }
    else window.scrollTo({ top: 0 });
    if (h === 'tools' && chart) setTimeout(() => chart.resize(), 50);
  }
  window.addEventListener('hashchange', route);

  // ---------- Render: header / settings ----------
  function renderSettings() {
    $('sBankroll').value = settings.bankroll == null ? '' : settings.bankroll;
    $('sDaily').value = settings.dailyLimit == null ? '' : settings.dailyLimit;
    $('sWeekly').value = settings.weeklyLimit == null ? '' : settings.weeklyLimit;
    document.querySelectorAll('#sUnit button').forEach((b) => { const on = +b.dataset.v === +settings.unitPct; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    renderUnitReadout();
  }
  function renderUnitReadout() {
    const br = num($('sBankroll').value);
    const base = br == null ? null : br + settledProfit();
    const u = document.querySelector('#sUnit button.on'); const up = u ? +u.dataset.v : settings.unitPct;
    $('unitDollar').textContent = base == null ? 'Set bankroll' : fmt$(base * up / 100);
    $('maxDollar').textContent = base == null ? '—' : fmt$(base * MAX_PCT / 100);
  }

  // ---------- Render: guardrails ----------
  function renderGuardrails() {
    const s = stopState(); const p = s.p;
    const one = (pre, pl, limit, n, risk, hit) => {
      $(pre + 'PL').textContent = fmt$(pl, true); $(pre + 'PL').className = 'big ' + cls(pl);
      const bar = $(pre + 'Bar');
      if (limit > 0) {
        const used = Math.max(0, -pl) / limit; bar.style.width = Math.min(100, used * 100) + '%';
        bar.className = 'bar' + (hit ? ' hit' : used >= 0.6 ? ' warn' : '');
        $(pre + 'LimitTxt').textContent = hit ? 'Limit reached' : `${fmt$(Math.max(0, limit + Math.min(0, pl)))} left of ${fmt$(limit)}`;
      } else { bar.style.width = '0%'; bar.className = 'bar'; $(pre + 'LimitTxt').innerHTML = '<a href="#settings">Set a limit</a>'; }
      $(pre + 'Meta').textContent = `${n} bet${n === 1 ? '' : 's'}` + (risk > 0 ? ` · ${fmt$(risk)} pending` : '');
    };
    one('day', p.day, settings.dailyLimit, p.dayN, p.dayRisk, s.dayHit);
    one('week', p.week, settings.weeklyLimit, p.weekN, p.weekRisk, s.weekHit);
    $('weekMeta').textContent += ` · ${fmtDay(p.ws)} – ${fmtDay(p.we)}`;

    const banner = $('stopBanner');
    banner.hidden = !s.active;
    if (s.active) {
      $('stopText').textContent = s.weekHit
        ? "Weekly loss limit reached. No more bets until Monday (ET). Step away — the games will still be there next week."
        : "Daily loss limit reached. No more bets today. Tomorrow is a fresh start, and stopping now protects the bankroll.";
    }
    const flags = allChaseFlags().slice(0, 6);
    $('chaseList').innerHTML = flags.length
      ? flags.map(({ b, f }) => `<div class="flag"><span class="flag-dot"></span><div><div><b>${esc(b.pick)}</b> <span class="muted small">· ${fmtDay(b.date)} · ${fmt$(b.stake)}</span></div><div class="muted small">${f.map(esc).join(' ')}</div></div></div>`).join('')
      : '<p class="muted small" style="margin:0">No chasing patterns detected. Keep it that way.</p>';
    if ($('setupNudge')) $('setupNudge').hidden = settings.bankroll != null && settings.dailyLimit != null && settings.weeklyLimit != null;
  }

  // ---------- Render: stats ----------
  function renderStats() {
    const cur = currentBankroll();
    $('hdrBankrollVal').textContent = cur == null ? 'Not set' : fmt$(cur);
    $('kBankroll').textContent = cur == null ? 'Not set' : fmt$(cur);
    const settled = bets.filter(isSettled);
    const pl = settledProfit();
    $('kPL').textContent = fmt$(pl, true); $('kPL').className = 'kpi-val ' + cls(pl);
    const w = settled.filter((b) => b.result === 'win').length, l = settled.filter((b) => b.result === 'loss').length, pu = settled.filter((b) => b.result === 'push').length;
    $('kRecord').textContent = `${w}-${l}-${pu}`;
    $('kWin').textContent = w + l ? pct(w / (w + l)) : '—';
    const staked = settled.filter((b) => b.result !== 'void').reduce((a, b) => a + b.stake, 0);
    $('kROI').textContent = staked ? pct(pl / staked) : '—'; $('kROI').className = 'kpi-val ' + (staked ? cls(pl) : '');
    const clvBets = bets.filter((b) => validOdds(b.closing) && b.result !== 'void');
    if (clvBets.length) {
      const avg = clvBets.reduce((a, b) => a + (implied(b.closing) - implied(b.odds)), 0) / clvBets.length;
      $('kCLV').textContent = (avg >= 0 ? '+' : '') + (avg * 100).toFixed(2) + '%'; $('kCLV').className = 'kpi-val ' + cls(avg * 100);
      $('kCLVsub').textContent = `${clvBets.length} bet${clvBets.length === 1 ? '' : 's'} · implied prob.`;
    } else { $('kCLV').textContent = '—'; $('kCLV').className = 'kpi-val'; $('kCLVsub').textContent = 'Log closing odds'; }

    const breakdown = (key, el, labels) => {
      const g = {};
      settled.forEach((b) => { const k = b[key]; g[k] = g[k] || { pl: 0, n: 0, st: 0 }; g[k].pl += profitOf(b); g[k].n++; if (b.result !== 'void') g[k].st += b.stake; });
      const rows = Object.entries(g).sort((a, b) => b[1].pl - a[1].pl);
      if (!rows.length) { $(el).innerHTML = '<p class="muted small" style="margin:0">No settled bets yet.</p>'; return; }
      const max = Math.max(...rows.map((r) => Math.abs(r[1].pl)), 1);
      $(el).innerHTML = rows.map(([k, v]) => `<div class="row"><div>${esc(labels ? labels[k] || k : k)}<div class="meta">${v.n} bet${v.n === 1 ? '' : 's'} · ROI ${v.st ? pct(v.pl / v.st) : '—'}</div></div><div class="${cls(v.pl)}" style="font-weight:700">${fmt$(v.pl, true)}</div><div class="track"><div class="fill" style="left:0;width:${(Math.abs(v.pl) / max) * 100}%;background:${v.pl >= 0 ? 'var(--green)' : 'var(--red)'}"></div></div></div>`).join('');
    };
    breakdown('sport', 'bySport');
    breakdown('market', 'byMarket', { moneyline: 'Moneyline', spread: 'Spread', total: 'Total', prop: 'Prop', parlay: 'Parlay', other: 'Other' });
    renderChart();
  }

  function renderChart() {
    const settled = bets.filter(isSettled).sort((a, b) => (a.date === b.date ? (a.settledAt || a.createdAt) - (b.settledAt || b.createdAt) : a.date < b.date ? -1 : 1));
    const start = settings.bankroll;
    const empty = start == null || settled.length === 0;
    $('chartEmpty').hidden = !empty; $('bankrollChart').parentElement.hidden = empty;
    $('chartEmpty').textContent = start == null ? 'Set your starting bankroll to see the curve.' : 'Settle a few bets to see your bankroll curve.';
    if (typeof Chart === 'undefined') { if (!empty) $('chartEmpty').hidden = false, $('chartEmpty').textContent = 'Chart library failed to load (offline?).'; return; }
    let run = start || 0; const labels = ['Start'], data = [start == null ? null : start];
    settled.forEach((b) => { run += profitOf(b); labels.push(fmtDay(b.date)); data.push(+run.toFixed(2)); });
    const ctx = $('bankrollChart').getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 260); grad.addColorStop(0, 'rgba(0,229,255,.28)'); grad.addColorStop(1, 'rgba(0,229,255,0)');
    const ds = { data: empty ? [] : data, borderColor: '#00e5ff', backgroundColor: grad, fill: true, tension: 0.35, borderWidth: 2.2, pointRadius: data.length > 30 ? 0 : 2.5, pointHoverRadius: 5, pointBackgroundColor: '#00e5ff' };
    if (chart) { chart.resize(); chart.data.labels = empty ? [] : labels; chart.data.datasets[0] = ds; chart.update(); return; }
    Chart.defaults.font.family = "'Inter', system-ui, sans-serif"; Chart.defaults.color = '#8a96a3';
    chart = new Chart(ctx, {
      type: 'line', data: { labels: empty ? [] : labels, datasets: [ds] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 700, easing: 'easeOutCubic' }, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { backgroundColor: '#151a20', borderColor: 'rgba(0,229,255,.35)', borderWidth: 1, padding: 10, displayColors: false, callbacks: { label: (c) => fmt$(c.parsed.y) } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } }, y: { grid: { color: 'rgba(255,255,255,.05)' }, border: { display: false }, ticks: { maxTicksLimit: 5, callback: (v) => '$' + Number(v).toLocaleString() } } }
      }
    });
  }

  // ---------- Render: bet log ----------
  function renderBets() {
    const list = bets.slice().sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1))
      .filter((b) => filter === 'all' || (filter === 'pending' ? !isSettled(b) : isSettled(b)));
    $('betCount').textContent = `${bets.length} bet${bets.length === 1 ? '' : 's'} · ${bets.filter((b) => !isSettled(b)).length} pending`;
    if (!list.length) { $('betList').innerHTML = `<div class="empty">${bets.length ? 'Nothing in this filter.' : 'No bets logged yet. Every bet goes here — wins, losses, and the ones you\'d rather forget.'}</div>`; return; }
    const mk = { moneyline: 'ML', spread: 'Spread', total: 'Total', prop: 'Prop', parlay: 'Parlay', other: 'Other' };
    $('betList').innerHTML = list.map((b) => {
      const p = profitOf(b); const toWin = b.stake * (decimal(b.odds) - 1);
      const clv = validOdds(b.closing) ? implied(b.closing) - implied(b.odds) : null;
      const f = chaseFlagsFor(b, bets);
      return `<div class="bet" data-id="${b.id}">
        <div class="bet-head"><div><div class="bet-pick">${esc(b.pick)}</div>
          <div class="bet-meta">${fmtDay(b.date)} · ${esc(b.book)} · ${esc(b.sport)} · ${mk[b.market] || esc(b.market)} · ${fmtOdds(b.odds)}${clv != null ? ` · CLV <span class="${cls(clv * 100)}">${(clv >= 0 ? '+' : '') + (clv * 100).toFixed(1)}%</span>` : ''}</div></div>
          <div class="bet-amt"><div class="pl ${isSettled(b) ? cls(p) : ''}">${isSettled(b) ? fmt$(p, true) : fmt$(b.stake)}</div>${!isSettled(b) ? `<div class="muted small">to win ${fmt$(toWin)}</div>` : ''}<span class="status ${b.result}">${b.result}</span></div></div>
        ${f.length ? `<div class="bet-flag">⚑ ${f.map(esc).join(' ')}</div>` : ''}
        <div class="bet-actions">${!isSettled(b) ? `<button class="btn btn-sm settle-w" data-act="win">Win</button><button class="btn btn-sm settle-l" data-act="loss">Loss</button><button class="btn btn-sm" data-act="push">Push</button><button class="btn btn-sm" data-act="void">Void</button>` : ''}
          <button class="btn btn-sm btn-ghost" data-act="edit">Edit</button><button class="btn btn-sm btn-ghost" data-act="del">Delete</button></div></div>`;
    }).join('');
  }

  // ---------- Render: picks ----------
  function renderPicks() {
    const s = stopState();
    $('picksStop').hidden = !s.active;
    const list = $('picksList'); const note = $('picksNote');
    if (!picksData) { note.hidden = false; note.innerHTML = '<strong>Loading picks…</strong>'; list.innerHTML = ''; return; }
    if (picksData.error) { note.hidden = false; note.innerHTML = '<strong>Picks unavailable</strong>Couldn\'t load picks.json right now. Your log and stats still work.'; list.innerHTML = ''; return; }
    const d = picksData;
    $('picksUpdated').textContent = d.updated ? 'Updated ' + fmtET(d.updated) : '';
    const picks = Array.isArray(d.picks) ? d.picks : [];
    const passOn = d.pass === true || (d.pass && d.pass.active);
    const passText = typeof d.pass === 'object' && d.pass ? d.pass.note : d.passNote;
    if (passOn) { note.hidden = false; note.className = 'picks-note pass'; note.innerHTML = `<strong>Pass</strong>${esc(passText || 'The slate is weak. Not betting is a position too.')}`; }
    else if (!picks.length) { note.hidden = false; note.className = 'picks-note'; note.innerHTML = `<strong>No strong plays right now — passing is a win</strong>${esc(d.note || 'Check the passes below for what we looked at.')}`; }
    else if (d.note) { note.hidden = false; note.className = 'picks-note'; note.innerHTML = esc(d.note); }
    else note.hidden = true;
    const u = unitDollar(), mx = maxDollar();
    const RANK = { High: 0, Medium: 1, Low: 2 };
    const openK = new Set([...list.querySelectorAll('details[open][data-k]')].map((x) => x.dataset.k));
    list.innerHTML = picks.map((p, i) => [p, i]).sort((a, b) => (RANK[a[0].confidence] ?? 3) - (RANK[b[0].confidence] ?? 3) || (Number(b[0].units) || 0) - (Number(a[0].units) || 0)).map(([p, i], rank) => {
      const conf = ['Low', 'Medium', 'High'].includes(p.confidence) ? p.confidence : 'Low';
      const units = Math.max(0, Number(p.units) || 0);
      const stake = u == null ? null : Math.min(units * u, mx);
      const capped = u != null && units * u > mx;
      const odds = Number(p.odds);
      const be = validOdds(odds) ? implied(odds) : null;
      const imgs = (Array.isArray(p.images) ? p.images : []).map((x) => (typeof x === 'string' ? { url: x } : x)).filter((x) => x && /^https:\/\//.test(x.url)).slice(0, 3);
      const books = p.books && typeof p.books === 'object' ? Object.entries(p.books).filter(([, v]) => v && (v.odds != null || v.line != null)) : [];
      const bestBook = books.length ? books.reduce((a, b) => (validOdds(Number(b[1].odds)) && (!validOdds(Number(a[1].odds)) || decimal(Number(b[1].odds)) > decimal(Number(a[1].odds))) ? b : a))[0] : null;
      const dd = p.data && typeof p.data === 'object' ? p.data : null;
      const li = (arr) => (Array.isArray(arr) ? arr : arr ? [arr] : []).map((r) => `<li>${esc(r)}</li>`).join('');
      const srcs = (Array.isArray(p.sources) ? p.sources : []).map((x) => (typeof x === 'string' ? { name: x } : x)).filter(Boolean);
      const dataHtml = dd ? `<details class="pick-data" data-k="d${i}"><summary>Data behind it</summary><div class="dgrid">
          ${dd.keyStats ? `<div><h4>Key stats</h4><ul>${li(dd.keyStats)}</ul></div>` : ''}
          ${dd.injuries ? `<div><h4>Injuries</h4><ul>${li(dd.injuries)}</ul></div>` : ''}
          ${dd.matchup ? `<div><h4>Matchup</h4><ul>${li(dd.matchup)}</ul></div>` : ''}
          ${dd.experts ? `<div><h4>What our experts say</h4><ul>${li(dd.experts)}</ul></div>` : ''}
          ${dd.lineMove ? `<div><h4>Line move</h4><p>${esc(dd.lineMove)}</p></div>` : ''}
          ${dd.publicPct && (dd.publicPct.bets != null || dd.publicPct.money != null) ? `<div><h4>Public vs money</h4><div class="split"><span>Bets ${esc(dd.publicPct.bets ?? '—')}%</span><div class="split-bar"><i style="width:${Math.max(0, Math.min(100, Number(dd.publicPct.bets) || 0))}%"></i></div><span>Money ${esc(dd.publicPct.money ?? '—')}%</span><div class="split-bar money"><i style="width:${Math.max(0, Math.min(100, Number(dd.publicPct.money) || 0))}%"></i></div></div>${dd.publicPct.source ? `<p class="muted small">${esc(dd.publicPct.source)}</p>` : ''}</div>` : ''}
          ${dd.fairLine || dd.marketLine ? `<div><h4>Our number vs market</h4><p>Fair <b>${esc(dd.fairLine || '—')}</b> · Market <b>${esc(dd.marketLine || '—')}</b>${dd.model ? `<br><span class="muted small">${esc(dd.model)}</span>` : ''}</p></div>` : ''}
        </div></details>` : '';
      return `<article class="card pick${s.active ? ' disabled' : ''}" data-pid="${i}" style="animation-delay:${rank * 60}ms" aria-disabled="${s.active}">
        <div class="pick-top"><span class="tag">#${rank + 1} · ${esc(p.sport)}</span><span class="conf ${conf}">${conf} confidence</span></div>
        ${imgs.length ? `<div class="pick-imgs">${imgs.map((x) => `<img src="${esc(x.url)}" alt="${esc(x.alt || '')}" loading="lazy" onerror="this.style.visibility='hidden'">`).join('')}</div>` : ''}
        <div class="pick-event">${esc(p.event)}</div>
        <div class="pick-time">${p.start ? esc(fmtET(p.start)) : ''}</div>
        ${p.recheck ? `<div class="pick-recheck">⏱ ${esc(p.recheck)}</div>` : ''}
        <div class="pick-bet"><div><div class="sel">${esc(p.selection)}</div><div class="mkt">${esc(p.market)}</div></div>
          <div><div class="odds">${validOdds(odds) ? fmtOdds(odds) : '—'}</div><div class="book">best: ${esc(p.book || '—')}</div></div></div>
        ${books.length ? `<div class="pick-books">${books.map(([k, v]) => `<div class="pb${k === bestBook ? ' best' : ''}"><span>${esc(k)}</span><b>${esc(v.line != null ? v.line + ' ' : '')}${validOdds(Number(v.odds)) ? fmtOdds(Number(v.odds)) : ''}</b></div>`).join('')}</div>` : ''}
        ${p.line && (p.line.open || p.line.current) ? `<div class="pick-line muted small">Line: opened <b>${esc(p.line.open || '—')}</b> → now <b>${esc(p.line.current || '—')}</b></div>` : ''}
        <div class="pick-stake"><div><span class="muted">Stake</span> <b>${units}u</b></div><div><b>${stake == null ? 'Set bankroll' : fmt$(stake)}</b>${capped ? ' <span class="muted small">(capped at 2%)</span>' : ''}</div>${be != null ? `<div class="muted small" style="margin-left:auto">Break-even ${pct(be)}</div>` : ''}</div>
        ${Array.isArray(p.reasoning) && p.reasoning.length ? `<h4>Why we like it</h4><ul>${p.reasoning.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
        ${Array.isArray(p.risks) && p.risks.length ? `<h4>Key risks</h4><ul class="risks">${p.risks.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
        ${dataHtml}
        ${srcs.length ? `<div class="pick-src muted small">Sources: ${srcs.map((x) => (x.url && /^https?:\/\//.test(x.url) ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name || x.url)}</a>` : esc(x.name))).join(' · ')}</div>` : ''}
        <button class="btn btn-primary" data-pick="${i}" ${s.active ? 'disabled' : ''}>${s.active ? 'No more bets this period' : 'Log this bet'}</button>
      </article>`;
    }).join('');
    document.dispatchEvent(new Event('edge:picks'));
    list.querySelectorAll('details[data-k]').forEach((x) => { if (openK.has(x.dataset.k)) x.open = true; });
    const passes = Array.isArray(d.passes) ? d.passes : [];
    let pe = $('picksPasses'); if (!pe) { pe = document.createElement('div'); pe.id = 'picksPasses'; list.after(pe); }
    pe.innerHTML = passes.length ? `<details class="card passes"><summary>Considered and passed (${passes.length})</summary><ul>${passes.map((x) => `<li>${typeof x === 'string' ? esc(x) : `<b>${esc(x.event)}</b>: ${esc(x.reason)}`}</li>`).join('')}</ul></details>` : '';
  }
  async function loadPicks() {
    try {
      const r = await fetch('picks.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      picksData = await r.json();
    } catch (e) { picksData = { error: true }; }
    window.EdgePicks = picksData;
    renderPicks();
  }
  const SPORT_MAP = (s) => { s = String(s || '').toLowerCase(); if (s === 'nfl') return 'NFL'; if (s.includes('college') || s === 'cfb' || s === 'ncaaf') return 'College Football'; if (s === 'ufc' || s === 'mma') return 'UFC'; return 'Other'; };
  const MARKET_MAP = (m) => { m = String(m || '').toLowerCase(); for (const k of ['moneyline', 'spread', 'total', 'prop', 'parlay']) if (m.includes(k)) return k; if (m === 'ml') return 'moneyline'; return 'other'; };

  // ---------- Bet form ----------
  function prefillForm(o) {
    resetForm();
    $('fDate').value = o.date || etDate();
    if (o.book && ['DraftKings', 'FanDuel'].includes(o.book)) $('fBook').value = o.book;
    $('fSport').value = SPORT_MAP(o.sport); $('fMarket').value = MARKET_MAP(o.market);
    $('fPick').value = o.pick || ''; $('fOdds').value = o.odds != null ? o.odds : '';
    $('fStake').value = o.stake != null ? o.stake.toFixed(2) : '';
    location.hash = '#log';
    setTimeout(() => { const f = $('betForm'); f.scrollIntoView({ behavior: 'smooth', block: 'start' }); f.classList.remove('flash'); void f.offsetWidth; f.classList.add('flash'); }, 60);
    updateFormHints();
  }
  function resetForm() {
    editingId = null; $('betForm').reset(); $('fDate').value = etDate(); $('formTitle').textContent = 'Add a bet'; $('saveBtn').textContent = 'Add bet'; $('cancelEdit').hidden = true;
    document.querySelectorAll('#betForm .invalid').forEach((e) => e.classList.remove('invalid')); $('formWarnings').innerHTML = ''; $('toWin').textContent = '';
  }
  function readForm() {
    return { date: $('fDate').value, book: $('fBook').value, sport: $('fSport').value, market: $('fMarket').value, pick: $('fPick').value.trim(), odds: num($('fOdds').value), stake: num($('fStake').value), closing: num($('fClose').value), result: $('fResult').value };
  }
  function updateFormHints() {
    const f = readForm(); const w = [];
    const cur = currentBankroll();
    if (f.stake > 0 && cur != null && f.stake > cur * MAX_PCT / 100) w.push({ t: `Stake is ${(f.stake / cur * 100).toFixed(1)}% of your bankroll — above the 2% max (${fmt$(cur * MAX_PCT / 100)}).` });
    if (f.stake > 0 && cur == null) w.push({ t: 'Set your starting bankroll in Settings so Edge can check stake size.' });
    if (f.stake > 0 && !editingId) chaseFlagsFor({ id: 'new', stake: f.stake, createdAt: Date.now() }, bets).forEach((t) => w.push({ t: 'Possible chasing: ' + t + ' Take a breath before placing it.' }));
    if (!editingId && stopState().active) w.push({ t: 'You are at your loss limit for this period. No more bets until it resets.', err: true });
    $('formWarnings').innerHTML = w.map((x) => `<div class="warn-msg${x.err ? ' err' : ''}">${esc(x.t)}</div>`).join('');
    $('toWin').textContent = f.stake > 0 && validOdds(f.odds) ? `To win ${fmt$(f.stake * (decimal(f.odds) - 1))}` : '';
  }
  function submitBet(e) {
    e.preventDefault();
    const f = readForm(); let ok = true;
    const mark = (id, bad) => { $(id).classList.toggle('invalid', bad); if (bad) ok = false; };
    mark('fDate', !/^\d{4}-\d{2}-\d{2}$/.test(f.date)); mark('fPick', !f.pick); mark('fOdds', !validOdds(f.odds)); mark('fStake', !(f.stake > 0));
    mark('fClose', f.closing != null && !validOdds(f.closing));
    if (!ok) { toast('Check the highlighted fields. Odds look like -110 or +150.'); return; }
    if (!editingId && stopState().active && !confirm('You\'ve hit your loss limit for this period. Only continue if you are logging a bet you already placed before the limit was hit.')) return;
    if (editingId) {
      const b = bets.find((x) => x.id === editingId);
      if (b) { const wasPending = b.result === 'pending'; Object.assign(b, f); if (wasPending && f.result !== 'pending') b.settledAt = Date.now(); if (f.result === 'pending') delete b.settledAt; }
      toast('Bet updated');
    } else {
      const b = Object.assign({ id: uid(), createdAt: Date.now() }, f); if (f.result !== 'pending') b.settledAt = Date.now();
      bets.push(b); toast('Bet logged. Stick to the plan.');
    }
    save(K.bets, bets); resetForm(); renderAll();
  }
  function onBetAction(e) {
    const btn = e.target.closest('button[data-act]'); if (!btn) return;
    const id = btn.closest('.bet').dataset.id; const b = bets.find((x) => x.id === id); if (!b) return;
    const act = btn.dataset.act;
    if (['win', 'loss', 'push', 'void'].includes(act)) { b.result = act; b.settledAt = Date.now(); save(K.bets, bets); renderAll(); toast(act === 'win' ? 'Settled: win' : act === 'loss' ? 'Settled: loss. Next bet same size or smaller.' : 'Settled: ' + act); return; }
    if (act === 'del') { if (confirm('Delete this bet? This cannot be undone.')) { bets = bets.filter((x) => x.id !== id); save(K.bets, bets); if (editingId === id) resetForm(); renderAll(); toast('Bet deleted'); } return; }
    if (act === 'edit') {
      editingId = id; $('fDate').value = b.date; $('fBook').value = b.book; $('fSport').value = b.sport; $('fMarket').value = b.market; $('fPick').value = b.pick;
      $('fOdds').value = b.odds; $('fStake').value = b.stake; $('fClose').value = b.closing == null ? '' : b.closing; $('fResult').value = b.result;
      $('formTitle').textContent = 'Edit bet'; $('saveBtn').textContent = 'Save changes'; $('cancelEdit').hidden = false;
      $('betForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); updateFormHints();
    }
  }

  // ---------- Line shop ----------
  function lineCalc(r) {
    const dk = validOdds(r.dk) ? r.dk : null, fd = validOdds(r.fd) ? r.fd : null;
    let best = null;
    if (dk != null && fd != null) best = decimal(dk) > decimal(fd) ? 'DK' : decimal(fd) > decimal(dk) ? 'FD' : 'tie';
    else if (dk != null) best = 'DK'; else if (fd != null) best = 'FD';
    const fair = [];
    if (dk != null && validOdds(r.dko)) { const a = implied(dk), b = implied(r.dko); fair.push({ p: a / (a + b), hold: a + b - 1, bk: 'DK' }); }
    if (fd != null && validOdds(r.fdo)) { const a = implied(fd), b = implied(r.fdo); fair.push({ p: a / (a + b), hold: a + b - 1, bk: 'FD' }); }
    const fairP = fair.length ? fair.reduce((s, x) => s + x.p, 0) / fair.length : null;
    const bestOdds = best === 'FD' ? fd : dk != null ? dk : fd;
    const ev = fairP != null && bestOdds != null ? fairP * decimal(bestOdds) - 1 : null;
    return { dk, fd, best, bestOdds, fairP, fairOdds: fairP != null ? probToAmerican(fairP) : null, fair, centsDiff: dk != null && fd != null ? cents(dk, fd) : null, ev };
  }
  function renderLines() {
    if (!lines.length) { $('lsList').innerHTML = '<div class="empty">No rows yet. Enter the same bet at both books to see who has the better number.</div>'; return; }
    $('lsList').innerHTML = lines.slice().reverse().map((r) => {
      const c = lineCalc(r);
      const book = (k, o, oo) => `<div class="ls-book${c.best === k ? ' best' : ''}">${c.best === k ? '<span class="badge">BEST</span>' : ''}<div class="bk">${k === 'DK' ? 'DraftKings' : 'FanDuel'}</div><div class="od">${fmtOdds(o)}</div><div class="ip">${o != null ? 'Implied ' + pct(implied(o)) : 'Not entered'}${validOdds(oo) ? ` · other side ${fmtOdds(oo)}` : ''}</div></div>`;
      const sum = [];
      if (c.centsDiff != null) sum.push(c.best === 'tie' ? 'Same price at both books' : `<b>${c.best === 'DK' ? 'DraftKings' : 'FanDuel'}</b> is better by <b>${c.centsDiff}¢</b>`);
      if (c.fairOdds != null) sum.push(`No-vig fair <b>${fmtOdds(c.fairOdds)}</b> (${pct(c.fairP)})`);
      c.fair.forEach((f) => sum.push(`${f.bk} hold ${pct(f.hold)}`));
      if (c.ev != null) sum.push(`Best price vs fair: <b class="${cls(c.ev * 100)}">${(c.ev >= 0 ? '+' : '') + (c.ev * 100).toFixed(1)}% EV</b>`);
      return `<div class="bet" data-id="${r.id}"><div class="bet-head"><div><div class="bet-pick">${esc(r.sel)}</div><div class="bet-meta">${esc(r.event)} · ${esc(r.sport)} · ${esc(r.market)}</div></div></div>
        <div class="ls-grid">${book('DK', c.dk, r.dko)}${book('FD', c.fd, r.fdo)}</div>
        ${sum.length ? `<div class="ls-summary">${sum.map((x) => `<span>${x}</span>`).join('')}</div>` : ''}
        <div class="bet-actions"><button class="btn btn-sm btn-primary" data-ls="log" ${c.bestOdds == null ? 'disabled' : ''}>Add to bet log</button><button class="btn btn-sm btn-ghost" data-ls="del">Remove</button></div></div>`;
    }).join('');
  }
  function submitLine(e) {
    e.preventDefault();
    const r = { id: uid(), createdAt: Date.now(), event: $('lsEvent').value.trim(), sport: $('lsSport').value, market: $('lsMarket').value, sel: $('lsSel').value.trim(), dk: num($('lsDK').value), fd: num($('lsFD').value), dko: num($('lsDKo').value), fdo: num($('lsFDo').value) };
    const errs = [];
    if (!r.sel) errs.push('Add a selection.');
    if (!validOdds(r.dk) && !validOdds(r.fd)) errs.push('Enter at least one book\'s odds (like -110 or +150).');
    ['dk', 'fd', 'dko', 'fdo'].forEach((k) => { if (r[k] != null && !validOdds(r[k])) errs.push('Odds must be ≤ -100 or ≥ +100.'); });
    $('lsWarn').innerHTML = [...new Set(errs)].map((t) => `<div class="warn-msg err">${esc(t)}</div>`).join('');
    if (errs.length) return;
    lines.push(r); save(K.lines, lines); $('lsForm').reset(); renderLines(); toast('Row added');
  }
  function onLineAction(e) {
    const btn = e.target.closest('button[data-ls]'); if (!btn) return;
    const id = btn.closest('.bet').dataset.id; const r = lines.find((x) => x.id === id); if (!r) return;
    if (btn.dataset.ls === 'del') { lines = lines.filter((x) => x.id !== id); save(K.lines, lines); renderLines(); return; }
    const c = lineCalc(r);
    const u = unitDollar();
    prefillForm({ book: c.best === 'FD' ? 'FanDuel' : 'DraftKings', sport: r.sport, market: r.market, pick: [r.event, r.sel].filter(Boolean).join(' — '), odds: c.bestOdds, stake: u != null ? u : null });
  }

  // ---------- Tracker ----------
  const nowLocalInput = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  function renderWatch() {
    const list = watch.filter((w) => trFilter === 'all' || w.sport === trFilter).sort((a, b) => b.when - a.when);
    const TL = { injury: 'Injury', practice: 'Practice', weight: 'Weigh-in', line: 'Line move', other: 'Note' };
    if (!list.length) { $('trList').innerHTML = `<div class="empty">${watch.length ? 'Nothing for this sport.' : 'Watchlist is empty. Track injuries, practice reports, missed weight, and line moves from open to current.'}</div>`; return; }
    $('trList').innerHTML = list.map((w) => {
      const isUrl = /^https?:\/\//i.test(w.src || '');
      return `<div class="bet" data-id="${w.id}"><div class="bet-head"><div><div class="bet-pick">${esc(w.subj)}</div><div class="bet-meta">${esc(w.sport)} · ${esc(fmtET(w.when))}</div></div><div><span class="tr-type ${esc(w.type)}">${TL[w.type] || 'Note'}</span></div></div>
        <div class="tr-note">${esc(w.note)}</div>
        <div class="bet-meta" style="margin-top:6px">Source: ${w.src ? (isUrl ? `<a href="${esc(w.src)}" target="_blank" rel="noopener">${esc(w.src.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48))}</a>` : esc(w.src)) : '—'}</div>
        <div class="bet-actions"><button class="btn btn-sm btn-ghost" data-tr="del">Remove</button></div></div>`;
    }).join('');
  }
  function submitWatch(e) {
    e.preventDefault();
    const subj = $('trSubj').value.trim(), note = $('trNote').value.trim();
    if (!subj || !note) { toast('Add a team/fighter and a note.'); return; }
    const when = $('trWhen').value ? new Date($('trWhen').value).getTime() : Date.now();
    watch.push({ id: uid(), sport: $('trSport').value, type: $('trType').value, subj, note, src: $('trSrc').value.trim(), when: isFinite(when) ? when : Date.now() });
    save(K.watch, watch); $('trSubj').value = ''; $('trNote').value = ''; $('trSrc').value = ''; $('trWhen').value = nowLocalInput(); renderWatch(); toast('Added to watchlist');
  }

  // ---------- Weekly rhythm ----------
  // days: 0=Sun..6=Sat (ET)
  const RHYTHM = [
    { id: 'openers', when: 'Sun night – Mon', days: [0, 1], task: 'Record openers and update EPA ratings.' },
    { id: 'cfbopen', when: 'Mon – Tue', days: [1, 2], task: 'College football: compare your ratings vs openers.' },
    { id: 'practice', when: 'Wed – Fri · ~4 PM ET', days: [3, 4, 5], task: 'NFL practice reports (DNP / LP / FP). Friday brings game designations.' },
    { id: 'splits', when: 'Thu – Fri', days: [4, 5], task: 'Line moves and public vs money splits.' },
    { id: 'weighins', when: 'Fri · UFC weeks', days: [5], task: 'UFC weigh-ins and any missed weight.' },
    { id: 'satcfb', when: 'Sat morning', days: [6], task: 'CFB injuries and weather, then line shop DK vs FD.' },
    { id: 'inactives', when: 'Sun · 10:30–11:45 AM ET', days: [0], task: 'NFL inactives and late line moves.' },
    { id: 'closing', when: 'After games', days: [0, 1, 4, 6], task: 'Log closing lines and check CLV.' }
  ];
  function renderRhythm() {
    const today = etDate(); const ws = weekStart(today); const d = dow(today);
    let st = load(K.rhythm, {}); if (st.week !== ws) { st = { week: ws, done: {} }; save(K.rhythm, st); }
    $('rhWeek').textContent = `Week of ${fmtDay(ws)}`;
    $('rhList').innerHTML = RHYTHM.map((r) => {
      const isToday = r.days.includes(d), done = !!st.done[r.id];
      return `<label class="rh-item${isToday ? ' today' : ''}${done ? ' done' : ''}" data-id="${r.id}"><input type="checkbox" ${done ? 'checked' : ''}><span class="rh-box"></span><span><div class="rh-when">${esc(r.when)}${isToday ? '<span class="today-pill">TODAY</span>' : ''}</div><div class="rh-task">${esc(r.task)}</div></span></label>`;
    }).join('');
  }
  function onRhythm(e) {
    const it = e.target.closest('.rh-item'); if (!it || e.target.tagName !== 'INPUT') return;
    const st = load(K.rhythm, { week: weekStart(etDate()), done: {} }); st.done[it.dataset.id] = e.target.checked; save(K.rhythm, st); it.classList.toggle('done', e.target.checked);
  }

  // ---------- Sources ----------
  const SOURCES = [
    { cat: 'Efficiency & ratings', items: [
      ['NFL Next Gen Stats', 'https://nextgenstats.nfl.com', 'Player tracking: separation, CPOE, pressure, rushing over expected.', 'free'],
      ['nflfastR', 'https://www.nflfastr.com', 'Play-by-play data with EPA/WP — the base for your own ratings.', 'free'],
      ['rbsdm', 'https://rbsdm.com', 'Quick EPA/play and success-rate team and QB charts.', 'free'],
      ['collegefootballdata.com', 'https://collegefootballdata.com', 'CFB play-by-play, advanced stats, and an API.', 'free'],
      ['Punt and Rally (SP+)', 'https://www.puntandrally.com', 'Bill Connelly\'s SP+ ratings and writing.', 'free'],
      ['ESPN FPI', 'https://www.espn.com/college-football/fpi', 'Power index and projected win probabilities.', 'free'],
      ['FTN DVOA', 'https://www.ftnfantasy.com/nfl/dvoa', 'Opponent-adjusted efficiency (DVOA).', 'partly'],
      ['PFF', 'https://www.pff.com', 'Player grades, line play, coverage data.', 'paid'] ] },
    { cat: 'Stats & history', items: [
      ['Pro-Football-Reference', 'https://www.pro-football-reference.com', 'Box scores, splits, historical results.', 'free'],
      ['Sports-Reference CFB', 'https://www.sports-reference.com/cfb/', 'College football stats and schedules.', 'free'],
      ['TeamRankings', 'https://www.teamrankings.com/nfl/', 'ATS and O/U trends, team stat rankings.', 'partly'],
      ['Covers matchups', 'https://www.covers.com/sports/nfl/matchups', 'Matchup pages, consensus, ATS records.', 'free'],
      ['OddsShark', 'https://www.oddsshark.com/nfl/odds', 'Odds screen plus historical database.', 'free'],
      ['NFLPenalties', 'https://www.nflpenalties.com', 'Referee crew tendencies and penalty rates.', 'free'] ] },
    { cat: 'Injuries', items: [
      ['NFL.com injuries', 'https://www.nfl.com/injuries/', 'Official practice participation and game status.', 'free'],
      ['ESPN NFL injuries', 'https://www.espn.com/nfl/injuries', 'Team-by-team injury list with notes.', 'free'] ] },
    { cat: 'Lines & splits', items: [
      ['VegasInsider', 'https://www.vegasinsider.com/nfl/odds/las-vegas/', 'Odds across books, openers vs current.', 'free'],
      ['SportsbookReview', 'https://www.sportsbookreview.com/betting-odds/nfl-football/', 'Line screen with line-history per book.', 'free'],
      ['Action Network splits', 'https://www.actionnetwork.com/nfl/public-betting', 'Bet % vs money %. Splits come from partner-book samples, not the whole market.', 'partly'],
      ['Unabated', 'https://www.unabated.com', 'No-vig fair lines and market tools.', 'paid'] ] },
    { cat: 'UFC', items: [
      ['BestFightOdds', 'https://www.bestfightodds.com', 'MMA line shopping across books and line movement.', 'free'],
      ['UFC athletes', 'https://www.ufc.com/athletes', 'Official profiles, reach, records and stats.', 'free'],
      ['Fight Matrix', 'https://www.fightmatrix.com', 'Ratings and historical rankings.', 'free'],
      ['Sherdog', 'https://www.sherdog.com', 'Fighter records, fight finder and news.', 'free'],
      ['Tapology', 'https://www.tapology.com', 'Records, cards and late-change news.', 'free'] ] }
  ];
  const XACCTS = [
    ['lasvegascris', 'Contest record (Circa / SuperContest history)', true],
    ['benbbaldwin', 'NFL analytics, EPA', false], ['mrcaseb', 'nflfastR / data viz', false], ['StatsbyLopez', 'Sports stats & modeling', false],
    ['SethWalder', 'ESPN analytics', false], ['ESPN_BillC', 'SP+ creator (CFB)', false], ['CFB_Data', 'College football data', false],
    ['ActionNetworkHQ', 'Odds & betting news', false], ['CircaSports', 'Book: lines & limits news', false], ['PJWalsh24', 'Market / line-move notes', false],
    ['Josh_Insights', 'Free notes only — sells picks', false], ['SharpFootball', 'Stats only — sells picks', false],
    ['AdamSchefter', 'NFL news & injuries', false], ['RapSheet', 'NFL news & injuries', false], ['ProFootballDoc', 'Injury analysis', false],
    ['SeanZerillo', 'Betting analysis', false], ['Fightnomics', 'UFC stats & analytics', false], ['BestFightOdds', 'MMA line moves', false],
    ['arielhelwani', 'MMA news', false], ['marcraimondi', 'MMA news', false]
  ];
  function renderSources() {
    const PL = { free: 'Free', partly: 'Partly paid', paid: 'Mostly paid' };
    $('srcList').innerHTML = '<div class="src-cols">' + SOURCES.map((g) => `<div class="card src-group"><div class="card-label">${esc(g.cat)}</div>${g.items.map(([n, u, d, p]) => `<a class="src-item" href="${u}" target="_blank" rel="noopener"><div><div class="src-name">${esc(n)} ↗</div><div class="src-desc">${esc(d)}</div></div><span class="price ${p}">${PL[p]}</span></a>`).join('')}</div>`).join('') + '</div>';
    $('xList').innerHTML = XACCTS.map(([h, n, rec]) => `<a class="x-item" href="https://x.com/${h}" target="_blank" rel="noopener"><div><div class="x-h">@${h}</div><div class="x-n">${esc(n)}</div></div><span class="x-lab${rec ? ' rec' : ''}">${rec ? 'Verified contest record' : 'Info source'}</span></a>`).join('');
  }

  // ---------- Import / export ----------
  const CSV_COLS = ['id', 'date', 'book', 'sport', 'market', 'pick', 'odds', 'stake', 'closing', 'result', 'createdAt', 'settledAt'];
  const csvCell = (v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    const head = (rows.shift() || []).map((h) => h.trim());
    return rows.filter((r) => r.some((c) => c.trim() !== '')).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  }
  function normalizeBet(o) {
    const b = { id: o.id || uid(), date: String(o.date || '').slice(0, 10), book: o.book === 'FanDuel' ? 'FanDuel' : 'DraftKings', sport: ['NFL', 'College Football', 'UFC', 'Other'].includes(o.sport) ? o.sport : SPORT_MAP(o.sport),
      market: ['moneyline', 'spread', 'total', 'prop', 'parlay', 'other'].includes(o.market) ? o.market : MARKET_MAP(o.market), pick: String(o.pick || '').slice(0, 140), odds: num(o.odds), stake: num(o.stake), closing: num(o.closing),
      result: ['pending', 'win', 'loss', 'push', 'void'].includes(String(o.result).toLowerCase()) ? String(o.result).toLowerCase() : 'pending', createdAt: num(o.createdAt) || Date.now(), settledAt: num(o.settledAt) || undefined };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !validOdds(b.odds) || !(b.stake > 0)) return null;
    if (!validOdds(b.closing)) b.closing = null;
    return b;
  }
  function onImport(e) {
    const file = e.target.files[0]; if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        let incoming, inSettings = null;
        if (/\.json$/i.test(file.name) || /^\s*[\[{]/.test(rd.result)) { const j = JSON.parse(rd.result); incoming = Array.isArray(j) ? j : j.bets || []; inSettings = Array.isArray(j) ? null : j.settings || null; }
        else incoming = parseCSV(rd.result);
        const ok = incoming.map(normalizeBet).filter(Boolean); const skipped = incoming.length - ok.length;
        if (!ok.length && !inSettings) { toast('No valid bets found in that file.'); return; }
        if (!confirm(`Replace your current log (${bets.length} bets) with ${ok.length} imported bets${skipped ? ` (${skipped} invalid rows skipped)` : ''}${inSettings ? ' and imported settings' : ''}?`)) return;
        bets = ok; save(K.bets, bets);
        if (inSettings) { settings = sanitizeSettings(inSettings); save(K.settings, settings); renderSettings(); }
        renderAll(); toast(`Imported ${ok.length} bets`);
      } catch (err) { toast('Could not read that file.'); }
      finally { e.target.value = ''; }
    };
    rd.readAsText(file);
  }
  function sanitizeSettings(s) {
    const pos = (v) => { const n = num(v); return n != null && n > 0 ? n : null; };
    let u = num(s.unitPct); if (!(u >= 1 && u <= 2)) u = 1;
    return { bankroll: pos(s.bankroll), unitPct: u, dailyLimit: pos(s.dailyLimit), weeklyLimit: pos(s.weeklyLimit) };
  }

  // ---------- Wire up ----------
  function renderAll() { renderGuardrails(); renderStats(); renderBets(); renderPicks(); renderUnitReadout(); }

  function init() {
    // sign toggles for odds inputs
    document.addEventListener('click', (e) => {
      const s = e.target.closest('.sign'); if (!s) return;
      const inp = $(s.dataset.for); const v = inp.value.trim();
      inp.value = v.startsWith('-') ? v.slice(1) : v.startsWith('+') ? '-' + v.slice(1) : '-' + v;
      inp.dispatchEvent(new Event('input', { bubbles: true })); inp.focus();
    });
    $('settingsForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const u = document.querySelector('#sUnit button.on');
      settings = sanitizeSettings({ bankroll: $('sBankroll').value, unitPct: u ? u.dataset.v : 1, dailyLimit: $('sDaily').value, weeklyLimit: $('sWeekly').value });
      save(K.settings, settings); renderSettings(); renderAll();
      $('settingsSaved').textContent = 'Saved'; setTimeout(() => ($('settingsSaved').textContent = ''), 1800); toast('Settings saved');
    });
    $('sUnit').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; document.querySelectorAll('#sUnit button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); }); renderUnitReadout(); });
    $('sBankroll').addEventListener('input', renderUnitReadout);

    $('betForm').addEventListener('submit', submitBet);
    $('betForm').addEventListener('input', updateFormHints);
    $('betForm').addEventListener('change', updateFormHints);
    $('cancelEdit').addEventListener('click', resetForm);
    $('betList').addEventListener('click', onBetAction);
    document.querySelectorAll('.log-filters [data-filter]').forEach((c) => c.addEventListener('click', () => { filter = c.dataset.filter; document.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('active', x === c)); renderBets(); }));
    $('picksList').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-pick]'); if (!b || !picksData || !picksData.picks) return;
      if (stopState().active) { toast('Limit reached — no more bets this period.'); return; }
      const p = picksData.picks[+b.dataset.pick]; const u = unitDollar(), mx = maxDollar();
      prefillForm({ book: p.book, sport: p.sport, market: p.market, pick: [p.event, p.selection].filter(Boolean).join(' — '), odds: Number(p.odds), stake: u == null ? null : Math.min((Number(p.units) || 0) * u, mx) });
    });

    $('lsForm').addEventListener('submit', submitLine);
    $('lsList').addEventListener('click', onLineAction);
    $('trForm').addEventListener('submit', submitWatch);
    $('trList').addEventListener('click', (e) => { const b = e.target.closest('button[data-tr]'); if (!b) return; const id = b.closest('.bet').dataset.id; watch = watch.filter((x) => x.id !== id); save(K.watch, watch); renderWatch(); });
    $('trFilters').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (!c) return; trFilter = c.dataset.sport; $('trFilters').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === c)); renderWatch(); });
    $('trWhen').value = nowLocalInput();
    $('rhList').addEventListener('change', onRhythm);
    $('rhReset').addEventListener('click', () => { save(K.rhythm, { week: weekStart(etDate()), done: {} }); renderRhythm(); });

    $('expCSV').addEventListener('click', () => { const csv = [CSV_COLS.join(',')].concat(bets.map((b) => CSV_COLS.map((c) => csvCell(b[c])).join(','))).join('\n'); download(`edge-bets-${etDate()}.csv`, csv, 'text/csv'); });
    $('expJSON').addEventListener('click', () => download(`edge-backup-${etDate()}.json`, JSON.stringify({ app: 'edge', version: 1, exportedAt: new Date().toISOString(), settings, bets }, null, 2), 'application/json'));
    $('impFile').addEventListener('change', onImport);

    resetForm(); renderSettings(); renderAll(); renderLines(); renderWatch(); renderRhythm(); renderSources(); route();
    loadPicks();
    // Refresh period-based UI every minute (day/week rollovers).
    setInterval(() => { renderGuardrails(); renderPicks(); renderRhythm(); }, 60e3);
    window.addEventListener('load', () => { if (typeof Chart !== 'undefined') renderChart(); });
  }
  window.Edge = {
    esc, fmtOdds, fmtET, implied, decimal, validOdds, probToAmerican, pct, toast, etDate, weekStart, addDays,
    prefillForm, unitDollar, stopState, fmtDay,
    addLine(r) { lines.push(Object.assign({ id: uid(), createdAt: Date.now() }, r)); save(K.lines, lines); renderLines(); },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
