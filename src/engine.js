'use strict';
/* ============================================================================
   QuantStorm R2 Trainer — Exchange engine (pure logic, no DOM)
   Model: each stock settles to the SUM of N hidden cards, each uniform 1..13.
   Cards are revealed publicly over time (news) and privately (tips).
   ETF settles to A+B+C. Options settle to max(S-K,0) / max(K-S,0).
   ========================================================================== */
const CARD_MIN = 1, CARD_MAX = 13;
const CARD_MEAN = (CARD_MIN + CARD_MAX) / 2;                       // 7
const CARD_VAR = (Math.pow(CARD_MAX - CARD_MIN + 1, 2) - 1) / 12;  // 14

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
class RNG {
  constructor(seed) { this.f = mulberry32(seed >>> 0); }
  next() { return this.f(); }
  int(a, b) { return a + Math.floor(this.f() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.f() * arr.length)]; }
  normal() { let u = 0, v = 0; while (u === 0) u = this.f(); while (v === 0) v = this.f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.f() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
}

/* ---------------- statistics ---------------- */
function normPdf(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }
function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x >= 0 ? 1 - p : p;
}
const _pmfCache = new Map();
/** exact pmf of the sum of k cards uniform on 1..13 -> {min, p[]} */
function sumPmf(k) {
  if (k <= 0) return { min: 0, p: [1] };
  if (_pmfCache.has(k)) return _pmfCache.get(k);
  const prev = sumPmf(k - 1), n = CARD_MAX - CARD_MIN + 1;
  const p = new Array(prev.p.length + n - 1).fill(0);
  for (let i = 0; i < prev.p.length; i++) { const pi = prev.p[i]; if (!pi) continue; for (let c = 0; c < n; c++) p[i + c] += pi / n; }
  const res = { min: prev.min + CARD_MIN, p };
  _pmfCache.set(k, res); return res;
}
function valueDist(knownSum, kUnknown) {
  const d = sumPmf(kUnknown);
  return { min: knownSum + d.min, p: d.p, mean: knownSum + CARD_MEAN * kUnknown, sd: Math.sqrt(CARD_VAR * kUnknown), kUnknown };
}
function optionFair(dist, type, K) {
  let v = 0;
  for (let i = 0; i < dist.p.length; i++) { const s = dist.min + i; v += dist.p[i] * (type === 'call' ? Math.max(s - K, 0) : Math.max(K - s, 0)); }
  return v;
}
function optionDelta(dist, type, K) {
  let above = 0, below = 0;
  for (let i = 0; i < dist.p.length; i++) { const s = dist.min + i; if (s > K) above += dist.p[i]; else if (s < K) below += dist.p[i]; }
  return type === 'call' ? above : -below;
}
/** Normal ("Bachelier") approximation: E[max(V-K,0)] for V ~ N(mu, sd^2) */
function bachelierCall(mu, sd, K) { if (sd <= 1e-9) return Math.max(mu - K, 0); const d = (mu - K) / sd; return (mu - K) * normCdf(d) + sd * normPdf(d); }
function bachelierPut(mu, sd, K) { return bachelierCall(mu, sd, K) - (mu - K); }

/* ---------------- order book ---------------- */
class OrderBook {
  constructor(inst) { this.inst = inst; this.bids = []; this.asks = []; this.last = null; this.trades = []; }
  bestBid() { return this.bids.length ? this.bids[0].price : null; }
  bestAsk() { return this.asks.length ? this.asks[0].price : null; }
  bestBidQty() { const p = this.bestBid(); let q = 0; for (const o of this.bids) { if (o.price !== p) break; q += o.qty; } return q; }
  bestAskQty() { const p = this.bestAsk(); let q = 0; for (const o of this.asks) { if (o.price !== p) break; q += o.qty; } return q; }
  mid() { const b = this.bestBid(), a = this.bestAsk(); if (b != null && a != null) return (a + b) / 2; if (b != null) return b; if (a != null) return a; return this.last; }
  spread() { const b = this.bestBid(), a = this.bestAsk(); return (b != null && a != null) ? a - b : null; }
  levels(side, n, me) {
    const arr = side === 'buy' ? this.bids : this.asks, out = [];
    for (const o of arr) {
      const last = out[out.length - 1];
      if (last && last.price === o.price) { last.qty += o.qty; if (o.owner === me) last.mine += o.qty; }
      else { if (out.length >= n) break; out.push({ price: o.price, qty: o.qty, mine: o.owner === me ? o.qty : 0 }); }
    }
    return out;
  }
  find(id) { return this.bids.find(o => o.id === id) || this.asks.find(o => o.id === id) || null; }
  _insert(order) {
    const arr = order.side === 'buy' ? this.bids : this.asks;
    const better = order.side === 'buy' ? (o => o.price >= order.price) : (o => o.price <= order.price);
    let i = 0; while (i < arr.length && better(arr[i])) i++;
    arr.splice(i, 0, order);
  }
  /** match an incoming order; price==null means market. Returns fills. Self-match: resting own order is cancelled. */
  match(order, t, post = true) {
    const fills = [], opp = order.side === 'buy' ? this.asks : this.bids;
    while (order.qty > 0 && opp.length) {
      const top = opp[0];
      if (order.price != null) {
        if (order.side === 'buy' && top.price > order.price) break;
        if (order.side === 'sell' && top.price < order.price) break;
      }
      if (top.owner === order.owner) { opp.shift(); continue; }   // self-trade prevention (cancel resting)
      const q = Math.min(order.qty, top.qty), px = top.price;
      fills.push({ inst: this.inst, price: px, qty: q, t,
        buyer: order.side === 'buy' ? order.owner : top.owner, seller: order.side === 'sell' ? order.owner : top.owner,
        aggressor: order.owner, aggressorSide: order.side, passive: top.owner });
      order.qty -= q; top.qty -= q; if (top.qty === 0) opp.shift();
    }
    if (fills.length) this.last = fills[fills.length - 1].price;
    if (order.qty > 0 && order.price != null && post) this._insert(order);
    return fills;
  }
  cancel(id) { for (const arr of [this.bids, this.asks]) { const i = arr.findIndex(o => o.id === id); if (i >= 0) return arr.splice(i, 1)[0]; } return null; }
  cancelOwner(owner) { this.bids = this.bids.filter(o => o.owner !== owner); this.asks = this.asks.filter(o => o.owner !== owner); }
  ordersOf(owner) { return this.bids.filter(o => o.owner === owner).concat(this.asks.filter(o => o.owner === owner)); }
}

