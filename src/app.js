'use strict';
/* ============================================================================
   QuantStorm R2 Trainer — UI
   ========================================================================== */
const $ = id => document.getElementById(id);
const fmt = (x, d = 1) => x == null ? '–' : (Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : x.toFixed(d));
const cls = x => x > 0 ? 'pos' : x < 0 ? 'neg' : '';

let M = null, sel = null, paused = false, lastFrame = 0, rafId = 0, lastFeedLen = 0, reviewShown = false;

/* ---------------- session ---------------- */
function newSession() {
  const L = $('level').value, seedIn = $('seed').value;
  const seed = seedIn === '' ? Math.floor(Math.random() * 1e9) : Number(seedIn);
  const cfg = PRESETS[L];
  M = new Market(cfg, seed); window.M = M;
  sel = M.instruments[0].id;
  paused = false; reviewShown = false; lastFeedLen = 0;
  $('hLevel').textContent = L + ' · seed ' + seed;
  $('showFair').checked = !!cfg.showFair; $('showArb').checked = L === 'L2' || L === 'L1';
  $('feed').innerHTML = ''; $('review').classList.add('hidden');
  $('btnPause').textContent = 'Pause';
  M.userFair = {};
  Tutorial.reset(M, L);
  renderAll(); msg(`New ${cfg.name} session. ${cfg.duration}s. Position limits: stock ±${cfg.limits.stock}, ETF ±${cfg.limits.etf}, option ±${cfg.limits.option}.`);
}
function msg(s, bad = false) { const el = $('msg'); el.textContent = s; el.style.color = bad ? 'var(--ask)' : 'var(--mut)'; }

/* ---------------- loop ---------------- */
function frame(ts) {
  rafId = requestAnimationFrame(frame);
  if (!M) return;
  const dt = lastFrame ? Math.min(0.25, (ts - lastFrame) / 1000) : 0; lastFrame = ts;
  if (!paused && !M.done && document.getElementById('tab-trade').classList.contains('hidden') === false) M.step(dt * Number($('speed').value));
  renderAll();
  Tutorial.update(M);
  if (M.done && !reviewShown) { reviewShown = true; showReview(); }
}

