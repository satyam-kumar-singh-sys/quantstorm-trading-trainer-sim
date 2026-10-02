'use strict';
/* ============================================================================
   Drills (timed practice) + Guide (in-app reference)
   ========================================================================== */
const Drills = (() => {
  const R = { pick: a => a[Math.floor(Math.random() * a.length)], int: (a, b) => a + Math.floor(Math.random() * (b - a + 1)) };
  const gen = {
    arith() {
      const kind = R.pick(['add', 'sub', 'mul', 'div', 'pct']);
      if (kind === 'add') { const a = R.int(120, 990), b = R.int(120, 990); return { q: `${a} + ${b}`, a: a + b, tol: 0 }; }
      if (kind === 'sub') { const a = R.int(400, 990), b = R.int(100, 399); return { q: `${a} − ${b}`, a: a - b, tol: 0 }; }
      if (kind === 'mul') { const a = R.int(12, 99), b = R.int(3, 19); return { q: `${a} × ${b}`, a: a * b, tol: 0 }; }
      if (kind === 'div') { const b = R.int(3, 19), c = R.int(11, 99); return { q: `${b * c} ÷ ${b}`, a: c, tol: 0 }; }
      const p = R.pick([5, 10, 12.5, 15, 20, 25, 30, 40]), a = R.int(40, 960); return { q: `${p}% of ${a}`, a: p * a / 100, tol: 0.01 };
    },
    fair() {
      const n = R.pick([8, 10, 12]), k = R.int(2, n - 2), known = Array.from({ length: k }, () => R.int(1, 13));
      const sum = known.reduce((a, b) => a + b, 0), hidden = n - k;
      return { q: `A stock settles to the sum of ${n} cards, each uniform on 1–13. You know ${k} of them: <b>${known.join(', ')}</b>. What is the fair value?`, a: sum + 7 * hidden, tol: 0, expl: `known sum ${sum} + 7 × ${hidden} hidden = ${sum + 7 * hidden}` };
    },
    sd() {
      const h = R.int(2, 12); const sd = Math.sqrt(14 * h);
      return { q: `${h} cards (uniform 1–13, variance 14 each) remain hidden. What is the standard deviation of the settlement value? (≈ 3.74 × √${h}, within ±0.5)`, a: sd, tol: 0.5, expl: `√(14 × ${h}) = ${sd.toFixed(2)}` };
    },
    update() {
      const n = 12, k = R.int(3, 8), sum = 7 * k + R.int(-8, 8), fair = sum + 7 * (n - k), card = R.int(1, 13);
      return { q: `Your fair for A is <b>${fair}</b> with ${n - k} cards still hidden. News reveals one hidden card: <b>${card}</b>. New fair?`, a: fair - 7 + card, tol: 0, expl: `replace the 7 you assumed with ${card}: ${fair} − 7 + ${card} = ${fair - 7 + card}` };
    },
    etf() {
      const b = [R.int(70, 100), R.int(70, 100), R.int(70, 100)], a = b.map(x => x + R.int(2, 5));
      const eb = b[0] + b[1] + b[2] + R.int(-6, 10), ea = eb + R.int(4, 9);
      const sumBid = b[0] + b[1] + b[2], sumAsk = a[0] + a[1] + a[2];
      const rich = eb - sumAsk, cheap = sumBid - ea;
      let ans = 0, expl;
      if (rich >= 1) { ans = rich; expl = `ETF bid ${eb} > basket asks ${sumAsk}: sell ETF, buy A+B+C, lock ${rich}`; }
      else if (cheap >= 1) { ans = cheap; expl = `ETF ask ${ea} < basket bids ${sumBid}: buy ETF, sell A+B+C, lock ${cheap}`; }
      else expl = `basket bids ${sumBid} / asks ${sumAsk} vs ETF ${eb}/${ea} — no riskless profit (answer 0)`;
      return { q: `Markets: A ${b[0]}/${a[0]}, B ${b[1]}/${a[1]}, C ${b[2]}/${a[2]}, ETF(=A+B+C) ${eb}/${ea}. Riskless profit per unit available right now? (0 if none)`, a: ans, tol: 0, expl };
    },
    parity() {
      const K = R.pick([75, 80, 85, 90, 95]), S = K + R.int(-8, 8), C = Math.max(1, S - K + R.int(3, 7));
      const which = R.pick(['put', 'call', 'stock']);
      if (which === 'put') return { q: `Stock at ${S}, strike ${K}, no interest. Call trades at ${C}. Fair put price by put–call parity?`, a: C - S + K, tol: 0, expl: `P = C − S + K = ${C} − ${S} + ${K} = ${C - S + K}` };
      const P = C - S + K;
      if (which === 'call') return { q: `Stock at ${S}, strike ${K}, no interest. Put trades at ${P}. Fair call price?`, a: C, tol: 0, expl: `C = P + S − K = ${P} + ${S} − ${K} = ${C}` };
      return { q: `Strike ${K}. Call ${C}, put ${P}, no interest. Where must the stock be trading?`, a: S, tol: 0, expl: `S = C − P + K = ${C} − ${P} + ${K} = ${S}` };
    },
    parityArb() {
      const K = R.pick([80, 85, 90]), S = K + R.int(-6, 6), Cf = Math.max(2, S - K + 5), Pf = Cf - S + K;
      const off = R.pick([-3, -2, 2, 3]); const C = Cf, P = Pf + off;   // put mispriced by off
      const synth = S + P - C; // should equal K
      const ans = Math.abs(synth - K);
      const dir = synth < K ? 'Conversion: BUY stock, BUY put, SELL call (synthetic K costs less than K)' : 'Reversal: SELL stock, SELL put, BUY call (synthetic K sells for more than K)';
      return { q: `Strike ${K}, no interest. Stock ${S}, call ${C}, put ${P}, all tradeable at these prices. How many ticks of riskless profit per unit, and which way? (enter the number)`, a: ans, tol: 0, expl: `S + P − C = ${synth} vs K = ${K} → ${ans} ticks. ${dir}.` };
    },
    optionFair() {
      const h = R.int(3, 10), mu = 7 * 12 - R.int(-10, 10), sd = Math.sqrt(14 * h), K = mu + R.pick([-8, -4, 0, 4, 8]);
      const type = R.pick(['call', 'put']);
      const v = type === 'call' ? bachelierCall(mu, sd, K) : bachelierPut(mu, sd, K);
      return { q: `Stock fair ${mu}, settlement SD ≈ ${sd.toFixed(1)}, strike ${K}. Approximate fair value of the ${type}? (±1.0). Rule: OTM option ≈ SD × {0.40, 0.20, 0.08, 0.03, 0.01} at {0, 0.5, 1, 1.5, 2} SD away; ITM = intrinsic + that.`, a: v, tol: 1.0, expl: `normal-model value ${v.toFixed(2)} (ATM ≈ 0.4×${sd.toFixed(1)} = ${(0.4 * sd).toFixed(1)}; offset ${mu - K > 0 ? '+' : ''}${mu - K})` };
    },
    adverse() {
      const items = [
        { q: `You are quoting A at 82/86. In the last 20 seconds three different traders have lifted your 86 offer and nobody has hit your bid. You are now short 9. Best action?`, opts: ['Keep the quote — the spread is profitable', 'Move the quote up (e.g. 86/90) and reduce size until the flow becomes two-sided', 'Buy back everything at market immediately', 'Widen to 80/88 but keep the same centre'], a: 1, expl: 'One-sided flow means your centre is wrong. Shift the market toward the flow first; widening around a wrong centre keeps getting you picked off on the same side.' },
        { q: `A news card is due in ~5 seconds. You are quoting 3 ticks wide with size 3 on both sides. What should you do?`, opts: ['Nothing — the news is symmetric in expectation', 'Widen or pull the quote until the news is out and you have re-priced', 'Double the size to capture the volatility', 'Cross the spread to get flat first'], a: 1, expl: 'Around scheduled information your quote is a free option for anyone faster than you. The expected value of news is zero, but the expected value of being the slowest quoter is negative.' },
        { q: `Someone offers to sell you 10 ETF at 2 ticks below your fair. Position limits are ±10. You have no view. Most likely explanation?`, opts: ['A generous counterparty', 'They know something (a private card) that makes the ETF worth less', 'Noise trading — size never means anything', 'The exchange mis-priced the ETF'], a: 1, expl: 'Winner\'s curse: a large, aggressive trade at a "good" price is more likely to be informed. Take a small amount, re-price down, and see if they keep coming.' },
        { q: `You hold a private card showing A has an 11 hidden (vs. expected 7). Best way to use it?`, opts: ['Immediately buy A at any price up to fair + 4', 'Announce it by bidding aggressively so others follow', 'Buy A (and ETF) up to your new fair minus a margin, in modest size, and lean your quotes upward', 'Ignore it until it becomes public'], a: 2, expl: 'Private information is worth ~4 ticks here. Capture it without over-paying and without signalling; the ETF gives a second, often cheaper, way to buy the same exposure.' },
        { q: `You are long 12 A near your limit of 15. The market is 84/88 and your fair is 87. What do you quote?`, opts: ['85/89 (centre on fair)', '83/87 (skew down: eager to sell, reluctant to buy)', '86/90 (skew up: you are bullish)', 'Pull all quotes'], a: 1, expl: 'Inventory skew: shift the centre against your position so the flow flattens you. Being at the limit means you cannot take the next good trade.' },
        { q: `The ETF's mid is 4 ticks above A+B+C mids, but the spreads mean no riskless arb exists at top of book. What is the best play?`, opts: ['Nothing until a riskless arb appears', 'Post an offer in the ETF slightly inside its ask and bids in A, B, C — get paid the spread while leaning on the relationship', 'Buy the ETF because it is going up', 'Sell A, B and C at market'], a: 1, expl: 'Relationships give you a better fair value than the ETF\'s own book. Provide liquidity in the rich leg and the cheap legs instead of crossing spreads.' },
        { q: `With 15 seconds left the market for A is 79/91 and your fair is 84. You are flat. Best action?`, opts: ['Buy at 91 — the market may go higher', 'Post 82/86 in small size; if nothing fills, stay flat', 'Sell at 79 to lock in "safety"', 'Post 79/91 to match the market'], a: 1, expl: 'End-of-game markets go wide because makers pull; do not pay a huge spread out of fear of missing out. Flat with no edge is a fine result.' },
      ];
      return R.pick(items);
    },
  };
  const SETS = {
    arith: { name: 'Mental arithmetic (speed)', gens: ['arith'], secs: 120 },
    fair: { name: 'Fair value & updating', gens: ['fair', 'update', 'sd'], secs: 180 },
    etf: { name: 'ETF vs basket', gens: ['etf'], secs: 150 },
    options: { name: 'Put–call parity & option value', gens: ['parity', 'parityArb', 'optionFair'], secs: 240 },
    adverse: { name: 'Adverse selection & tactics (MCQ)', gens: ['adverse'], secs: 300 },
    mixed: { name: 'Mixed — exam mode', gens: ['arith', 'fair', 'update', 'etf', 'parity', 'parityArb', 'optionFair', 'adverse'], secs: 300 },
  };
  let root, set, q, tEnd, timer, score, n, history;
  function mount(el) { root = el; if (!set) menu(); }
  function menu() {
    clearInterval(timer);
    const best = JSON.parse(localStorage.getItem('qs_best') || '{}');
    root.innerHTML = `<h2 style="color:var(--acc);margin:0">Drills</h2><div class="m">Timed reps. Aim to beat your own best; speed with accuracy is the whole point.</div>` +
      Object.entries(SETS).map(([k, s]) => `<button data-set="${k}" style="text-align:left;padding:10px"><b>${s.name}</b><br><span class="m">${s.secs}s · best: ${best[k] != null ? best[k] + ' correct' : '–'}</span></button>`).join('');
    root.querySelectorAll('button[data-set]').forEach(b => b.onclick = () => start(b.dataset.set));
  }
  function start(k) { set = k; score = 0; n = 0; history = []; tEnd = Date.now() + SETS[k].secs * 1000; timer = setInterval(tick, 200); next(); }
  function tick() { const el = root.querySelector('#dclock'); if (!el) return; const left = Math.max(0, tEnd - Date.now()); el.textContent = (left / 1000).toFixed(0) + 's'; if (left <= 0) finish(); }
  function next() {
    q = gen[R.pick(SETS[set].gens)]();
    const mcq = !!q.opts;
    root.innerHTML = `<div class="row"><b>${SETS[set].name}</b><span class="m grow">score ${score}/${n}</span><b id="dclock"></b><button class="sm" id="dquit">quit</button></div>
      <div class="q">${q.q}</div>` + (mcq ? q.opts.map((o, i) => `<button data-opt="${i}" style="text-align:left;padding:10px">${String.fromCharCode(65 + i)}. ${o}</button>`).join('')
        : `<input id="dans" type="number" step="any" placeholder="answer, then Enter" autofocus>`) + `<div id="dfb"></div>`;
    root.querySelector('#dquit').onclick = () => { set = null; menu(); };
    if (mcq) root.querySelectorAll('button[data-opt]').forEach(b => b.onclick = () => answer(Number(b.dataset.opt)));
    else { const inp = root.querySelector('#dans'); inp.focus(); inp.onkeydown = e => { if (e.key === 'Enter' && inp.value !== '') answer(Number(inp.value)); }; }
  }
  function answer(v) {
    n++;
    const ok = q.opts ? v === q.a : Math.abs(v - q.a) <= (q.tol || 0) + 1e-9;
    if (ok) score++;
    history.push({ q: q.q, ok });
    const fb = root.querySelector('#dfb');
    fb.innerHTML = `<div class="${ok ? 'ok' : 'bad'}" style="padding:8px;font-size:15px">${ok ? '✓ correct' : '✗ answer: ' + (q.opts ? q.opts[q.a] : (typeof q.a === 'number' ? +q.a.toFixed(2) : q.a))}${q.expl ? ' — <span class="m">' + q.expl + '</span>' : ''}</div><div class="m">press Enter / click for next</div>`;
    const go = () => { document.removeEventListener('keydown', kd); next(); };
    const kd = e => { if (e.key === 'Enter') go(); };
    setTimeout(() => { document.addEventListener('keydown', kd); fb.onclick = go; }, 50);
    if (ok && !q.opts) setTimeout(go, 700);
  }
  function finish() {
    clearInterval(timer);
    const best = JSON.parse(localStorage.getItem('qs_best') || '{}');
    if (best[set] == null || score > best[set]) best[set] = score;
    localStorage.setItem('qs_best', JSON.stringify(best));
    root.innerHTML = `<h2 style="color:var(--acc)">Time! ${score} correct out of ${n} (${n ? Math.round(100 * score / n) : 0}%)</h2>
      <div class="m">best for this set: ${best[set]}</div>
      <div>${history.map(h => `<div class="${h.ok ? 'ok' : 'bad'}">${h.ok ? '✓' : '✗'} ${h.q.replace(/<[^>]+>/g, '')}</div>`).join('')}</div>
      <div class="row"><button class="primary" id="again">Again</button><button id="back">Back to menu</button></div>`;
    root.querySelector('#again').onclick = () => start(set); root.querySelector('#back').onclick = () => { set = null; menu(); };
  }
  return { mount };
})();