/* ---------------- traders ---------------- */
class Trader {
  constructor(id, name, kind) { this.id = id; this.name = name; this.kind = kind; this.pos = {}; this.cash = 0; this.priv = {}; this.nextAct = 0; this.bias = {}; this.label = name; }
  position(inst) { return this.pos[inst] || 0; }
  act() { }
}

class MMBot extends Trader {
  constructor(id, name, p) { super(id, name, 'mm'); this.p = p; this.nextBiasT = 0; }
  act(m) {
    if (m.t >= this.nextBiasT) {
      for (const id of this.p.insts) this.bias[id] = m.rng.normal() * this.p.biasSd * (m.inst(id).type === 'etf' ? 1.6 : 1);
      this.nextBiasT = m.t + 20 + m.rng.next() * 25;
    }
    for (const id of this.p.insts) {
      m.cancelAll(this.id, id);
      const inst = m.inst(id), book = m.books[id];
      const fair = m.fair(this, id) + this.bias[id];
      const pos = this.position(id);
      const isOpt = inst.type === 'call' || inst.type === 'put';
      let hs = this.p.halfSpread[isOpt ? 'option' : inst.type];
      const sd = m.uncertainty(this, id);
      hs = hs * (0.55 + 0.45 * Math.min(2, sd / 8));           // wider when more uncertain
      const center = fair - this.p.skew * pos;
      let bid = Math.floor(center - hs), ask = Math.ceil(center + hs);
      // post-only: never cross other people's quotes
      const oa = book.bestAsk(), ob = book.bestBid();
      if (oa != null && bid >= oa) bid = oa - 1;
      if (ob != null && ask <= ob) ask = ob + 1;
      if (isOpt) bid = Math.max(bid, 0);
      if (ask <= bid) ask = bid + 1;
      const size = this.p.size;
      const buyQty = pos >= inst.limit * 0.6 ? Math.max(1, Math.floor(size / 2)) : size;
      const sellQty = pos <= -inst.limit * 0.6 ? Math.max(1, Math.floor(size / 2)) : size;
      if (bid > 0 || !isOpt) m.submit(this.id, id, 'buy', bid, buyQty);
      m.submit(this.id, id, 'sell', ask, sellQty);
    }
    this.nextAct = m.t + this.p.period * (0.7 + 0.6 * m.rng.next());
  }
}

class NoiseBot extends Trader {
  constructor(id, name, p) { super(id, name, 'noise'); this.p = p; }
  act(m) {
    const id = m.rng.pick(this.p.insts), book = m.books[id], inst = m.inst(id);
    const pos = this.position(id);
    const pBuy = Math.min(0.85, Math.max(0.15, 0.5 - 0.03 * pos));   // gently mean-revert inventory
    const side = m.rng.next() < pBuy ? 'buy' : 'sell';
    const qty = m.rng.int(1, this.p.maxQty);
    if (m.rng.next() < 0.45) m.submit(this.id, id, side, null, qty);
    else {
      const mid = book.mid();
      if (mid != null) {
        const off = m.rng.int(0, 4);
        let px = side === 'buy' ? Math.floor(mid - off) : Math.ceil(mid + off);
        if ((inst.type === 'call' || inst.type === 'put') && px < 1) px = 1;
        m.submit(this.id, id, side, px, qty);
      }
    }
    if (m.rng.next() < 0.25) m.cancelAll(this.id);
    this.nextAct = m.t + this.p.period * (0.5 + m.rng.next());
  }
}