/* ---------------- rendering ---------------- */
function renderAll() {
  if (!M) return;
  const left = Math.max(0, M.cfg.duration - M.t);
  $('hClock').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
  const pnl = M.pnl(M.user); $('hPnl').textContent = fmt(pnl); $('hPnl').className = cls(pnl);
  const lb = M.leaderboard(); $('hRank').textContent = (lb.findIndex(x => x.id === 'YOU') + 1) + '/' + lb.length;
  renderWatch(); renderBook(); renderInfo(); renderFair(); renderArb(); renderFeed(); renderOrders(); renderPositions(lb); renderChart();
}
function renderWatch() {
  const tb = $('watch').tBodies[0]; let html = '';
  const showF = $('showFair').checked;
  for (const inst of M.instruments) {
    const b = M.books[inst.id], bb = b.bestBid(), ba = b.bestAsk();
    const f = M.fair(M.user, inst.id), sd = M.uncertainty(M.user, inst.id), pos = M.user.position(inst.id);
    const uf = M.userFair[inst.id];
    html += `<tr class="clk ${inst.id === sel ? 'sel' : ''}" data-id="${inst.id}"><td><b>${inst.id}</b> <span class="m">${inst.type}</span></td>
      <td class="b">${bb ?? '–'}<span class="m" style="font-size:10px"> ×${bb != null ? b.bestBidQty() : ''}</span></td>
      <td class="a">${ba ?? '–'}<span class="m" style="font-size:10px"> ×${ba != null ? b.bestAskQty() : ''}</span></td>
      <td>${b.last ?? '–'}</td>
      <td>${showF ? `<span class="acc">${fmt(f, 1)}</span>` : ''}<input data-uf="${inst.id}" type="number" step="0.5" value="${uf ?? ''}" placeholder="yours" style="width:58px;padding:1px 3px;margin-left:3px"></td>
      <td class="m">${showF ? fmt(sd, 1) : ''}</td><td class="${cls(pos)}">${pos}</td></tr>`;
  }
  if (tb.dataset.html !== html) {
    const active = document.activeElement, activeUf = active && active.dataset ? active.dataset.uf : null, val = active ? active.value : null, selS = active ? active.selectionStart : null;
    tb.innerHTML = html; tb.dataset.html = html;
    if (activeUf) { const el = tb.querySelector(`input[data-uf="${activeUf}"]`); if (el) { el.value = val; el.focus(); try { el.setSelectionRange(selS, selS); } catch (e) { } } }
  }
}
function renderBook() {
  const inst = M.inst(sel), b = M.books[sel];
  $('selName').textContent = sel;
  let info = `limit ±${inst.limit}`;
  if (inst.type === 'etf') info += ` · = ${inst.components.join('+')}`;
  if (inst.type === 'call' || inst.type === 'put') info += ` · ${inst.type} on ${inst.under}, K=${inst.strike}`;
  const sp = b.spread(); if (sp != null) info += ` · spread ${sp}`;
  $('selInfo').textContent = info;
  const bids = b.levels('buy', 8, 'YOU'), asks = b.levels('sell', 8, 'YOU');
  const maxQ = Math.max(1, ...bids.map(l => l.qty), ...asks.map(l => l.qty));
  const row = (l, side) => `<div class="lvl ${l.mine ? 'mine' : ''}"><div class="bar" style="width:${100 * l.qty / maxQ}%"></div><span class="${side === 'buy' ? 'b' : 'a'}">${l.price}</span><span>${l.qty}${l.mine ? `<span class="acc"> (${l.mine})</span>` : ''}</span></div>`;
  $('bookBids').innerHTML = `<div class="m" style="text-align:center;font-size:10px">BIDS</div>` + bids.map(l => row(l, 'buy')).join('');
  $('bookAsks').innerHTML = `<div class="m" style="text-align:center;font-size:10px">ASKS</div>` + asks.map(l => row(l, 'sell')).join('');
}
function renderInfo() {
  let html = '';
  for (const s of Object.values(M.stocks)) {
    const known = M.knownSet(M.user, s.id);
    let sum = 0; for (const i of known) sum += s.cards[i];
    const nHid = s.cards.length - known.size;
    html += `<div style="margin-bottom:6px"><b>${s.id}</b> <span class="m">known ${known.size}/${s.cards.length}, sum of known = ${sum}, hidden ${nHid} (× 7 = ${7 * nHid}) → </span><span class="acc">${$('showFair').checked ? `E = ${sum + 7 * nHid}` : 'E = ?'}</span><div class="cards">`;
    for (let i = 0; i < s.cards.length; i++) {
      const pub = s.pub.has(i), prv = M.user.priv[s.id] && M.user.priv[s.id].has(i);
      html += `<span class="card ${pub ? 'pub' : prv ? 'prv' : 'hid'}">${pub || prv ? s.cards[i] : '?'}</span>`;
    }
    html += '</div></div>';
  }
  $('info').innerHTML = html;
}
function renderFair() {
  if (!$('showFair').checked) { $('fairHelp').innerHTML = '<span class="m">Hidden. Estimate it yourself: fair ≈ sum of known cards + 7 × hidden cards. SD ≈ 3.74 × √hidden. For options use the normal approximation (see Guide). Toggle on to check.</span>'; return; }
  let html = '<table><thead><tr><th>inst</th><th>fair</th><th>sd</th><th>your est.</th><th>err</th><th>note</th></tr></thead><tbody>';
  for (const inst of M.instruments) {
    const f = M.fair(M.user, inst.id), sd = M.uncertainty(M.user, inst.id), uf = M.userFair[inst.id];
    let note = '';
    if (inst.type === 'call' || inst.type === 'put') { const d = M.distStock(M.user, inst.under); note = `${inst.type} K=${inst.strike}: normal-approx ${fmt(inst.type === 'call' ? bachelierCall(d.mean, d.sd, inst.strike) : bachelierPut(d.mean, d.sd, inst.strike), 2)}, delta ${fmt(optionDelta(d, inst.type, inst.strike), 2)}`; }
    if (inst.type === 'etf') note = 'sum of component fairs';
    html += `<tr><td>${inst.id}</td><td class="acc">${fmt(f, 2)}</td><td class="m">${fmt(sd, 1)}</td><td>${uf ?? ''}</td><td class="${uf != null ? (Math.abs(uf - f) <= 1 ? 'pos' : 'neg') : ''}">${uf != null ? fmt(uf - f, 1) : ''}</td><td class="m">${note}</td></tr>`;
  }
  $('fairHelp').innerHTML = html + '</tbody></table>';
}
function renderArb() {
  if (!$('showArb').checked) { $('arb').innerHTML = '<span class="m">Alerts hidden. Check yourself: ETF bid vs A+B+C asks (and vice versa); C − P vs S − K at each strike.</span>'; return; }
  const opps = findArbs(M);
  if (!opps.length) { $('arb').innerHTML = '<span class="m">No riskless top-of-book arbitrage right now.</span>'; return; }
  $('arb').innerHTML = opps.map(o => `<div class="tipbox">⚡ ${o.desc} · up to ${o.qty} unit(s) <button class="sm" data-arb="${o.key}">execute</button></div>`).join('');
}
function renderFeed() {
  if (M.log.length === lastFeedLen) return;
  const el = $('feed');
  for (let i = lastFeedLen; i < M.log.length; i++) { const e = M.log[i]; const d = document.createElement('div'); d.className = e.type; d.textContent = `[${Math.floor(e.t)}s] ${e.text}`; el.prepend(d); }
  lastFeedLen = M.log.length;
}
function renderOrders() {
  const os = M.myOrders('YOU');
  $('orders').tBodies[0].innerHTML = os.length ? os.map(o => `<tr><td>${o.inst}</td><td class="${o.side === 'buy' ? 'b' : 'a'}">${o.side}</td><td>${o.price}</td><td>${o.qty}</td><td><button class="sm" data-cancel="${o.id}">×</button></td></tr>`).join('') : '<tr><td class="m" colspan="5">none</td></tr>';
}
function renderPositions(lb) {
  let html = '';
  for (const inst of M.instruments) { const p = M.user.position(inst.id); if (!p) continue; const mk = M.done ? M.trueValue(inst.id) : M.mark(inst.id); html += `<tr><td>${inst.id}</td><td class="${cls(p)}">${p}</td><td>${fmt(mk)}</td><td>${fmt(p * mk)}</td></tr>`; }
  $('positions').tBodies[0].innerHTML = html || '<tr><td class="m" colspan="4">flat</td></tr>';
  const d = M.deltas(M.user);
  $('deltas').innerHTML = 'cash ' + fmt(M.user.cash) + ' · delta: ' + Object.entries(d).map(([k, v]) => `${k} <span class="${cls(v)}">${fmt(v, 1)}</span>`).join(' · ');
  $('lb').tBodies[0].innerHTML = lb.map((x, i) => `<tr ${x.id === 'YOU' ? 'class="sel"' : ''}><td>${i + 1}. ${x.label}${M.done && x.id !== 'YOU' ? ` <span class="chip">${x.kind}</span>` : ''}</td><td class="${cls(x.pnl)}">${fmt(x.pnl)}</td></tr>`).join('');
}
function renderChart() {
  const c = $('chart'), ctx = c.getContext('2d'); $('chartName').textContent = sel;
  const W = c.width, H = c.height; ctx.fillStyle = '#0e141b'; ctx.fillRect(0, 0, W, H);
  const S = M.series; if (S.length < 2) return;
  const mids = S.map(s => s.mids[sel]).filter(x => x != null), fairs = S.map(s => s.myf[sel]);
  const all = mids.concat(fairs).concat(M.done ? S.map(s => s.fairs[sel]) : []);
  let lo = Math.min(...all), hi = Math.max(...all); if (hi - lo < 4) { hi += 2; lo -= 2; } const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const X = t => 8 + (W - 16) * t / M.cfg.duration, Y = v => H - 6 - (H - 12) * (v - lo) / (hi - lo);
  const line = (get, color, w) => { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); let started = false; for (const s of S) { const v = get(s); if (v == null) continue; if (!started) { ctx.moveTo(X(s.t), Y(v)); started = true; } else ctx.lineTo(X(s.t), Y(v)); } ctx.stroke(); };
  if (M.done) line(s => s.fairs[sel], '#4ea1ff', 1);
  line(s => s.myf[sel], '#f5b342', 1);
  line(s => s.mids[sel], '#dbe4ee', 1.5);
  // my trades
  for (const f of M.trades) { if (f.inst !== sel || (f.buyer !== 'YOU' && f.seller !== 'YOU')) continue; ctx.fillStyle = f.buyer === 'YOU' ? '#2fbf71' : '#ef5b5b'; ctx.beginPath(); ctx.arc(X(f.t), Y(f.price), 3, 0, 7); ctx.fill(); }
  if (M.done) { const tv = M.trueValue(sel); ctx.strokeStyle = '#2fbf71'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(8, Y(tv)); ctx.lineTo(W - 8, Y(tv)); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#2fbf71'; ctx.fillText('settle ' + tv, W - 70, Y(tv) - 3); }
  ctx.fillStyle = '#8797a8'; ctx.font = '10px monospace'; ctx.fillText(fmt(hi - pad), 2, 10); ctx.fillText(fmt(lo + pad), 2, H - 2);
}

