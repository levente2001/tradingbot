const db = require("./db");
const { publicGet, signedRequest } = require("./binance");

const QUOTE = (process.env.QUOTE_ASSET || "USDT").toUpperCase();

function isDemo() {
  const m = String(process.env.TRADING_MODE || process.env.DEMO_MODE || "live").toLowerCase();
  return m === "demo" || m === "1" || m === "true";
}

function toNum(x) { return Number(x); }

/** -------------------------
 *  Market data
 *  ------------------------- */
async function getChangePercent(symbol, windowSize) {
  // Rolling window ticker: /api/v3/ticker?windowSize=7d&symbol=... (FULL has priceChangePercent)
  const full = await publicGet("/api/v3/ticker", { symbol, windowSize, type: "FULL" });
  return {
    priceChangePercent: toNum(full.priceChangePercent),
    openPrice: toNum(full.openPrice),
    lastPrice: toNum(full.lastPrice)
  };
}

async function getLastPrice(symbol) {
  const t = await publicGet("/api/v3/ticker/price", { symbol });
  return toNum(t.price);
}

/** -------------------------
 *  Demo wallet (paper trading)
 *  ------------------------- */
function ensureDemoWallet() {
  const row = db.prepare("SELECT free FROM wallet WHERE asset=?").get(QUOTE);
  if (row) return;
  const start = Number(process.env.DEMO_START_USDT || 100);
  db.prepare("INSERT INTO wallet(asset, free) VALUES(?, ?)").run(QUOTE, start);
}

function getUsdt() {
  ensureDemoWallet();
  return Number(db.prepare("SELECT free FROM wallet WHERE asset=?").get(QUOTE).free || 0);
}

function addUsdt(delta) {
  ensureDemoWallet();
  const cur = getUsdt();
  const next = cur + Number(delta);
  db.prepare("UPDATE wallet SET free=? WHERE asset=?").run(next, QUOTE);
  return next;
}

function demoFeeFactor() {
  const bps = Number(process.env.DEMO_FEE_BPS || 0); // 10 = 0.10%
  return Math.max(0, 1 - bps / 10000);
}

/** -------------------------
 *  Live trading (real orders)
 *  ------------------------- */
async function marketBuyQuote(symbol, quoteOrderQty) {
  return signedRequest("POST", "/api/v3/order", {
    symbol,
    side: "BUY",
    type: "MARKET",
    quoteOrderQty: quoteOrderQty.toFixed(2),
    newOrderRespType: "FULL",
    recvWindow: 5000
  });
}

async function marketSellQuote(symbol, quoteOrderQty) {
  return signedRequest("POST", "/api/v3/order", {
    symbol,
    side: "SELL",
    type: "MARKET",
    quoteOrderQty: quoteOrderQty.toFixed(2),
    newOrderRespType: "FULL",
    recvWindow: 5000
  });
}

async function marketSellQty(symbol, quantity) {
  return signedRequest("POST", "/api/v3/order", {
    symbol,
    side: "SELL",
    type: "MARKET",
    quantity: String(quantity),
    newOrderRespType: "FULL",
    recvWindow: 5000
  });
}

/** -------------------------
 *  Demo trading helpers (simulate)
 *  ------------------------- */
function makeDemoOrder(side, symbol, executedQty, quoteQty, avgPrice) {
  return {
    orderId: `DEMO-${side}-${Date.now()}`,
    executedQty: String(executedQty),
    cummulativeQuoteQty: String(quoteQty),
    fills: [],
    avgPrice: String(avgPrice),
    symbol,
    side
  };
}

async function demoBuyQuote(symbol, quoteOrderQty, priceHint) {
  ensureDemoWallet();
  const usdt = getUsdt();
  if (usdt + 1e-9 < quoteOrderQty) throw new Error(`[DEMO] Not enough ${QUOTE}: have ${usdt.toFixed(2)}, need ${quoteOrderQty.toFixed(2)}`);

  const price = priceHint && priceHint > 0 ? priceHint : await getLastPrice(symbol);
  const feeF = demoFeeFactor();

  const executedQty = (quoteOrderQty * feeF) / price;
  addUsdt(-quoteOrderQty);

  const avgPrice = quoteOrderQty / executedQty;
  return makeDemoOrder("BUY", symbol, executedQty, quoteOrderQty, avgPrice);
}