const Guide = (() => {
  const html = `
<h2 style="color:var(--acc);margin-top:0">Quick reference — what to actually do in the pit</h2>
<h3>1. How this simulator maps to Round 2</h3>
<p>The organisers said Round 2 is a realistic exchange, with options and ETFs, and a game‑theory element. Nobody outside the team knows the exact game, so this trainer uses the most common design in university trading competitions (Optiver / IMC / Jane Street style): each stock settles to the sum of hidden cards, information leaks out over time (public news + private tips), an ETF equals a basket of stocks, and options settle on one stock. Bots play the roles other finalists will play: <b>market makers</b> (quote both sides), <b>noise traders</b> (random), an <b>informed trader</b> (has extra private cards and picks off stale quotes), and an <b>arbitrageur</b> (closes ETF / parity mispricings after a delay). The skills transfer even if the exact instruments differ.</p>
<h3>2. The three numbers you must always know</h3>
<ul><li><b>Fair value</b> = sum of known cards + 7 × hidden cards (mean of a 1–13 card is 7). Every news card: <code>fair += card − 7</code>.</li>
<li><b>Uncertainty</b> (SD) = 3.74 × √hidden. It tells you how wide to quote and how much an option is worth.</li>
<li><b>Your position</b> per instrument and your <b>net delta</b> per stock (ETF counts once for each component; options count by delta).</li></ul>
<h3>3. Market‑making rules</h3>
<ul><li>Quote around your fair, half‑spread ≈ 1–2 ticks when few cards are hidden, wider when many are (a rough rule: half‑spread ≈ 0.15–0.25 × SD, at least 1).</li>
<li><b>Skew</b> the centre against your inventory: long → shift both prices down (eager to sell). Roughly 0.25 tick per unit of position.</li>
<li><b>Adverse selection test:</b> if the same side keeps getting hit, your fair is wrong — move it toward the flow <i>first</i>, then widen. Repeated fills from the same anonymous ID are a big warning.</li>
<li><b>Before scheduled news</b>: widen or pull. Re‑quote immediately after.</li>
<li>Never be the stale quote. Better no quote than a wrong quote.</li></ul>
<h3>4. Relationships (free money, first come first served)</h3>
<ul><li><b>ETF = A + B + C.</b> If ETF ask &lt; sum of stock bids → buy ETF, sell the stocks. If ETF bid &gt; sum of stock asks → sell ETF, buy the stocks. Legs must be done at once — an unhedged leg is a directional bet.</li>
<li><b>Put–call parity (no interest):</b> <code>C − P = S − K</code>. Equivalently <code>S + P − C = K</code>. If the synthetic (S + P − C) costs less than K → buy S, buy P, sell C ("conversion"). If more → the reverse.</li>
<li><b>Option bounds:</b> call ≥ max(S − K, 0); put ≥ max(K − S, 0); call ≤ S; call value falls as K rises; the difference between two calls ≤ strike difference.</li>
<li>Even when no riskless arb exists, the relationships give you the <i>best</i> fair value. Quote the rich leg to sell and the cheap leg to buy.</li></ul>
<h3>5. Options fast pricing</h3>
<ul><li>ATM option value ≈ <b>0.4 × SD</b> of the settlement value (normal model). Example: SD 10 → ATM call ≈ 4.</li>
<li>Away from the money: call ≈ 0.4·SD when S=K; as S rises above K, call → (S − K) + small time value; below K it decays toward 0. A decent quick approximation for |S−K| ≤ SD: <code>call ≈ 0.4·SD + 0.5·(S−K) + 0.1·(S−K)²/SD</code>; put from parity.</li>
<li><b>Delta</b> ≈ P(settle above K) for a call. ATM ≈ 0.5. Use it to hedge: long 4 ATM calls ≈ long 2 stock.</li>
<li>Options are the place where other players make the biggest mistakes — they price them off the stock's <i>mid</i> and forget how much uncertainty is left. When many cards are already public, options far from the money should be nearly zero.</li></ul>
<h3>6. Game theory in a trading pit (the practical version)</h3>
<ul><li><b>Why is this trade available to me?</b> Every fill has a counterparty. If the price looks great and the size is big, suspect information (winner's curse). Take a little, re‑price, watch.</li>
<li><b>Information leaks through prices.</b> When someone bids aggressively for A and the ETF, update your fair toward theirs even without knowing why.</li>
<li><b>Don't signal.</b> Trade private information in moderate size and lean quotes rather than sweeping the book.</li>
<li><b>Endgame.</b> Makers pull quotes; spreads blow out; people who must flatten pay a fortune. Be flat or comfortably within limits early. Never cross a 12‑wide spread from fear.</li>
<li><b>Position limits are a weapon.</b> Once you are at the limit you cannot take the next good trade — keep dry powder, and notice when others are stuck (they must trade with you at your price).</li>
<li><b>Ranking games:</b> if scoring is by rank rather than absolute P&amp;L, variance matters. Ahead → reduce risk; behind → take more, but only on positive‑edge trades.</li></ul>
<h3>7. Session routine (do this every level)</h3>
<ol><li>First 5 s: write down fair values and SDs for every stock; compute ETF fair; check parity.</li><li>Post two‑sided quotes in 1–2 instruments in small size. Watch who hits you.</li><li>On each news line: update fair mentally, re‑quote, check ETF/parity relationships.</li><li>Every 30 s: glance at position and delta. Skew or flatten.</li><li>Last 20 s: reduce size, get within comfortable limits, do not chase.</li><li>Read the review: your edge by counterparty type is the honest scorecard. Negative edge vs. informed = picked off. Positive edge, negative P&amp;L = fine, keep going.</li></ol>
<h3>8. Progression</h3>
<p>L1 until you consistently finish top‑3 with positive edge in 3 sessions in a row → L2 (add ETF; toggle arbitrage alerts OFF once you catch them yourself) → L3 with "show fair" OFF, using the "yours" boxes to record your own estimates → L4. Alternate with Drills: mixed mode under 300 s is the closest thing to the real day.</p>`;
  return { mount(el) { el.innerHTML = html; } };
})();

if (typeof window !== 'undefined') Object.assign(window, { Drills, Guide });