/* ---------------- review ---------------- */
function showReview() {
  const r = M.review();
  const byKind = Object.entries(r.byKind).map(([k, v]) => `<tr><td>${k}</td><td>${v.n}</td><td class="${cls(v.edge)}">${fmt(v.edge)}</td><td class="${cls(v.realized)}">${fmt(v.realized)}</td><td class="${cls(v.passive)}">${fmt(v.passive)}</td></tr>`).join('');
  const rows = r.rows.slice(-40).reverse().map(x => `<tr><td>${Math.floor(x.t)}s</td><td>${x.inst}</td><td class="${x.side === 'buy' ? 'b' : 'a'}">${x.side}</td><td>${x.price}</td><td>${x.qty}</td><td>${x.cp} <span class="chip">${x.cpKind}</span></td><td>${x.aggressor ? 'took' : 'made'}</td><td>${fmt(x.fairOmni)}</td><td class="${cls(x.edge)}">${fmt(x.edge)}</td><td class="${cls(x.realized)}">${fmt(x.realized)}</td></tr>`).join('');
  const wins = r.windows.map(w => `<div class="m">[${Math.floor(w.start)}s–${Math.floor(w.end)}s] ${w.desc}</div>`).join('') || '<div class="m">none</div>';
  $('reviewBox').innerHTML = `
    <h2 style="margin:0 0 6px;color:var(--acc)">Session review — P&amp;L <span class="${cls(r.pnl)}">${fmt(r.pnl)}</span>, rank ${r.rank}/${r.leaderboard.length}</h2>
    <div class="m">Settlement: ${M.instruments.map(i => `${i.id}=${M.trueValue(i.id)}`).join(', ')}</div>
    <h3>Coaching</h3>${r.tips.map(t => `<div class="tipbox">${t}</div>`).join('') || '<div class="tipbox">Clean session. Push size a little, or move up a level.</div>'}
    <h3>Who you traded against</h3>
    <table><thead><tr><th>counterparty type</th><th>units</th><th>edge vs full-info fair</th><th>realized P&amp;L</th><th>of which on your resting quotes</th></tr></thead><tbody>${byKind}</tbody></table>
    <div class="m" style="margin-top:4px">"Edge" = how good your price was vs. the fair value computed from <i>everyone's</i> information at the moment of the trade. Positive edge + negative realized = bad luck. Negative edge = you were the one being picked off.</div>
    <div class="m">Total edge: <b class="${cls(r.edgeSum)}">${fmt(r.edgeSum)}</b>. Spread paid when crossing: ${r.spreadPaid.n ? fmt(r.spreadPaid.ticks / r.spreadPaid.n, 2) + ' ticks/unit over ' + r.spreadPaid.n + ' units' : 'n/a'}.</div>
    <h3>Who was who</h3><div class="m">${r.identities.map(x => `${x.label}=${x.kind} (${fmt(x.pnl)})`).join(' · ')}</div>
    <h3>Arbitrage windows that lasted ≥ 1s (${r.captured}/${r.windows.length} acted on)</h3>${wins}
    <h3>Your last ${Math.min(40, r.rows.length)} fills</h3>
    <table><thead><tr><th>t</th><th>inst</th><th>side</th><th>px</th><th>qty</th><th>vs</th><th>role</th><th>full-info fair</th><th>edge</th><th>realized</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="row" style="margin-top:12px"><button class="primary" id="rvNew">New session (same level)</button><button id="rvClose">Close &amp; inspect</button></div>`;
  $('review').classList.remove('hidden');
  $('rvNew').onclick = () => newSession(); $('rvClose').onclick = () => $('review').classList.add('hidden');
}