class InformedBot extends Trader {
  constructor(id, name, p) { super(id, name, 'informed'); this.p = p; }
  act(m) {
    const cands = [];
    for (const id of this.p.insts) {
      const book = m.books[id], inst = m.inst(id), fair = m.fair(this, id), pos = this.position(id);
      const ba = book.bestAsk(), bb = book.bestBid();
      if (ba != null && fair - ba > this.p.edge && pos < inst.limit * 0.8) cands.push({ id, side: 'buy', edge: fair - ba, px: ba, avail: book.bestAskQty() });
      if (bb != null && bb - fair > this.p.edge && pos > -inst.limit * 0.8) cands.push({ id, side: 'sell', edge: bb - fair, px: bb, avail: book.bestBidQty() });
    }
    if (cands.length) {
      cands.sort((a, b) => b.edge - a.edge);
      const c = cands[0];
      const qty = Math.max(1, Math.min(this.p.maxQty, c.avail, 1 + Math.floor(c.edge / 1.5)));
      m.submit(this.id, c.id, c.side, c.px, qty, { ioc: true });
    } else if (m.rng.next() < 0.35) {
      // rest a passive order inside the spread, near own fair (quiet information leakage)
      const id = m.rng.pick(this.p.insts), fair = m.fair(this, id), book = m.books[id];
      const bb = book.bestBid(), ba = book.bestAsk();
      if (bb != null && ba != null && ba - bb > 2) {
        const side = m.rng.next() < 0.5 ? 'buy' : 'sell';
        const px = side === 'buy' ? Math.min(Math.floor(fair - 1), ba - 1) : Math.max(Math.ceil(fair + 1), bb + 1);
        if (side === 'buy' ? px > bb : px < ba) m.submit(this.id, id, side, px, 1);
      }
    }
    if (m.rng.next() < 0.3) m.cancelAll(this.id);
    this.nextAct = m.t + this.p.period * (0.6 + 0.8 * m.rng.next());
  }
}

class ArbBot extends Trader {
  constructor(id, name, p) { super(id, name, 'arb'); this.p = p; this.seen = {}; }
  act(m) {
    if (m.t >= this.p.startAfter) {
      const opps = findArbs(m), now = m.t, keys = new Set();
      for (const o of opps) {
        keys.add(o.key);
        if (!(o.key in this.seen)) this.seen[o.key] = now;
        if (now - this.seen[o.key] >= this.p.delay) {
          const qty = Math.max(1, Math.min(this.p.maxQty, o.qty));
          for (const leg of o.legs) m.submit(this.id, leg.inst, leg.side, leg.price, qty * (leg.mult || 1), { ioc: true });
          delete this.seen[o.key];
        }
      }
      for (const k of Object.keys(this.seen)) if (!keys.has(k)) delete this.seen[k];
    }
    this.nextAct = m.t + this.p.period;
  }
}

/* ---------------- arbitrage scanner (top of book) ---------------- */
function findArbs(m) {
  const out = [];
  const etf = m.instruments.find(i => i.type === 'etf');
  if (etf) {
    const eb = m.books[etf.id], eBid = eb.bestBid(), eAsk = eb.bestAsk();
    let sumBid = 0, sumAsk = 0, okB = true, okA = true, qB = Infinity, qA = Infinity;
    for (const c of etf.components) {
      const b = m.books[c], bb = b.bestBid(), ba = b.bestAsk();
      if (bb == null) okB = false; else { sumBid += bb; qB = Math.min(qB, b.bestBidQty()); }
      if (ba == null) okA = false; else { sumAsk += ba; qA = Math.min(qA, b.bestAskQty()); }
    }
    if (eAsk != null && okB && sumBid - eAsk >= 1)
      out.push({ key: 'etf_cheap', profit: sumBid - eAsk, qty: Math.min(eb.bestAskQty(), qB),
        legs: [{ inst: etf.id, side: 'buy', price: eAsk }].concat(etf.components.map(c => ({ inst: c, side: 'sell', price: m.books[c].bestBid() }))),
        desc: `ETF offered at ${eAsk} < basket bids ${sumBid}: buy ETF, sell A+B+C (+${sumBid - eAsk}/unit)` });
    if (eBid != null && okA && eBid - sumAsk >= 1)
      out.push({ key: 'etf_rich', profit: eBid - sumAsk, qty: Math.min(eb.bestBidQty(), qA),
        legs: [{ inst: etf.id, side: 'sell', price: eBid }].concat(etf.components.map(c => ({ inst: c, side: 'buy', price: m.books[c].bestAsk() }))),
        desc: `ETF bid ${eBid} > basket offers ${sumAsk}: sell ETF, buy A+B+C (+${eBid - sumAsk}/unit)` });
  }
  for (const c of m.instruments.filter(i => i.type === 'call')) {
    const K = c.strike, pid = c.under + K + 'P', p = m.inst(pid); if (!p) continue;
    const S = m.books[c.under], C = m.books[c.id], P = m.books[pid];
    if (S.bestAsk() != null && P.bestAsk() != null && C.bestBid() != null) {
      const pr = K - (S.bestAsk() + P.bestAsk() - C.bestBid());
      if (pr >= 1) out.push({ key: 'conv' + K, profit: pr, qty: Math.min(S.bestAskQty(), P.bestAskQty(), C.bestBidQty()),
        legs: [{ inst: c.under, side: 'buy', price: S.bestAsk() }, { inst: pid, side: 'buy', price: P.bestAsk() }, { inst: c.id, side: 'sell', price: C.bestBid() }],
        desc: `Conversion @${K}: buy stock ${S.bestAsk()} + buy put ${P.bestAsk()} − sell call ${C.bestBid()} = ${S.bestAsk() + P.bestAsk() - C.bestBid()} < K=${K} (+${pr}/unit)` });
    }
    if (S.bestBid() != null && P.bestBid() != null && C.bestAsk() != null) {
      const pr = (S.bestBid() + P.bestBid() - C.bestAsk()) - K;
      if (pr >= 1) out.push({ key: 'rev' + K, profit: pr, qty: Math.min(S.bestBidQty(), P.bestBidQty(), C.bestAskQty()),
        legs: [{ inst: c.under, side: 'sell', price: S.bestBid() }, { inst: pid, side: 'sell', price: P.bestBid() }, { inst: c.id, side: 'buy', price: C.bestAsk() }],
        desc: `Reversal @${K}: sell stock ${S.bestBid()} + sell put ${P.bestBid()} − buy call ${C.bestAsk()} = ${S.bestBid() + P.bestBid() - C.bestAsk()} > K=${K} (+${pr}/unit)` });
    }
  }
  return out;
}

