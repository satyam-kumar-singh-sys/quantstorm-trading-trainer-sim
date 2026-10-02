'use strict';
/* ============================================================================
   Level 0 guided tutorial — watches the market state and ticks off steps.
   ========================================================================== */
const Tutorial = (() => {
  let M = null, active = false, idx = 0, snap = {}, doneSteps = [], hintShown = false;
  const $ = id => document.getElementById(id);
  const fairNow = () => M.fair(M.user, 'A');
  const userTrades = () => M.trades.filter(f => f.buyer === 'YOU' || f.seller === 'YOU');
  const myQuote = () => { const os = M.myOrders('YOU'); return { bid: os.find(o => o.side === 'buy'), ask: os.find(o => o.side === 'sell') }; };

  const STEPS = [
    {
      title: 'Find your fair value',
      text: () => { const s = M.stocks.A, known = M.knownSet(M.user, 'A'); let sum = 0; for (const i of known) sum += s.cards[i]; const h = s.cards.length - known.size;
        return `There is one jar, <b>A</b>, with 12 hidden cards (each 1–13). Look at the <b>Information</b> panel below: the gold card is your private tip. You know ${known.size} card(s) adding to <b>${sum}</b>; <b>${h}</b> are hidden, and a hidden card averages 7.<br><br>Work out your fair value and type it into the <b>"yours"</b> box in the Instruments table (top‑left), then press Tab or click elsewhere.`; },
      hint: () => { const s = M.stocks.A, known = M.knownSet(M.user, 'A'); let sum = 0; for (const i of known) sum += s.cards[i]; const h = s.cards.length - known.size; return `fair = ${sum} + 7 × ${h} = <b>${sum + 7 * h}</b>`; },
      why: 'Every decision you make all day starts from this number. If you don\'t know your fair, you can\'t tell whether any price is good or bad.',
      check: () => { const uf = M.userFair.A; return uf != null && Math.abs(uf - fairNow()) <= 1; },
      fail: () => { const uf = M.userFair.A; return uf != null && Math.abs(uf - fairNow()) > 1 ? `Not quite — you typed ${uf}. Re‑count: known cards + 7 for each hidden one.` : ''; },
    },
    {
      title: 'Be the customer: buy 1 at market',
      text: () => `Click the <b>A</b> row so the order book shows A. Leave the <b>price</b> box empty (empty = "at whatever price is there"), set qty <b>1</b>, press <b>BUY</b>.<br><br>You are "lifting the offer": buying instantly from whoever is selling.`,
      hint: () => `Ticket → price blank → qty 1 → BUY. The order book's lowest ASK is the price you'll pay.`,
      why: 'Crossing the spread is how impatient people trade. It costs the gap. You need to feel that cost once so you stop paying it for no reason.',
      onEnter: () => { snap.trades0 = userTrades().length; },
      check: () => userTrades().slice(snap.trades0).some(f => f.buyer === 'YOU' && f.aggressor === 'YOU'),
    },
    {
      title: 'Look at what that cost you',
      text: () => { const f = userTrades().filter(x => x.buyer === 'YOU').slice(-1)[0]; const b = M.books.A; const bb = b.bestBid();
        return `You bought at <b>${f.price}</b>. The best price anyone will pay you for it right now is the bid, <b>${bb ?? '–'}</b>. If you sold straight back you'd lose <b>${bb != null ? f.price - bb : '?'}</b> — that is the spread, and it is what customers pay the shop.<br><br>Now sell it back: price blank, qty 1, <b>SELL</b> ("hitting the bid").`; },
      hint: () => 'Ticket → price blank → qty 1 → SELL.',
      why: 'Round trip at market = guaranteed loss of the spread. That is lesson one: never cross the spread without a reason worth more than the gap.',
      onEnter: () => { snap.trades1 = userTrades().length; },
      check: () => userTrades().slice(snap.trades1).some(f => f.seller === 'YOU' && f.aggressor === 'YOU'),
    },
    {
      title: 'Be the shop: post a two‑sided quote',
      text: () => `Your P&L (top bar) just went down by the spread. Now take the other side of that deal.<br><br>In the second row of the ticket: <b>quote centre</b> = your fair (${M.userFair.A ?? 'type it first'}), <b>half‑spread</b> = 2, <b>size</b> = 2, then <b>QUOTE 2‑SIDED</b>. You'll see your bid and ask appear in the order book, outlined in gold.`,
      hint: () => `centre ${M.userFair.A ?? fairNow()}, half‑spread 2 → you'll bid ${Math.floor((M.userFair.A ?? fairNow()) - 2)} and offer ${Math.ceil((M.userFair.A ?? fairNow()) + 2)}.`,
      why: 'A two‑sided quote makes you the shop: you earn the spread instead of paying it. It is the default posture of every good trader in a pit.',
      check: () => { const q = myQuote(); return q.bid && q.ask; },
    },
    {
      title: 'Wait for a customer',
      text: () => `Someone will trade with you when they get impatient. Watch the <b>Feed</b> (right column). "They hit your bid" = you bought below fair. "They lifted your offer" = you sold above fair. Either way you earned edge.<br><br>If nothing happens for ~20 seconds, your quote may be too wide — try half‑spread 1.5.`,
      hint: () => 'Patience. Or tighten to half‑spread 1.5 (re‑post replaces your old quote).',
      why: 'Fills on your own quote are the good kind of trade: the other person came to you, and paid you for the privilege.',
      onEnter: () => { snap.trades2 = userTrades().length; },
      check: () => userTrades().slice(snap.trades2).some(f => f.aggressor !== 'YOU'),
    },
    {
      title: 'React to news — the most important habit',
      text: () => { const nxt = M.revealsDone < M.cfg.maxReveals ? Math.max(0, M.nextReveal - M.t) : null;
        return `A news card will be shown to everyone ${nxt != null ? 'in about <b>' + Math.ceil(nxt) + 's</b>' : 'soon'}. When it appears in the Feed, your fair changes by <b>(card − 7)</b>.<br><br>Do three things fast: (1) update the <b>"yours"</b> box, (2) re‑post your quote around the new fair, (3) glance at your position.<br><br>This step completes when a news card is out, your fair is right, and your quote is centred within 1 of it.`; },
      hint: () => `Card 11 → fair +4. Card 3 → fair −4. New quote centre = new fair. (Your correct fair right now is ${fairNow()}.)`,
      why: 'A quote that is not updated after news is a free gift to whoever is fastest. In a room of 40 people, someone is always fast. Traders call it "getting picked off".',
      onEnter: () => { snap.reveals = M.revealsDone; },
      check: () => { if (M.revealsDone <= snap.reveals) return false; const q = myQuote(); const uf = M.userFair.A; if (!q.bid || !q.ask || uf == null) return false; const c = (q.bid.price + q.ask.price) / 2; return Math.abs(uf - fairNow()) <= 1 && Math.abs(c - fairNow()) <= 1.5; },
      fail: () => { if (M.revealsDone <= snap.reveals) return ''; const uf = M.userFair.A; if (uf != null && Math.abs(uf - fairNow()) > 1) return `News is out and your typed fair (${uf}) is stale — update it.`; const q = myQuote(); if (!q.bid || !q.ask) return 'News is out — re‑post your quote around the new fair.'; const c = (q.bid.price + q.ask.price) / 2; return Math.abs(c - fairNow()) > 1.5 ? `Your quote is centred at ${c} but fair is now ${fairNow()} — re‑post.` : ''; },
    },
    {
      title: 'Manage your position (skew)',
      text: () => { const p = M.user.position('A');
        return `Your position in A is <b>${p}</b>. ${p === 0 ? 'You are flat — nice. To practise this step, keep quoting until you are long or short at least 2, then skew.' : p > 0 ? 'You are long: you want people to <i>buy from you</i>. Shift the whole quote <b>down</b> about 1 tick per 3 units held (centre = fair − 1 or so): your offer becomes attractive, your bid less so.' : 'You are short: you want people to <i>sell to you</i>. Shift the whole quote <b>up</b> a little (centre = fair + 1 or so).'}<br><br>This step completes when you hold at least 2 and your quote centre is skewed against your position.`; },
      hint: () => { const p = M.user.position('A'); return p === 0 ? 'Tighten your quote to attract trades, then skew once you have a position.' : `Set quote centre to ${p > 0 ? fairNow() - 1 : fairNow() + 1} (fair ${p > 0 ? '−' : '+'} 1) and re‑post.`; },
      why: 'Inventory is risk: the jar can land 10 away from fair. Skewing lets the flow of customers flatten you for free instead of you paying the spread to get out.',
      check: () => { const p = M.user.position('A'); if (Math.abs(p) < 2) return false; const q = myQuote(); if (!q.bid || !q.ask) return false; const c = (q.bid.price + q.ask.price) / 2; return p > 0 ? c <= fairNow() - 0.5 : c >= fairNow() + 0.5; },
    },
    {
      title: 'Finish the session',
      text: () => `You've done the whole loop: fair → quote → fill → news → re‑quote → skew. Keep going until the clock runs out (or press <b>Settle now</b>). Try to end within ±5 of flat.<br><br>Then read the <b>review</b>: "edge" is how good your prices were; "realized" is what actually happened. Positive edge with negative P&L is bad luck, not a mistake.`,
      hint: () => 'Keep re‑quoting on every news card. Cancel all (Esc) before settlement if you want to be safe.',
      why: 'One session is one repetition. The skills here are motor skills — repetitions, not reading, make them automatic.',
      check: () => M.done,
    },
  ];

  function reset(market, level) {
    M = market; active = !!(PRESETS[level] && PRESETS[level].tutorial); idx = 0; snap = {}; doneSteps = []; hintShown = false;
    $('tutPanel').classList.toggle('hidden', !active);
    if (active) { if (STEPS[0].onEnter) STEPS[0].onEnter(); render(); }
  }
  function advance() { doneSteps.push(idx); idx++; hintShown = false; $('tutExtra').classList.add('hidden'); if (idx < STEPS.length && STEPS[idx].onEnter) STEPS[idx].onEnter(); render(); }
  function update(market) {
    if (!active || !M || idx >= STEPS.length) return;
    const st = STEPS[idx];
    let ok = false; try { ok = st.check(); } catch (e) { ok = false; }
    if (ok) { flash(); advance(); return; }
    // live text refresh (cheap) + failure hints
    const f = st.fail ? st.fail() : '';
    const el = $('tutText'); const html = st.text() + (f ? `<div class="bad" style="margin-top:6px">${f}</div>` : '');
    if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
  }
  function flash() { const p = $('tutPanel'); p.style.boxShadow = '0 0 0 2px var(--bid)'; setTimeout(() => p.style.boxShadow = '', 600); }
  function render() {
    $('tutProgress').textContent = `step ${Math.min(idx + 1, STEPS.length)} of ${STEPS.length}`;
    $('tutSteps').innerHTML = STEPS.map((s, i) => `<span class="chip" style="${i < idx ? 'border-color:var(--bid);color:var(--bid)' : i === idx ? 'border-color:var(--acc);color:var(--acc)' : ''}">${i < idx ? '✓ ' : ''}${s.title}</span>`).join(' ');
    if (idx >= STEPS.length) { $('tutText').innerHTML = '<b class="ok">Tutorial complete.</b> Play Level 0 again from a new seed, or move to Level 1 where a competing shop and one better‑informed trader join in.'; return; }
    $('tutText').innerHTML = STEPS[idx].text(); $('tutText').dataset.html = '';
  }
  $('tutHint').onclick = () => { if (idx < STEPS.length) { $('tutExtra').innerHTML = '💡 ' + STEPS[idx].hint(); $('tutExtra').classList.remove('hidden'); } };
  $('tutWhy').onclick = () => { if (idx < STEPS.length) { $('tutExtra').innerHTML = '🎯 ' + STEPS[idx].why; $('tutExtra').classList.remove('hidden'); } };
  $('tutSkip').onclick = () => { if (idx < STEPS.length) advance(); };
  return { reset, update };
})();
if (typeof window !== 'undefined') window.Tutorial = Tutorial;