/* ---------------- actions ---------------- */
function send(side) {
  const pRaw = $('tPrice').value, q = Number($('tQty').value);
  const res = M.submit('YOU', sel, side, pRaw === '' ? null : Number(pRaw), q);
  if (!res.ok) return msg(res.reason, true);
  msg(`${side} ${sel}: filled ${res.filled}${res.resting ? `, ${q - res.filled} resting @ ${pRaw}` : ''}`);
}
function postQuote() {
  const mid = Number($('qMid').value), hs = Number($('qHalf').value), sz = Number($('qSize').value);
  if (!isFinite(mid) || $('qMid').value === '') return msg('enter a quote centre', true);
  M.cancelAll('YOU', sel);
  const inst = M.inst(sel), isOpt = inst.type === 'call' || inst.type === 'put';
  const bid = Math.floor(mid - hs), ask = Math.ceil(mid + hs);
  let out = [];
  if (!(isOpt && bid < 0)) { const r1 = M.submit('YOU', sel, 'buy', bid, sz); out.push(r1.ok ? `bid ${bid}${r1.filled ? ' (filled ' + r1.filled + '!)' : ''}` : 'bid rejected: ' + r1.reason); }
  const r2 = M.submit('YOU', sel, 'sell', ask, sz); out.push(r2.ok ? `ask ${ask}${r2.filled ? ' (filled ' + r2.filled + '!)' : ''}` : 'ask rejected: ' + r2.reason);
  msg(`${sel} quote: ` + out.join(', '));
}
function flatten() {
  for (const inst of M.instruments) { const p = M.user.position(inst.id); if (p) M.submit('YOU', inst.id, p > 0 ? 'sell' : 'buy', null, Math.abs(p)); }
  msg('flatten sent');
}