/* ---------------- presets ---------------- */
const PRESETS = {
  L0: { name: 'Level 0 — tutorial (one jar, guided)', stockIds: ['A'], cardsPerStock: 12, etf: false, options: null, duration: 200, revealEvery: 25, maxReveals: 6,
    tipEvery: 70, userPrivCards: 1, mmPrivCards: 1, informedPrivCards: 0, bots: { mm: 1, noise: 3, informed: 0, arb: false },
    limits: { stock: 15, etf: 10, option: 15 }, arbDelay: 99, mmBias: 0.6, showFair: false, tutorial: true },
  L1: { name: 'Level 1 — one stock', stockIds: ['A'], cardsPerStock: 12, etf: false, options: null, duration: 180, revealEvery: 14, maxReveals: 8,
    tipEvery: 45, userPrivCards: 2, mmPrivCards: 2, informedPrivCards: 5, bots: { mm: 2, noise: 3, informed: 1, arb: false },
    limits: { stock: 15, etf: 10, option: 15 }, arbDelay: 8, mmBias: 1.0, showFair: true },
  L2: { name: 'Level 2 — 3 stocks + ETF', stockIds: ['A', 'B', 'C'], cardsPerStock: 12, etf: true, options: null, duration: 240, revealEvery: 8, maxReveals: 24,
    tipEvery: 30, userPrivCards: 1, mmPrivCards: 2, informedPrivCards: 4, bots: { mm: 3, noise: 4, informed: 1, arb: true },
    limits: { stock: 15, etf: 10, option: 15 }, arbDelay: 8, mmBias: 1.2, showFair: true },
  L3: { name: 'Level 3 — stocks + ETF + options', stockIds: ['A', 'B', 'C'], cardsPerStock: 12, etf: true, options: { under: 'A', strikes: [75, 85, 95] }, duration: 300, revealEvery: 9, maxReveals: 24,
    tipEvery: 30, userPrivCards: 1, mmPrivCards: 2, informedPrivCards: 4, bots: { mm: 3, noise: 4, informed: 1, arb: true },
    limits: { stock: 15, etf: 10, option: 15 }, arbDelay: 6, mmBias: 1.3, showFair: false },
  L4: { name: 'Level 4 — full pit (hard)', stockIds: ['A', 'B', 'C'], cardsPerStock: 12, etf: true, options: { under: 'A', strikes: [75, 85, 95] }, duration: 300, revealEvery: 7, maxReveals: 28,
    tipEvery: 40, userPrivCards: 1, mmPrivCards: 3, informedPrivCards: 5, bots: { mm: 4, noise: 5, informed: 2, arb: true },
    limits: { stock: 15, etf: 10, option: 15 }, arbDelay: 3, mmBias: 1.6, showFair: false },
};