async function demoSellQuote(symbol, quoteOrderQty, priceHint) {
  const pos = db.prepare("SELECT * FROM positions WHERE symbol=?").get(symbol);
  if (!pos || pos.qty <= 0) throw new Error(`[DEMO] No position to sell for ${symbol}`);

  const price = priceHint && priceHint > 0 ? priceHint : await getLastPrice(symbol);
  const feeF = demoFeeFactor();

  // How much base qty needed to receive ~quoteOrderQty (before fee), cap by position qty
  let qtyNeed = quoteOrderQty / price;
  qtyNeed = Math.min(qtyNeed, pos.qty);

  const received = qtyNeed * price * feeF;
  addUsdt(received);

  const avgPrice = received / qtyNeed;
  return makeDemoOrder("SELL", symbol, qtyNeed, received, avgPrice);
}

async function demoSellQty(symbol, qty, priceHint) {
  const pos = db.prepare("SELECT * FROM positions WHERE symbol=?").get(symbol);
  if (!pos || pos.qty <= 0) throw new Error(`[DEMO] No position to sell for ${symbol}`);

  const price = priceHint && priceHint > 0 ? priceHint : await getLastPrice(symbol);
  const feeF = demoFeeFactor();

  const sellQty = Math.min(qty, pos.qty);
  const received = sellQty * price * feeF;

  addUsdt(received);

  const avgPrice = received / sellQty;
  return makeDemoOrder("SELL", symbol, sellQty, received, avgPrice);
}

/** -------------------------
 *  Positions + trades bookkeeping
 *  ------------------------- */
function upsertPositionAfterBuy(symbol, executedQty, cummulativeQuoteQty) {
  const row = db.prepare("SELECT * FROM positions WHERE symbol=?").get(symbol);
  const buyQty = executedQty;
  const buyCost = cummulativeQuoteQty;

  if (!row) {
    db.prepare("INSERT INTO positions(symbol, qty, cost, realized) VALUES(?,?,?,0)")
      .run(symbol, buyQty, buyCost);
    return;
  }

  const newQty = row.qty + buyQty;
  const newCost = row.cost + buyCost;
  db.prepare("UPDATE positions SET qty=?, cost=? WHERE symbol=?").run(newQty, newCost, symbol);
}

function updatePositionAfterSell(symbol, soldQty, receivedQuoteQty) {
  const row = db.prepare("SELECT * FROM positions WHERE symbol=?").get(symbol);
  if (!row || row.qty <= 0) return;

  const avg = row.qty > 0 ? (row.cost / row.qty) : 0;
  const costRemoved = soldQty * avg;
  const realizedDelta = receivedQuoteQty - costRemoved;

  const newQty = Math.max(0, row.qty - soldQty);
  const newCost = Math.max(0, row.cost - costRemoved);
  const newRealized = row.realized + realizedDelta;

  db.prepare("UPDATE positions SET qty=?, cost=?, realized=? WHERE symbol=?")
    .run(newQty, newCost, newRealized, symbol);
}

function logTrade({ symbol, side, qty, quoteQty, avgPrice, orderId }) {
  db.prepare("INSERT INTO trades(ts,symbol,side,qty,quoteQty,avgPrice,orderId) VALUES(?,?,?,?,?,?,?)")
    .run(Date.now(), symbol, side, qty, quoteQty, avgPrice, String(orderId || ""));
}

/** -------------------------
 *  Unified execution (demo or live)
 *  ------------------------- */
function minOrderUsdt() {
  if (isDemo()) return Number(process.env.MIN_ORDER_USDT_DEMO || 1);
  return Number(process.env.MIN_ORDER_USDT || 10);
}

async function execBuyQuote(symbol, quoteOrderQty, priceHint) {
  if (isDemo()) return demoBuyQuote(symbol, quoteOrderQty, priceHint);
  return marketBuyQuote(symbol, quoteOrderQty);
}

async function execSellQuote(symbol, quoteOrderQty, priceHint) {
  if (isDemo()) return demoSellQuote(symbol, quoteOrderQty, priceHint);
  return marketSellQuote(symbol, quoteOrderQty);
}

async function execSellQty(symbol, qty, priceHint) {
  if (isDemo()) return demoSellQty(symbol, qty, priceHint);
  return marketSellQty(symbol, qty);
}

/** -------------------------
 *  Bot main loop
 *  ------------------------- */