/* ---------------- wiring ---------------- */
$('btnNew').onclick = newSession;
$('btnPause').onclick = () => { paused = !paused; $('btnPause').textContent = paused ? 'Resume' : 'Pause'; };
$('btnSettle').onclick = () => { if (M && !M.done) M.settle(); };
$('tBuy').onclick = () => send('buy'); $('tSell').onclick = () => send('sell'); $('qPost').onclick = postQuote;
$('btnCancelBid').onclick = () => { M.cancelSide('YOU', sel, 'buy'); renderOrders(); renderBook(); renderWatch(); msg('cancelled bid orders in ' + sel); };
$('btnCancelAsk').onclick = () => { M.cancelSide('YOU', sel, 'sell'); renderOrders(); renderBook(); renderWatch(); msg('cancelled ask orders in ' + sel); };
$('btnCancelInst').onclick = () => { M.cancelAll('YOU', sel); renderOrders(); renderBook(); renderWatch(); msg('cancelled all orders in ' + sel); };
$('btnCancelAll').onclick = () => { M.cancelAll('YOU'); renderOrders(); renderBook(); renderWatch(); msg('cancelled all your orders'); };
$('btnFlatten').onclick = flatten;
$('watch').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr && !e.target.matches('input')) { sel = tr.dataset.id; const f = M.userFair[sel]; if (f != null) $('qMid').value = f; renderAll(); } });
$('watch').addEventListener('change', e => { if (e.target.dataset.uf) { const v = e.target.value; if (v === '') delete M.userFair[e.target.dataset.uf]; else M.userFair[e.target.dataset.uf] = Number(v); if (e.target.dataset.uf === sel) $('qMid').value = v; } });
$('orders').addEventListener('click', e => {
  const btn = e.target.closest && e.target.closest('[data-cancel]');
  if (!btn) return;
  e.preventDefault(); e.stopPropagation();
  const id = Number(btn.dataset.cancel);
  const ok = M.cancel('YOU', id);
  renderOrders(); renderBook(); renderWatch();
  msg(ok ? `cancelled order ${id}` : 'order already filled or not found', !ok);
});
$('arb').addEventListener('click', e => {
  if (!e.target.dataset.arb) return;
  const o = findArbs(M).find(x => x.key === e.target.dataset.arb); if (!o) return msg('gone', true);
  const q = Math.max(1, Math.min(o.qty, 3)); let filled = [];
  for (const leg of o.legs) { const r = M.submit('YOU', leg.inst, leg.side, leg.price, q, { ioc: true }); filled.push(`${leg.side} ${leg.inst} ${r.ok ? r.filled : 'rej'}`); }
  msg('arb legs: ' + filled.join(', ') + ' — check you are not left with an unhedged leg!');
});
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x === b));
  for (const t of ['trade', 'drills', 'guide']) $('tab-' + t).classList.toggle('hidden', t !== b.dataset.tab);
  if (b.dataset.tab === 'drills') Drills.mount($('drillRoot'));
  if (b.dataset.tab === 'guide') Guide.mount($('guideRoot'));
});
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' && e.key === 'Enter') { if (e.target.closest('#tab-trade')) { if (['qMid', 'qHalf', 'qSize'].includes(e.target.id)) postQuote(); else if (['tPrice', 'tQty'].includes(e.target.id)) send(e.shiftKey ? 'sell' : 'buy'); } return; }
  if (e.key === 'Escape' && M) { M.cancelAll('YOU'); msg('all cancelled (Esc)'); }
  if (e.key === ' ' && e.target.tagName !== 'INPUT' && M) { e.preventDefault(); $('btnPause').click(); }
});
$('showFair').onchange = renderAll; $('showArb').onchange = renderAll;

$('level').value = localStorage.getItem('qs_level') || 'L0';
$('level').onchange = () => localStorage.setItem('qs_level', $('level').value);
newSession();
rafId = requestAnimationFrame(frame);