/* ---------------- market ---------------- */
class Market {
  constructor(cfg, seed) {
    this.cfg = cfg; this.seed = seed; this.rng = new RNG(seed);
    this.t = 0; this.done = false; this.orderSeq = 1;
    this.instruments = []; this.instMap = {}; this.books = {}; this.stocks = {};
    this.log = []; this.trades = []; this.series = []; this.nextSample = 0;
    this.arbOpen = {}; this.arbWindows = []; this.userFair = {};
    for (const sid of cfg.stockIds) {
      const cards = Array.from({ length: cfg.cardsPerStock }, () => this.rng.int(CARD_MIN, CARD_MAX));
      this.stocks[sid] = { id: sid, cards, pub: new Set(), pubOrder: [] };
      this.addInstrument({ id: sid, type: 'stock', limit: cfg.limits.stock });
    }
    if (cfg.etf) this.addInstrument({ id: 'ETF', type: 'etf', components: cfg.stockIds.slice(), limit: cfg.limits.etf });
    if (cfg.options) for (const K of cfg.options.strikes) {
      this.addInstrument({ id: cfg.options.under + K + 'C', type: 'call', under: cfg.options.under, strike: K, limit: cfg.limits.option });
      this.addInstrument({ id: cfg.options.under + K + 'P', type: 'put', under: cfg.options.under, strike: K, limit: cfg.limits.option });
    }
    this.traders = {}; this.bots = [];
    this.user = this.addTrader(new Trader('YOU', 'You', 'user'));
    const all = this.instruments.map(i => i.id);
    const b = cfg.bots;
    for (let i = 0; i < b.mm; i++) this.addBot(new MMBot('MM' + (i + 1), 'MM' + (i + 1), {
      insts: all, halfSpread: { stock: 2.2 + 0.5 * i, etf: 4.5 + 0.7 * i, option: 1.6 + 0.4 * i }, skew: 0.25, size: 3, period: 1.2 + 0.3 * i, biasSd: cfg.mmBias }));
    for (let i = 0; i < b.noise; i++) this.addBot(new NoiseBot('N' + (i + 1), 'N' + (i + 1), { insts: all, period: 2.5, maxQty: 3 }));
    for (let i = 0; i < b.informed; i++) this.addBot(new InformedBot('INF' + (i + 1), 'INF' + (i + 1), { insts: all, period: 2.0, edge: 1.4, maxQty: 4 }));
    if (b.arb) this.addBot(new ArbBot('ARB', 'ARB', { delay: cfg.arbDelay, period: 1.0, startAfter: 20, maxQty: 3 }));
    // private information
    for (const sid of cfg.stockIds) {
      this.givePrivate(this.user, sid, cfg.userPrivCards);
      for (const bot of this.bots) {
        if (bot.kind === 'mm') this.givePrivate(bot, sid, cfg.mmPrivCards);
        if (bot.kind === 'informed') this.givePrivate(bot, sid, cfg.informedPrivCards);
      }
    }
    // anonymous labels for the tape
    const labels = this.rng.shuffle(Array.from({ length: this.bots.length }, (_, i) => 'T' + (i + 1)));
    this.bots.forEach((bot, i) => { bot.label = labels[i]; });
    for (const bot of this.bots) bot.nextAct = 0.2 + this.rng.next() * 2;
    this.revealsDone = 0; this.nextReveal = cfg.revealEvery; this.nextTip = cfg.tipEvery;
    this.addLog('start', `Session start. ${cfg.stockIds.length} stock(s) × ${cfg.cardsPerStock} cards (1–13). You privately see ${cfg.userPrivCards} card(s) per stock.`);
  }
  addInstrument(inst) { this.instruments.push(inst); this.instMap[inst.id] = inst; this.books[inst.id] = new OrderBook(inst.id); }
  inst(id) { return this.instMap[id]; }
  addTrader(tr) { this.traders[tr.id] = tr; return tr; }
  addBot(bot) { this.addTrader(bot); this.bots.push(bot); return bot; }
  addLog(type, text, extra) { this.log.push(Object.assign({ t: this.t, type, text }, extra || {})); }
  givePrivate(trader, sid, n) {
    const s = this.stocks[sid]; trader.priv[sid] = trader.priv[sid] || new Set();
    const idxs = this.rng.shuffle([...Array(s.cards.length).keys()]);
    let c = 0; for (const i of idxs) { if (c >= n) break; if (!trader.priv[sid].has(i)) { trader.priv[sid].add(i); c++; } }
  }
  /* --- knowledge & fair values --- */
  knownSet(trader, sid) { const s = this.stocks[sid], set = new Set(s.pub); if (trader && trader.priv[sid]) for (const i of trader.priv[sid]) set.add(i); return set; }
  omniSet(sid) { const set = new Set(this.stocks[sid].pub); for (const tr of Object.values(this.traders)) if (tr.priv[sid]) for (const i of tr.priv[sid]) set.add(i); return set; }
  distFromSet(sid, set) { const s = this.stocks[sid]; let sum = 0; for (const i of set) sum += s.cards[i]; return valueDist(sum, s.cards.length - set.size); }
  distStock(trader, sid) { return this.distFromSet(sid, this.knownSet(trader, sid)); }
  distOmni(sid) { return this.distFromSet(sid, this.omniSet(sid)); }
  /** fair value for a trader's information set. trader=null → public info only. omni=true → union of everyone's info. */
  fair(trader, instId, omni = false) {
    const inst = this.inst(instId);
    const dfn = sid => omni ? this.distOmni(sid) : this.distStock(trader, sid);
    if (inst.type === 'stock') return dfn(inst.id).mean;
    if (inst.type === 'etf') return inst.components.reduce((a, c) => a + dfn(c).mean, 0);
    return optionFair(dfn(inst.under), inst.type, inst.strike);
  }
  /** std dev of the settlement value from a trader's point of view */
  uncertainty(trader, instId) {
    const inst = this.inst(instId);
    if (inst.type === 'stock') return this.distStock(trader, inst.id).sd;
    if (inst.type === 'etf') return Math.sqrt(inst.components.reduce((a, c) => a + Math.pow(this.distStock(trader, c).sd, 2), 0));
    return this.distStock(trader, inst.under).sd;
  }
  trueValue(instId) {
    const inst = this.inst(instId), sumOf = sid => this.stocks[sid].cards.reduce((a, b) => a + b, 0);
    if (inst.type === 'stock') return sumOf(inst.id);
    if (inst.type === 'etf') return inst.components.reduce((a, c) => a + sumOf(c), 0);
    const S = sumOf(inst.under); return inst.type === 'call' ? Math.max(S - inst.strike, 0) : Math.max(inst.strike - S, 0);
  }
  /** net exposure of a trader to each stock, in stock-equivalents (delta) */
  deltas(trader) {
    const out = {};
    for (const sid of this.cfg.stockIds) out[sid] = trader.position(sid);
    for (const inst of this.instruments) {
      const p = trader.position(inst.id); if (!p) continue;
      if (inst.type === 'etf') for (const c of inst.components) out[c] += p;
      if (inst.type === 'call' || inst.type === 'put') out[inst.under] += p * optionDelta(this.distStock(trader, inst.under), inst.type, inst.strike);
    }
    return out;
  }
  /* --- orders --- */
  openQty(trader, instId, side) { let q = 0; for (const o of this.books[instId].ordersOf(trader.id)) if (o.side === side) q += o.qty; return q; }
  submit(traderId, instId, side, price, qty, opts = {}) {
    const tr = this.traders[traderId], inst = this.inst(instId), book = this.books[instId];
    if (this.done) return { ok: false, reason: 'session over' };
    if (!inst) return { ok: false, reason: 'unknown instrument' };
    qty = Math.floor(Number(qty)); if (!(qty > 0)) return { ok: false, reason: 'quantity must be ≥ 1' };
    if (price != null) { price = Math.round(Number(price)); if (!isFinite(price)) return { ok: false, reason: 'bad price' }; if (price < 0) return { ok: false, reason: 'price must be ≥ 0' }; }
    const pos = tr.position(instId), open = this.openQty(tr, instId, side);
    const projected = side === 'buy' ? pos + open + qty : pos - open - qty;
    if (Math.abs(projected) > inst.limit) return { ok: false, reason: `would breach position limit ±${inst.limit} (pos ${pos}, open ${open})` };
    if (price == null && !(side === 'buy' ? book.asks.length : book.bids.length)) return { ok: false, reason: 'no liquidity on the other side' };
    const order = { id: this.orderSeq++, owner: traderId, inst: instId, side, price, qty, t: this.t };
    const fills = book.match(order, this.t, !opts.ioc);
    for (const f of fills) this.applyFill(f);
    return { ok: true, orderId: order.id, fills, resting: order.qty > 0 && price != null && !opts.ioc, filled: fills.reduce((a, f) => a + f.qty, 0) };
  }
  applyFill(f) {
    const b = this.traders[f.buyer], s = this.traders[f.seller];
    b.pos[f.inst] = (b.pos[f.inst] || 0) + f.qty; s.pos[f.inst] = (s.pos[f.inst] || 0) - f.qty;
    b.cash -= f.price * f.qty; s.cash += f.price * f.qty;
    f.fairOmni = this.fair(null, f.inst, true); f.fairPub = this.fair(null, f.inst, false);
    f.id = this.trades.length; this.trades.push(f); this.books[f.inst].trades.push(f);
    if (f.buyer === 'YOU' || f.seller === 'YOU') {
      const mine = f.buyer === 'YOU' ? 'BOUGHT' : 'SOLD', cp = this.traders[f.buyer === 'YOU' ? f.seller : f.buyer];
      const how = f.aggressor === 'YOU' ? (mine === 'BOUGHT' ? 'you lifted their offer' : 'you hit their bid') : (mine === 'BOUGHT' ? 'they hit your bid' : 'they lifted your offer');
      this.addLog('fill', `You ${mine} ${f.qty} ${f.inst} @ ${f.price} vs ${cp.label} (${how})`, { inst: f.inst, side: mine, qty: f.qty, price: f.price, aggressor: f.aggressor === 'YOU' });
    }
  }
  cancel(traderId, orderId) { for (const b of Object.values(this.books)) { const o = b.find(orderId); if (o) { if (o.owner !== traderId) return false; b.cancel(orderId); return true; } } return false; }
  cancelAll(traderId, instId = null) { const books = instId ? [this.books[instId]] : Object.values(this.books); for (const b of books) b.cancelOwner(traderId); }
  cancelSide(traderId, instId, side) { const b=this.books[instId]; if(!b) return; b.bids = side==='buy' ? b.bids.filter(o=>o.owner!==traderId) : b.bids; b.asks = side==='sell' ? b.asks.filter(o=>o.owner!==traderId) : b.asks; }
  myOrders(traderId) { const out = []; for (const b of Object.values(this.books)) out.push(...b.ordersOf(traderId)); return out; }
  mark(instId) { const b = this.books[instId], bb = b.bestBid(), ba = b.bestAsk(); if (bb != null && ba != null) return (bb + ba) / 2; if (b.last != null) return b.last; return this.fair(null, instId, false); }
  pnl(trader) { let v = trader.cash; for (const inst of this.instruments) { const p = trader.position(inst.id); if (p) v += p * (this.done ? this.trueValue(inst.id) : this.mark(inst.id)); } return v; }
  leaderboard() { return Object.values(this.traders).map(tr => ({ id: tr.id, label: tr.id === 'YOU' ? 'YOU' : tr.label, kind: tr.kind, pnl: this.pnl(tr) })).sort((a, b) => b.pnl - a.pnl); }
  /* --- events --- */
  revealPublic() {
    const cands = [];
    for (const s of Object.values(this.stocks)) for (let i = 0; i < s.cards.length; i++) if (!s.pub.has(i)) cands.push([s.id, i]);
    if (!cands.length) return false;
    const [sid, i] = this.rng.pick(cands), s = this.stocks[sid];
    const knewIt = this.user.priv[sid] && this.user.priv[sid].has(i);
    s.pub.add(i); s.pubOrder.push(i);
    const d = s.cards[i] - CARD_MEAN;
    const move = knewIt ? 'you already knew this card, so YOUR fair does not change — but everyone else\'s does' : `your fair moves ${d >= 0 ? '+' : ''}${d}`;
    this.addLog('news', `NEWS — ${sid}: a card is revealed: ${s.cards[i]} (${move}). ${s.cards.length - s.pub.size} of ${sid}'s cards still hidden.`, { sid, value: s.cards[i], knewIt });
    return true;
  }
  tip(trader) {
    const cands = [];
    for (const s of Object.values(this.stocks)) { const known = this.knownSet(trader, s.id); for (let i = 0; i < s.cards.length; i++) if (!known.has(i)) cands.push([s.id, i]); }
    if (!cands.length) return;
    const [sid, i] = this.rng.pick(cands);
    trader.priv[sid].add(i);
    if (trader === this.user) this.addLog('tip', `PRIVATE TIP — ${sid}: one of the hidden cards is ${this.stocks[sid].cards[i]}. Only you (and maybe an insider) know this.`, { sid, value: this.stocks[sid].cards[i] });
  }
  scanArb() {
    const opps = findArbs(this), keys = new Set();
    for (const o of opps) {
      keys.add(o.key);
      if (!this.arbOpen[o.key]) this.arbOpen[o.key] = { key: o.key, start: this.t, maxProfit: o.profit, desc: o.desc, legs: o.legs };
      else this.arbOpen[o.key].maxProfit = Math.max(this.arbOpen[o.key].maxProfit, o.profit);
    }
    for (const k of Object.keys(this.arbOpen)) if (!keys.has(k)) { const w = this.arbOpen[k]; w.end = this.t; this.arbWindows.push(w); delete this.arbOpen[k]; }
    return opps;
  }
  sample() {
    const mids = {}, fairs = {}, myf = {};
    for (const inst of this.instruments) { mids[inst.id] = this.books[inst.id].mid(); fairs[inst.id] = this.fair(null, inst.id, true); myf[inst.id] = this.fair(this.user, inst.id); }
    this.series.push({ t: this.t, mids, fairs, myf, userFair: Object.assign({}, this.userFair), pnl: this.pnl(this.user) });
  }
  step(dt) {
    if (this.done) return;
    const tEnd = Math.min(this.t + dt, this.cfg.duration);
    for (;;) {
      let next = Infinity, what = null;
      if (this.revealsDone < this.cfg.maxReveals && this.nextReveal < next) { next = this.nextReveal; what = 'reveal'; }
      if (this.cfg.tipEvery && this.nextTip < next) { next = this.nextTip; what = 'tip'; }
      if (this.nextSample < next) { next = this.nextSample; what = 'sample'; }
      for (const bot of this.bots) if (bot.nextAct < next) { next = bot.nextAct; what = bot; }
      if (next > tEnd) break;
      this.t = next;
      if (what === 'reveal') { if (this.revealPublic()) this.revealsDone++; else this.revealsDone = this.cfg.maxReveals; this.nextReveal += this.cfg.revealEvery; }
      else if (what === 'tip') { this.tip(this.user); for (const b of this.bots) if (b.kind === 'informed') this.tip(b); this.nextTip += this.cfg.tipEvery; }
      else if (what === 'sample') { this.sample(); this.nextSample += 0.5; }
      else { what.act(this); if (what.nextAct <= this.t) what.nextAct = this.t + 0.5; }
      this.scanArb();
    }
    this.t = tEnd;
    if (this.t >= this.cfg.duration) this.settle();
  }
  settle() {
    if (this.done) return;
    for (const k of Object.keys(this.arbOpen)) { const w = this.arbOpen[k]; w.end = this.t; this.arbWindows.push(w); }
    this.arbOpen = {};
    this.sample();
    this.done = true;
    for (const b of Object.values(this.books)) { b.bids = []; b.asks = []; }
    for (const s of Object.values(this.stocks)) for (let i = 0; i < s.cards.length; i++) s.pub.add(i);
    this.addLog('settle', 'SETTLEMENT — all cards revealed. ' + this.instruments.map(i => `${i.id}=${this.trueValue(i.id)}`).join(', '));
  }
  /* --- post-session analytics for the user --- */
  review() {
    const me = this.user.id, rows = [], byKind = {}, spreadPaid = { n: 0, ticks: 0 };
    let edgeSum = 0;
    for (const f of this.trades) {
      if (f.buyer !== me && f.seller !== me) continue;
      const side = f.buyer === me ? 'buy' : 'sell', sign = side === 'buy' ? 1 : -1;
      const cp = f.buyer === me ? f.seller : f.buyer, cpTr = this.traders[cp];
      const edge = sign * (f.fairOmni - f.price) * f.qty, realized = sign * (this.trueValue(f.inst) - f.price) * f.qty;
      const aggressor = f.aggressor === me;
      edgeSum += edge;
      const k = cpTr.kind; byKind[k] = byKind[k] || { n: 0, edge: 0, realized: 0, passive: 0 };
      byKind[k].n += f.qty; byKind[k].edge += edge; byKind[k].realized += realized; if (!aggressor) byKind[k].passive += realized;
      if (aggressor) { const b = this.books[f.inst]; spreadPaid.n += f.qty; spreadPaid.ticks += Math.abs(f.price - f.fairPub) * f.qty; }
      rows.push({ t: f.t, inst: f.inst, side, price: f.price, qty: f.qty, cp: cpTr.label, cpKind: k, aggressor, fairOmni: f.fairOmni, edge, realized });
    }
    // max exposure over time
    let maxDelta = 0; for (const s of this.series) { /* approximated later by UI if needed */ }
    const lb = this.leaderboard(), rank = lb.findIndex(x => x.id === me) + 1;
    const windows = this.arbWindows.filter(w => (w.end - w.start) >= 1.0);
    const captured = windows.filter(w => rows.some(r => r.t >= w.start && r.t <= w.end + 1 && w.legs.some(l => l.inst === r.inst && l.side === r.side))).length;
    const tips = [];
    if (rows.length === 0) tips.push('You did not trade. Even in a tough market, quoting 2–3 ticks wide around your fair and adjusting on news would earn spread from the noise flow.');
    if (byKind.informed && byKind.informed.passive < -3) tips.push(`Your resting quotes lost ${(-byKind.informed.passive).toFixed(1)} to the informed trader. Repeated one-sided fills at your price = you are being picked off: move the quote, widen, or pull it when news is due.`);
    if (spreadPaid.n > 0 && spreadPaid.ticks / spreadPaid.n > 2.5) tips.push(`You paid ~${(spreadPaid.ticks / spreadPaid.n).toFixed(1)} ticks per unit crossing the spread. Cross only when your edge clearly exceeds the half-spread; otherwise rest a limit order.`);
    if (windows.length && captured < windows.length) tips.push(`${windows.length - captured} arbitrage window(s) (ETF vs basket / put–call parity) lasted ≥1s without you acting. Scan the relationships every time a price moves.`);
    if (edgeSum > 0 && this.pnl(this.user) < 0) tips.push('Your trades were at good prices vs full-information fair (positive edge) but the cards went against you — that is variance, not a mistake. Keep doing it, keep sizes moderate.');
    if (edgeSum < 0) tips.push('Your average trade was at a worse price than the full-information fair. Before trading, ask: who is on the other side, and why are they willing?');
    return { rows, byKind, spreadPaid, edgeSum, rank, leaderboard: lb, windows, captured, pnl: this.pnl(this.user), tips,
      identities: this.bots.map(b => ({ label: b.label, kind: b.kind, id: b.id, pnl: this.pnl(b) })) };
  }
}

const __exports = { RNG, normPdf, normCdf, sumPmf, valueDist, optionFair, optionDelta, bachelierCall, bachelierPut, OrderBook, Trader, MMBot, NoiseBot, InformedBot, ArbBot, findArbs, PRESETS, Market, CARD_MEAN, CARD_VAR };
if (typeof module !== 'undefined') module.exports = __exports;
if (typeof window !== 'undefined') Object.assign(window, __exports);