async function runOnce() {
  const items = db.prepare("SELECT * FROM watchlist WHERE enabled=1").all();
  const results = [];
  const minOrder = minOrderUsdt();

  if (isDemo()) ensureDemoWallet();

  for (const w of items) {
    const { symbol, windowSize, maxPerRun } = w;

    const ch = await getChangePercent(symbol, windowSize);
    const p = ch.priceChangePercent;

    // +% => SELL X USDT, -% => BUY X USDT
    if (p > 0) {
      const pos = db.prepare("SELECT * FROM positions WHERE symbol=?").get(symbol);
      if (!pos || pos.qty <= 0) {
        results.push({ symbol, action: "skip", reason: `up (${p.toFixed(2)}%) but no position` });
        continue;
      }

      const rise = p;
      let sellUSDT = Math.min(rise, maxPerRun);

      // cap by position approximate value
      const approxValue = pos.qty * ch.lastPrice * 0.995;
      sellUSDT = Math.min(sellUSDT, approxValue);

      if (sellUSDT < minOrder) {
        results.push({ symbol, action: "skip", reason: `sell too small (${sellUSDT.toFixed(2)} ${QUOTE})` });
        continue;
      }

      const order = await execSellQuote(symbol, sellUSDT, ch.lastPrice);
      const executedQty = Number(order.executedQty || 0);
      const quoteQty = Number(order.cummulativeQuoteQty || 0);
      const avgPrice = executedQty > 0 ? quoteQty / executedQty : 0;

      updatePositionAfterSell(symbol, executedQty, quoteQty);
      logTrade({ symbol, side: "SELL", qty: executedQty, quoteQty, avgPrice, orderId: order.orderId });

      results.push({ symbol, action: "sell", risePct: rise, sellUSDT, executedQty, avgPrice });
      continue;
    }

    if (p >= 0) {
      results.push({ symbol, action: "skip", reason: `flat (${p.toFixed(2)}%)` });
      continue;
    }

    const drop = Math.abs(p);
    let buyUSDT = Math.min(drop, maxPerRun);

    if (buyUSDT < minOrder) {
      results.push({ symbol, action: "skip", reason: `buy too small (${buyUSDT.toFixed(2)} ${QUOTE})` });
      continue;
    }

    if (isDemo()) {
      const usdt = getUsdt();
      if (usdt + 1e-9 < buyUSDT) {
        results.push({ symbol, action: "skip", reason: `[DEMO] not enough ${QUOTE} (have ${usdt.toFixed(2)})` });
        continue;
      }
    }

    const order = await execBuyQuote(symbol, buyUSDT, ch.lastPrice);
    const executedQty = Number(order.executedQty || 0);
    const quoteQty = Number(order.cummulativeQuoteQty || 0);
    const avgPrice = executedQty > 0 ? quoteQty / executedQty : 0;

    upsertPositionAfterBuy(symbol, executedQty, quoteQty);
    logTrade({ symbol, side: "BUY", qty: executedQty, quoteQty, avgPrice, orderId: order.orderId });

    db.prepare("UPDATE watchlist SET lastBuyAt=? WHERE symbol=?").run(Date.now(), symbol);

    results.push({ symbol, action: "buy", dropPct: drop, buyUSDT, executedQty, avgPrice });
  }

  return results;
}

/** Manual sell by percent (used by /api/sell) */
async function sellPercent(symbol, percent = 100) {
  const pos = db.prepare("SELECT * FROM positions WHERE symbol=?").get(symbol);
  if (!pos || pos.qty <= 0) throw new Error("no position");

  const p = Math.max(0, Math.min(100, Number(percent)));
  const qty = pos.qty * (p / 100);

  const price = await getLastPrice(symbol);
  const order = await execSellQty(symbol, qty, price);

  const executedQty = Number(order.executedQty || 0);
  const quoteQty = Number(order.cummulativeQuoteQty || 0);
  const avgPrice = executedQty > 0 ? quoteQty / executedQty : 0;

  updatePositionAfterSell(symbol, executedQty, quoteQty);
  logTrade({ symbol, side: "SELL", qty: executedQty, quoteQty, avgPrice, orderId: order.orderId });

  return { executedQty, quoteQty, avgPrice, orderId: order.orderId };
}

/** Demo summary + reset */
async function getDemoSummary() {
  if (!isDemo()) return null;
  ensureDemoWallet();

  const usdt = getUsdt();
  const positions = db.prepare("SELECT * FROM positions").all();
  let equity = usdt;

  for (const r of positions) {
    if (r.qty <= 0) continue;
    const last = await getLastPrice(r.symbol);
    equity += r.qty * last;
  }

  return { mode: "demo", cash: usdt, equity };
}

function resetDemo(startUsdt = 100) {
  if (!isDemo()) throw new Error("not in demo mode");
  const amount = Number(startUsdt || process.env.DEMO_START_USDT || 100);

  db.prepare("DELETE FROM positions").run();
  db.prepare("DELETE FROM trades").run();
  db.prepare("DELETE FROM wallet").run();
  db.prepare("INSERT INTO wallet(asset, free) VALUES(?, ?)").run(QUOTE, amount);

  return { ok: true, cash: amount };
}

module.exports = {
  isDemo,
  runOnce,
  getChangePercent,
  getLastPrice,
  sellPercent,
  getDemoSummary,
  resetDemo,
  updatePositionAfterSell // exported for compatibility
};
