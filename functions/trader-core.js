const DEFAULT_COLLECTION = process.env.TRADER_COLLECTION || "demoTrader";
const DEFAULT_REGION = process.env.GCP_REGION || "europe-west1";
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function nowIso(ts = Date.now()) {
  return new Date(ts).toISOString();
}

function getRefs(firestore, collectionPath = DEFAULT_COLLECTION) {
  const root = firestore.collection(collectionPath);
  return {
    config: root.doc("config"),
    state: root.doc("state"),
    history: root.doc("history")
  };
}

function defaultConfig() {
  return {
    region: DEFAULT_REGION,
    source: "binance_futures",
    symbol: "BTCUSDT",
    cycleIntervalMinutes: 5,
    lookbackBars: 6,
    thresholdPct: 0.12,
    thresholdCostMultiplier: 1.15,
    cooldownCycles: 1,
    leverage: 8,
    riskPerTradePct: 0.75,
    maxMarginPct: 20,
    minMarginUsd: 25,
    stopLossPct: 0.45,
    takeProfitRR: 1.35,
    trendFastBars: 5,
    trendSlowBars: 13,
    momentumBars: 3,
    volatilityBars: 10,
    maxVolatilityPct: 0.35,
    minTrendStrengthPct: 0.08,
    pullbackLookbackBars: 4,
    pullbackTolerancePct: 0.18,
    breakEvenTriggerR: 0.7,
    trailingStopR: 1.1,
    maxHoldCycles: 18,
    exitOnTrendFlip: true,
    feeBps: 4,
    slipBps: 2,
    fundingBufferBps: 1,
    useMlFilter: true,
    mlMinConfPct: 60,
    onboarded: false,
    nick: "",
    startBalance: 10000,
    maxPricePoints: 2000,
    maxHistoryItems: 500
  };
}

function defaultMlState() {
  return {
    enabled: true,
    horizonBars: 3,
    lr: 0.03,
    l2: 0.001,
    w: new Array(9).fill(0),
    b: 0,
    normAlpha: 0.05,
    mu: new Array(9).fill(0),
    va: new Array(9).fill(1),
    deadzonePct: 0.05,
    pending: [],
    stats: { n: 0, correct: 0 }
  };
}

function defaultMetrics(startBalance = 10000) {
  return {
    closedTrades: 0,
    wins: 0,
    losses: 0,
    winRatePct: 0,
    avgWin: 0,
    avgLoss: 0,
    expectancy: 0,
    maxDrawdownPct: 0,
    profitFactor: 0,
    netPnl: 0,
    grossProfit: 0,
    grossLossAbs: 0,
    currentEquity: startBalance,
    peakEquity: startBalance
  };
}

function defaultState(config = defaultConfig()) {
  return {
    onboarded: Boolean(config.onboarded),
    nick: config.nick || "",
    balance: asNumber(config.startBalance, 10000),
    price: null,
    fundingRate: null,
    nextFundingTs: null,
    priceSeries: [],
    position: null,
    algoOn: false,
    cycleCount: 0,
    lastTradeCycle: -999999,
    lastTickAt: null,
    lastMessage: "Initialized",
    mlSignal: null,
    mlState: defaultMlState(),
    metrics: defaultMetrics(asNumber(config.startBalance, 10000))
  };
}

function defaultHistory() {
  return {
    trades: []
  };
}

function normalizeBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.toLowerCase().trim();
    if (["true", "1", "yes", "on"].includes(v)) return true;
    if (["false", "0", "no", "off"].includes(v)) return false;
  }
  return fallback;
}

function sanitizeConfig(raw = {}) {
  const base = defaultConfig();
  const cycleIntervalMinutes = clamp(asNumber(raw.cycleIntervalMinutes ?? base.cycleIntervalMinutes, base.cycleIntervalMinutes), 1, 60);
  const legacyLookbackSec = raw.lookbackSec == null ? null : asNumber(raw.lookbackSec, 0);
  const derivedLookbackBars = legacyLookbackSec ? Math.max(2, Math.round(legacyLookbackSec / (cycleIntervalMinutes * 60))) : base.lookbackBars;

  return {
    ...base,
    ...raw,
    region: String(raw.region || base.region),
    source: raw.source === "binance_spot" ? "binance_spot" : "binance_futures",
    symbol: String(raw.symbol || base.symbol).trim().toUpperCase(),
    cycleIntervalMinutes,
    lookbackBars: clamp(asNumber(raw.lookbackBars ?? derivedLookbackBars, derivedLookbackBars), 2, 48),
    thresholdPct: Math.max(0.01, asNumber(raw.thresholdPct, base.thresholdPct)),
    thresholdCostMultiplier: clamp(asNumber(raw.thresholdCostMultiplier, base.thresholdCostMultiplier), 1, 3),
    cooldownCycles: clamp(Math.round(asNumber(raw.cooldownCycles, base.cooldownCycles)), 0, 24),
    leverage: clamp(asNumber(raw.leverage, base.leverage), 1, 25),
    riskPerTradePct: clamp(asNumber(raw.riskPerTradePct, base.riskPerTradePct), 0.1, 5),
    maxMarginPct: clamp(asNumber(raw.maxMarginPct, base.maxMarginPct), 1, 80),
    minMarginUsd: Math.max(5, asNumber(raw.minMarginUsd, base.minMarginUsd)),
    stopLossPct: clamp(asNumber(raw.stopLossPct ?? raw.slUsd, base.stopLossPct), 0.05, 5),
    takeProfitRR: clamp(asNumber(raw.takeProfitRR, base.takeProfitRR), 0.5, 5),
    trendFastBars: clamp(Math.round(asNumber(raw.trendFastBars, base.trendFastBars)), 2, 50),
    trendSlowBars: clamp(Math.round(asNumber(raw.trendSlowBars, base.trendSlowBars)), 3, 120),
    momentumBars: clamp(Math.round(asNumber(raw.momentumBars, base.momentumBars)), 1, 24),
    volatilityBars: clamp(Math.round(asNumber(raw.volatilityBars, base.volatilityBars)), 3, 48),
    maxVolatilityPct: clamp(asNumber(raw.maxVolatilityPct, base.maxVolatilityPct), 0.05, 5),
    minTrendStrengthPct: clamp(asNumber(raw.minTrendStrengthPct, base.minTrendStrengthPct), 0.01, 5),
    pullbackLookbackBars: clamp(Math.round(asNumber(raw.pullbackLookbackBars, base.pullbackLookbackBars)), 2, 24),
    pullbackTolerancePct: clamp(asNumber(raw.pullbackTolerancePct, base.pullbackTolerancePct), 0.01, 3),
    breakEvenTriggerR: clamp(asNumber(raw.breakEvenTriggerR, base.breakEvenTriggerR), 0.2, 3),
    trailingStopR: clamp(asNumber(raw.trailingStopR, base.trailingStopR), 0.5, 5),
    maxHoldCycles: clamp(Math.round(asNumber(raw.maxHoldCycles, base.maxHoldCycles)), 2, 200),
    exitOnTrendFlip: normalizeBoolean(raw.exitOnTrendFlip, base.exitOnTrendFlip),
    feeBps: clamp(asNumber(raw.feeBps, base.feeBps), 0, 100),
    slipBps: clamp(asNumber(raw.slipBps, base.slipBps), 0, 100),
    fundingBufferBps: clamp(asNumber(raw.fundingBufferBps, base.fundingBufferBps), 0, 50),
    useMlFilter: normalizeBoolean(raw.useMlFilter, base.useMlFilter),
    mlMinConfPct: clamp(asNumber(raw.mlMinConfPct, base.mlMinConfPct), 50, 99),
    onboarded: normalizeBoolean(raw.onboarded, base.onboarded),
    nick: String(raw.nick ?? base.nick),
    startBalance: Math.max(0, asNumber(raw.startBalance, base.startBalance)),
    maxPricePoints: clamp(Math.round(asNumber(raw.maxPricePoints, base.maxPricePoints)), 200, 5000),
    maxHistoryItems: clamp(Math.round(asNumber(raw.maxHistoryItems, base.maxHistoryItems)), 20, 1000)
  };
}

function sanitizeMlState(raw = {}) {
  const base = defaultMlState();
  const size = base.w.length;
  return {
    ...base,
    ...raw,
    enabled: normalizeBoolean(raw.enabled, base.enabled),
    horizonBars: clamp(Math.round(asNumber(raw.horizonBars, base.horizonBars)), 1, 12),
    lr: clamp(asNumber(raw.lr, base.lr), 0.001, 0.2),
    l2: clamp(asNumber(raw.l2, base.l2), 0, 0.1),
    normAlpha: clamp(asNumber(raw.normAlpha, base.normAlpha), 0.001, 0.5),
    deadzonePct: clamp(asNumber(raw.deadzonePct, base.deadzonePct), 0.001, 5),
    w: Array.isArray(raw.w) && raw.w.length === size ? raw.w.map((v) => asNumber(v, 0)) : base.w,
    mu: Array.isArray(raw.mu) && raw.mu.length === size ? raw.mu.map((v) => asNumber(v, 0)) : base.mu,
    va: Array.isArray(raw.va) && raw.va.length === size ? raw.va.map((v) => Math.max(1e-6, asNumber(v, 1))) : base.va,
    pending: Array.isArray(raw.pending) ? raw.pending.slice(-500) : [],
    stats: {
      n: asNumber(raw.stats && raw.stats.n, 0),
      correct: asNumber(raw.stats && raw.stats.correct, 0)
    }
  };
}

function sanitizeHistory(raw = {}, config) {
  const trades = Array.isArray(raw.trades) ? raw.trades.slice(0, config.maxHistoryItems) : [];
  return { trades };
}

function sanitizeState(raw = {}, config) {
  const base = defaultState(config);
  return {
    ...base,
    ...raw,
    onboarded: normalizeBoolean(raw.onboarded, config.onboarded),
    nick: String(raw.nick ?? config.nick ?? base.nick),
    balance: asNumber(raw.balance, base.balance),
    price: raw.price == null ? null : asNumber(raw.price, null),
    fundingRate: raw.fundingRate == null ? null : asNumber(raw.fundingRate, null),
    nextFundingTs: raw.nextFundingTs == null ? null : asNumber(raw.nextFundingTs, null),
    priceSeries: Array.isArray(raw.priceSeries) ? raw.priceSeries.slice(-config.maxPricePoints) : [],
    position: raw.position || null,
    algoOn: normalizeBoolean(raw.algoOn, base.algoOn),
    cycleCount: Math.max(0, Math.round(asNumber(raw.cycleCount, 0))),
    lastTradeCycle: Math.round(asNumber(raw.lastTradeCycle, base.lastTradeCycle)),
    lastTickAt: raw.lastTickAt || null,
    lastMessage: String(raw.lastMessage || base.lastMessage),
    mlSignal: raw.mlSignal || null,
    mlState: sanitizeMlState(raw.mlState),
    metrics: { ...defaultMetrics(config.startBalance), ...(raw.metrics || {}) }
  };
}

async function loadRuntime({ firestore, collectionPath = DEFAULT_COLLECTION }) {
  const refs = getRefs(firestore, collectionPath);
  const [configSnap, stateSnap, historySnap] = await Promise.all([
    refs.config.get(),
    refs.state.get(),
    refs.history.get()
  ]);

  const config = sanitizeConfig(configSnap.exists ? configSnap.data() : {});
  const state = sanitizeState(stateSnap.exists ? stateSnap.data() : {}, config);
  const history = sanitizeHistory(historySnap.exists ? historySnap.data() : {}, config);

  if (!configSnap.exists) {
    await refs.config.set(config, { merge: true });
  }
  if (!stateSnap.exists) {
    await refs.state.set(state, { merge: true });
  }
  if (!historySnap.exists) {
    await refs.history.set(history, { merge: true });
  }

  return { refs, config, state, history };
}

async function saveRuntime({ refs, config, state, history }) {
  await Promise.all([
    refs.config.set(config, { merge: true }),
    refs.state.set(state, { merge: true }),
    refs.history.set(history, { merge: true })
  ]);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${await response.text()}`);
  }
  return response.json();
}

async function fetchMarketSnapshot(config) {
  const symbol = encodeURIComponent(config.symbol);

  if (config.source === "binance_spot") {
    const ticker = await fetchJson(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    return {
      price: asNumber(ticker.price),
      fundingRate: null,
      nextFundingTs: null
    };
  }

  const premium = await fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`);
  return {
    price: asNumber(premium.markPrice),
    fundingRate: asNumber(premium.lastFundingRate, 0),
    nextFundingTs: asNumber(premium.nextFundingTime, null)
  };
}

function trimPriceSeries(series, maxPoints) {
  return series.slice(-maxPoints);
}

function appendPricePoint(state, config, price, ts) {
  state.priceSeries = trimPriceSeries(
    [...state.priceSeries, { t: ts, p: asNumber(price) }],
    config.maxPricePoints
  );
}

function getBar(points, barsAgo) {
  const idx = points.length - 1 - barsAgo;
  return idx >= 0 ? points[idx] : null;
}

function getReturnForBars(points, barsAgo) {
  const last = getBar(points, 0);
  const prev = getBar(points, barsAgo);
  if (!last || !prev || !prev.p) return 0;
  return (asNumber(last.p) - asNumber(prev.p)) / asNumber(prev.p);
}

function stdev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function ema(values, period) {
  if (values.length < period) return null;
  const factor = 2 / (period + 1);
  let current = values[0];
  for (let i = 1; i < values.length; i += 1) {
    current = values[i] * factor + current * (1 - factor);
  }
  return current;
}

function rsi(values, period = 6) {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses += -diff;
  }
  const rs = losses === 0 ? 999 : (gains / period) / (losses / period);
  return 100 - 100 / (1 + rs);
}

function priceReturns(points, bars) {
  const prices = points.map((entry) => asNumber(entry.p));
  const returns = [];
  for (let i = Math.max(1, prices.length - bars + 1); i < prices.length; i += 1) {
    const prev = prices[i - 1];
    returns.push(prev ? (prices[i] - prev) / prev : 0);
  }
  return returns;
}

function analyzeMarket(points, config) {
  const minBars = Math.max(
    14,
    asNumber(config.trendSlowBars) + 2,
    asNumber(config.volatilityBars) + 2,
    asNumber(config.pullbackLookbackBars) + 2,
    asNumber(config.lookbackBars) + 2
  );
  if (points.length < minBars) return null;

  const prices = points.map((entry) => asNumber(entry.p));
  const current = prices[prices.length - 1];
  const fastPeriod = Math.min(prices.length, Math.max(2, Math.round(asNumber(config.trendFastBars))));
  const slowPeriod = Math.min(prices.length, Math.max(fastPeriod + 1, Math.round(asNumber(config.trendSlowBars))));
  const volatilityPeriod = Math.min(prices.length - 1, Math.max(3, Math.round(asNumber(config.volatilityBars))));
  const pullbackPeriod = Math.min(prices.length, Math.max(2, Math.round(asNumber(config.pullbackLookbackBars))));
  const momentumBars = Math.max(1, Math.round(asNumber(config.momentumBars)));
  const fastEma = ema(prices.slice(-fastPeriod), fastPeriod);
  const slowEma = ema(prices.slice(-slowPeriod), slowPeriod);
  const volatilityPct = stdev(priceReturns(points, volatilityPeriod)) * 100;
  const trendStrengthPct = current && fastEma != null && slowEma != null ? (Math.abs(fastEma - slowEma) / current) * 100 : 0;
  const momentumPct = getReturnForBars(points, momentumBars) * 100;
  const longMomentumPct = getReturnForBars(points, Math.max(momentumBars * 2, asNumber(config.lookbackBars))) * 100;
  const recent = prices.slice(-pullbackPeriod);
  const low = Math.min(...recent);
  const high = Math.max(...recent);
  const rangePos = high - low > 0 ? (current - low) / (high - low) : 0.5;
  const rsiValue = rsi(prices.slice(-Math.max(7, slowPeriod)), 6);
  const thresholdPct = costThresholdPct(config);
  const trendSide = fastEma > slowEma ? "LONG" : "SHORT";
  const pullbackTolerance = asNumber(config.pullbackTolerancePct);
  const minTrendStrengthPct = asNumber(config.minTrendStrengthPct);
  const maxVolatilityPct = asNumber(config.maxVolatilityPct);
  const isTrendStrong = trendStrengthPct >= minTrendStrengthPct;
  const isVolatilityOk = volatilityPct > 0 && volatilityPct <= maxVolatilityPct;

  let side = null;
  let reason = "trend";

  if (isTrendStrong && isVolatilityOk) {
    const longSetup =
      trendSide === "LONG" &&
      momentumPct >= thresholdPct * 0.35 &&
      longMomentumPct >= thresholdPct &&
      rangePos <= 0.72 &&
      rsiValue != null &&
      rsiValue >= 48 &&
      rsiValue <= 68;

    const shortSetup =
      trendSide === "SHORT" &&
      momentumPct <= -thresholdPct * 0.35 &&
      longMomentumPct <= -thresholdPct &&
      rangePos >= 0.28 &&
      rsiValue != null &&
      rsiValue <= 52 &&
      rsiValue >= 32;

    if (longSetup) {
      side = "LONG";
      if (rangePos <= 0.45 + pullbackTolerance) reason = "trend-pullback";
    } else if (shortSetup) {
      side = "SHORT";
      if (rangePos >= 0.55 - pullbackTolerance) reason = "trend-pullback";
    }
  }

  return {
    side,
    reason,
    thresholdPct,
    trendSide,
    trendStrengthPct,
    volatilityPct,
    momentumPct,
    longMomentumPct,
    rangePos,
    rsiValue,
    fastEma,
    slowEma
  };
}

function featureVector(points) {
  if (points.length < 12) return null;
  const prices = points.map((entry) => asNumber(entry.p));
  const current = prices[prices.length - 1];
  const ema3 = ema(prices.slice(-12), 3);
  const ema6 = ema(prices.slice(-12), 6);
  const rsiValue = rsi(prices.slice(-12), 6);
  const returns = [];
  for (let i = Math.max(1, prices.length - 6); i < prices.length; i += 1) {
    returns.push(prices[i - 1] ? (prices[i] - prices[i - 1]) / prices[i - 1] : 0);
  }
  const recent = prices.slice(-6);
  const low = Math.min(...recent);
  const high = Math.max(...recent);
  const rangePos = high - low > 0 ? ((current - low) / (high - low)) * 2 - 1 : 0;

  return [
    getReturnForBars(points, 1),
    getReturnForBars(points, 2),
    getReturnForBars(points, 3),
    getReturnForBars(points, 6),
    getReturnForBars(points, 12),
    stdev(returns),
    ema3 && ema6 ? (ema3 - ema6) / current : 0,
    rsiValue == null ? 0 : (rsiValue - 50) / 50,
    rangePos
  ];
}

function standardize(mlState, vector, shouldUpdate) {
  const alpha = asNumber(mlState.normAlpha, 0.05);
  const z = new Array(vector.length);

  for (let i = 0; i < vector.length; i += 1) {
    let mu = asNumber(mlState.mu[i], 0);
    let va = Math.max(1e-6, asNumber(mlState.va[i], 1));

    if (shouldUpdate) {
      mu = (1 - alpha) * mu + alpha * vector[i];
      const diff = vector[i] - mu;
      va = (1 - alpha) * va + alpha * diff * diff;
      mlState.mu[i] = mu;
      mlState.va[i] = va;
    }

    z[i] = (vector[i] - mu) / (Math.sqrt(va) + 1e-8);
  }

  return z;
}

function dot(a, b) {
  return a.reduce((sum, value, idx) => sum + value * b[idx], 0);
}

function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

function updateMlSignal(state, config, nowTs) {
  const mlState = sanitizeMlState(state.mlState);
  state.mlState = mlState;

  if (!mlState.enabled) {
    state.mlSignal = null;
    return;
  }

  const vector = featureVector(state.priceSeries);
  if (!vector) {
    state.mlSignal = null;
    return;
  }

  const x = standardize(mlState, vector, false);
  const score = dot(mlState.w, x) + asNumber(mlState.b, 0);
  const pLong = sigmoid(score);
  const pShort = 1 - pLong;

  state.mlSignal = {
    side: pLong >= pShort ? "LONG" : "SHORT",
    conf: Math.max(pLong, pShort),
    pLong,
    pShort,
    ts: nowTs
  };

  mlState.pending.push({
    cycle: state.cycleCount,
    price: asNumber(state.price),
    x: vector
  });
  mlState.pending = mlState.pending.slice(-500);

  while (mlState.pending.length) {
    const sample = mlState.pending[0];
    if (state.cycleCount - asNumber(sample.cycle, state.cycleCount) < mlState.horizonBars) break;

    mlState.pending.shift();
    const currentPrice = asNumber(state.price);
    const retPct = ((currentPrice - asNumber(sample.price)) / asNumber(sample.price)) * 100;
    if (Math.abs(retPct) < mlState.deadzonePct) continue;

    const label = retPct > 0 ? 1 : 0;
    const trainedX = standardize(mlState, sample.x, true);
    const z = dot(mlState.w, trainedX) + asNumber(mlState.b, 0);
    const p = sigmoid(z);
    const err = p - label;

    for (let i = 0; i < mlState.w.length; i += 1) {
      mlState.w[i] -= mlState.lr * (err * trainedX[i] + mlState.l2 * mlState.w[i]);
    }
    mlState.b -= mlState.lr * err;
    mlState.stats.n += 1;
    if ((p >= 0.5 ? 1 : 0) === label) mlState.stats.correct += 1;
  }

  state.mlState = mlState;
}

function feeRate(config) {
  return asNumber(config.feeBps) / 10000;
}

function slipRate(config) {
  return asNumber(config.slipBps) / 10000;
}

function costThresholdPct(config) {
  const roundTripCostPct = (feeRate(config) + slipRate(config)) * 2 * 100;
  const fundingPct = config.source === "binance_futures" ? asNumber(config.fundingBufferBps) / 100 : 0;
  return asNumber(config.thresholdPct) + roundTripCostPct * asNumber(config.thresholdCostMultiplier, 1) + fundingPct;
}

function applySlippage(price, side, isOpen, config) {
  const rate = slipRate(config);
  if (!rate) return price;
  if (side === "LONG") return isOpen ? price * (1 + rate) : price * (1 - rate);
  return isOpen ? price * (1 - rate) : price * (1 + rate);
}

function calcLiquidationPrice(entry, leverage, side) {
  const lev = Math.max(1, leverage);
  return side === "LONG" ? entry * (1 - 0.9 / lev) : entry * (1 + 0.9 / lev);
}

function estimateFundingPnl(position, fundingRate, elapsedMs) {
  if (!position || !Number.isFinite(fundingRate) || elapsedMs <= 0) return 0;
  const sideFactor = position.side === "LONG" ? -1 : 1;
  const scaledRate = fundingRate * (elapsedMs / EIGHT_HOURS_MS);
  return sideFactor * asNumber(position.notional) * scaledRate;
}

function applyFundingAccrual(state, config, nowTs) {
  if (config.source !== "binance_futures" || !state.position) return 0;
  const position = state.position;
  const lastTs = asNumber(position.lastFundingAccrualTs, nowTs);
  const elapsedMs = Math.max(0, nowTs - lastTs);
  const delta = estimateFundingPnl(position, asNumber(state.fundingRate, 0), elapsedMs);
  position.fundingAccrued = asNumber(position.fundingAccrued, 0) + delta;
  position.lastFundingAccrualTs = nowTs;
  return delta;
}

function computeRiskSizing(config, state, entryPrice) {
  const balance = asNumber(state.balance);
  const leverage = asNumber(config.leverage);
  const stopLossPct = asNumber(config.stopLossPct) / 100;
  const riskBudget = balance * (asNumber(config.riskPerTradePct) / 100);
  const stopDistance = entryPrice * stopLossPct;
  const roundTripCostPerUnit = entryPrice * ((feeRate(config) + slipRate(config)) * 2);
  const riskPerUnit = stopDistance + roundTripCostPerUnit;
  const qtyByRisk = riskPerUnit > 0 ? riskBudget / riskPerUnit : 0;
  const maxMargin = Math.max(asNumber(config.minMarginUsd), balance * (asNumber(config.maxMarginPct) / 100));
  const maxQtyByMargin = (maxMargin * leverage) / entryPrice;
  const qty = Math.max(0, Math.min(qtyByRisk, maxQtyByMargin));
  const notional = qty * entryPrice;
  const margin = notional / leverage;

  return {
    qty,
    notional,
    margin,
    riskBudget,
    stopDistance
  };
}

function openPosition(state, config, side, reason, nowTs) {
  if (!state.onboarded || state.position || !Number.isFinite(asNumber(state.price, NaN))) return false;
  const entryRaw = asNumber(state.price);
  const entry = applySlippage(entryRaw, side, true, config);
  const sizing = computeRiskSizing(config, state, entry);
  const openFee = sizing.notional * feeRate(config);

  if (sizing.margin < asNumber(config.minMarginUsd) || state.balance < sizing.margin + openFee) {
    state.lastMessage = "Insufficient demo balance for risk-sized entry";
    return false;
  }

  const stopDistance = entry * (asNumber(config.stopLossPct) / 100);
  const stopLoss = side === "LONG" ? entry - stopDistance : entry + stopDistance;
  const takeProfitDistance = stopDistance * asNumber(config.takeProfitRR);
  const takeProfit = side === "LONG" ? entry + takeProfitDistance : entry - takeProfitDistance;

  state.balance -= sizing.margin + openFee;
  state.position = {
    side,
    reason,
    entry,
    qty: sizing.qty,
    notional: sizing.notional,
    margin: sizing.margin,
    leverage: asNumber(config.leverage),
    stopLoss,
    takeProfit,
    liquidation: calcLiquidationPrice(entry, asNumber(config.leverage), side),
    riskBudget: sizing.riskBudget,
    initialRiskPerUnit: stopDistance,
    openFee,
    fundingAccrued: 0,
    lastFundingAccrualTs: nowTs,
    openedAt: nowTs,
    openedCycle: state.cycleCount,
    bestPrice: entry,
    worstPrice: entry,
    breakEvenArmed: false
  };
  state.lastTradeCycle = state.cycleCount;
  state.lastMessage = `Opened ${side} (${reason})`;
  return true;
}

function appendClosedTrade(history, config, trade) {
  history.trades = [trade, ...(history.trades || [])].slice(0, config.maxHistoryItems);
}

function calculateMetrics(history, config, state) {
  const ascending = [...(history.trades || [])].reverse();
  const wins = ascending.filter((trade) => asNumber(trade.netPnl) > 0);
  const losses = ascending.filter((trade) => asNumber(trade.netPnl) <= 0);
  const grossProfit = wins.reduce((sum, trade) => sum + asNumber(trade.netPnl), 0);
  const grossLossAbs = Math.abs(losses.reduce((sum, trade) => sum + Math.min(asNumber(trade.netPnl), 0), 0));
  let equity = asNumber(config.startBalance);
  let peakEquity = equity;
  let maxDrawdownPct = 0;

  for (const trade of ascending) {
    equity = asNumber(trade.balanceAfter, equity);
    peakEquity = Math.max(peakEquity, equity);
    const ddPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    maxDrawdownPct = Math.max(maxDrawdownPct, ddPct);
  }

  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((sum, trade) => sum + Math.abs(asNumber(trade.netPnl)), 0) / losses.length : 0;
  const closedTrades = ascending.length;
  const winRate = closedTrades ? (wins.length / closedTrades) * 100 : 0;
  const expectancy = closedTrades ? ascending.reduce((sum, trade) => sum + asNumber(trade.netPnl), 0) / closedTrades : 0;

  state.metrics = {
    closedTrades,
    wins: wins.length,
    losses: losses.length,
    winRatePct: winRate,
    avgWin,
    avgLoss,
    expectancy,
    maxDrawdownPct,
    profitFactor: grossLossAbs > 0 ? grossProfit / grossLossAbs : (grossProfit > 0 ? 999 : 0),
    netPnl: ascending.reduce((sum, trade) => sum + asNumber(trade.netPnl), 0),
    grossProfit,
    grossLossAbs,
    currentEquity: asNumber(state.balance),
    peakEquity: peakEquity
  };
}

function closePosition(state, config, history, exitRaw, note, nowTs) {
  if (!state.position) return false;
  const position = state.position;
  const exit = applySlippage(asNumber(exitRaw), position.side, false, config);
  const direction = position.side === "LONG" ? 1 : -1;
  const pricePnl = direction * asNumber(position.qty) * (exit - asNumber(position.entry));
  const closeFee = asNumber(position.notional) * feeRate(config);
  const fundingPnl = asNumber(position.fundingAccrued, 0);
  const netPnl = pricePnl + fundingPnl - closeFee;

  state.balance += asNumber(position.margin) + netPnl;
  appendClosedTrade(history, config, {
    ts: nowTs,
    symbol: config.symbol,
    source: config.source,
    side: position.side,
    entry: position.entry,
    exit,
    qty: position.qty,
    grossPnl: pricePnl,
    fundingPnl,
    fees: asNumber(position.openFee) + closeFee,
    netPnl: netPnl - asNumber(position.openFee),
    reason: note,
    balanceAfter: state.balance,
    openedAt: position.openedAt,
    closedAt: nowTs
  });
  state.position = null;
  state.lastTradeCycle = state.cycleCount;
  state.lastMessage = `Closed position (${note})`;
  calculateMetrics(history, config, state);
  return true;
}

function liquidate(state, config, history, reason, nowTs) {
  if (!state.position) return false;
  const position = state.position;
  const fundingPnl = asNumber(position.fundingAccrued, 0);
  appendClosedTrade(history, config, {
    ts: nowTs,
    symbol: config.symbol,
    source: config.source,
    side: position.side,
    entry: position.entry,
    exit: asNumber(state.price),
    qty: position.qty,
    grossPnl: -asNumber(position.margin),
    fundingPnl,
    fees: asNumber(position.openFee),
    netPnl: -asNumber(position.margin) + fundingPnl - asNumber(position.openFee),
    reason: `LIQUIDATED (${reason})`,
    balanceAfter: state.balance,
    openedAt: position.openedAt,
    closedAt: nowTs
  });
  state.position = null;
  state.lastTradeCycle = state.cycleCount;
  state.lastMessage = `Liquidated (${reason})`;
  calculateMetrics(history, config, state);
  return true;
}

function maybeManageOpenPosition(state, config, history, nowTs) {
  if (!state.position) return;
  const current = asNumber(state.price);
  const position = state.position;
  const market = analyzeMarket(state.priceSeries, config);
  const initialRiskPerUnit = Math.max(asNumber(position.initialRiskPerUnit), 1e-8);
  const rewardPerUnit = position.side === "LONG" ? current - asNumber(position.entry) : asNumber(position.entry) - current;
  const rewardR = rewardPerUnit / initialRiskPerUnit;

  position.bestPrice = position.side === "LONG"
    ? Math.max(asNumber(position.bestPrice, position.entry), current)
    : Math.min(asNumber(position.bestPrice, position.entry), current);
  position.worstPrice = position.side === "LONG"
    ? Math.min(asNumber(position.worstPrice, position.entry), current)
    : Math.max(asNumber(position.worstPrice, position.entry), current);

  if (!position.breakEvenArmed && rewardR >= asNumber(config.breakEvenTriggerR)) {
    position.breakEvenArmed = true;
    const buffer = current * (costThresholdPct(config) / 100) * 0.25;
    position.stopLoss = position.side === "LONG"
      ? Math.max(asNumber(position.stopLoss), asNumber(position.entry) + buffer)
      : Math.min(asNumber(position.stopLoss), asNumber(position.entry) - buffer);
  }

  if (rewardR >= asNumber(config.trailingStopR)) {
    const trailDistance = Math.max(initialRiskPerUnit * 0.75, current * (asNumber(config.maxVolatilityPct) / 100) * 0.5);
    const trailingStop = position.side === "LONG"
      ? asNumber(position.bestPrice) - trailDistance
      : asNumber(position.bestPrice) + trailDistance;
    position.stopLoss = position.side === "LONG"
      ? Math.max(asNumber(position.stopLoss), trailingStop)
      : Math.min(asNumber(position.stopLoss), trailingStop);
  }

  if (config.exitOnTrendFlip && market && market.side && market.side !== position.side && rewardR > 0.15) {
    closePosition(state, config, history, current, "trend-flip", nowTs);
    return;
  }

  if (state.cycleCount - asNumber(position.openedCycle, state.cycleCount) >= asNumber(config.maxHoldCycles) && rewardR > -0.25) {
    closePosition(state, config, history, current, "time-exit", nowTs);
    return;
  }

  if (position.side === "LONG" && current <= asNumber(position.liquidation)) {
    liquidate(state, config, history, "price<=liquidation", nowTs);
    return;
  }
  if (position.side === "SHORT" && current >= asNumber(position.liquidation)) {
    liquidate(state, config, history, "price>=liquidation", nowTs);
    return;
  }
  if (position.side === "LONG" && current <= asNumber(position.stopLoss)) {
    closePosition(state, config, history, current, "stop-loss", nowTs);
    return;
  }
  if (position.side === "SHORT" && current >= asNumber(position.stopLoss)) {
    closePosition(state, config, history, current, "stop-loss", nowTs);
    return;
  }
  if (position.side === "LONG" && current >= asNumber(position.takeProfit)) {
    closePosition(state, config, history, current, "take-profit", nowTs);
    return;
  }
  if (position.side === "SHORT" && current <= asNumber(position.takeProfit)) {
    closePosition(state, config, history, current, "take-profit", nowTs);
  }
}

function maybeOpenTrade(state, config, nowTs) {
  if (!state.algoOn || !state.onboarded || state.position) return false;
  if (state.cycleCount - asNumber(state.lastTradeCycle, -999999) <= asNumber(config.cooldownCycles)) return false;
  const market = analyzeMarket(state.priceSeries, config);
  if (!market) {
    state.lastMessage = "Warming up price history";
    return false;
  }

  const side = market.side;
  if (!side) {
    state.lastMessage = `No signal: trend ${market.trendStrengthPct.toFixed(3)}% vol ${market.volatilityPct.toFixed(3)}% momentum ${market.momentumPct.toFixed(3)}%`;
    return false;
  }

  if (config.useMlFilter) {
    const signal = state.mlSignal;
    const enoughConf = signal && asNumber(signal.conf) >= asNumber(config.mlMinConfPct) / 100;
    if (!signal || signal.side !== side || !enoughConf) {
      state.lastMessage = "Signal rejected by ML filter";
      return false;
    }
  }

  const baseReason = market.reason || "trend";
  return openPosition(state, config, side, config.useMlFilter ? `${baseReason}+ml` : baseReason, nowTs);
}

function normalizeBacktestPoint(point, index, config) {
  const stepMs = Math.max(1, asNumber(config.cycleIntervalMinutes, 5)) * 60 * 1000;
  const defaultTs = index * stepMs;

  if (typeof point === "number") {
    return {
      price: point,
      fundingRate: 0,
      nextFundingTs: null,
      ts: defaultTs
    };
  }

  return {
    price: asNumber(point.price ?? point.p),
    fundingRate: point.fundingRate == null ? 0 : asNumber(point.fundingRate, 0),
    nextFundingTs: point.nextFundingTs == null ? null : asNumber(point.nextFundingTs, null),
    ts: point.ts == null ? defaultTs : asNumber(point.ts, defaultTs)
  };
}

function computeBacktestSummary(config, state, history) {
  const trades = history.trades || [];
  const recentTrade = trades[0] || null;
  return {
    config,
    metrics: { ...(state.metrics || {}) },
    tradeCount: trades.length,
    lastTrade: recentTrade,
    finalBalance: asNumber(state.balance),
    netPnl: asNumber(state.balance) - asNumber(config.startBalance),
    trades: [...trades].reverse()
  };
}

function runBacktest({ series = [], config: configOverrides = {}, closeOpenPositionOnEnd = true } = {}) {
  const config = sanitizeConfig({ ...defaultConfig(), ...configOverrides });
  const state = defaultState(config);
  const history = defaultHistory();

  state.onboarded = true;
  state.algoOn = true;
  state.balance = asNumber(config.startBalance, 10000);
  state.metrics = defaultMetrics(state.balance);
  state.lastMessage = "Backtest initialized";

  for (let i = 0; i < series.length; i += 1) {
    const point = normalizeBacktestPoint(series[i], i, config);
    if (!Number.isFinite(point.price) || point.price <= 0) continue;

    state.cycleCount += 1;
    state.lastTickAt = nowIso(point.ts);
    state.price = point.price;
    state.fundingRate = point.fundingRate;
    state.nextFundingTs = point.nextFundingTs;

    appendPricePoint(state, config, point.price, point.ts);
    updateMlSignal(state, config, point.ts);
    applyFundingAccrual(state, config, point.ts);
    maybeManageOpenPosition(state, config, history, point.ts);
    if (!state.position) {
      maybeOpenTrade(state, config, point.ts);
    }
    calculateMetrics(history, config, state);
  }

  if (closeOpenPositionOnEnd && state.position && Number.isFinite(asNumber(state.price, NaN))) {
    closePosition(
      state,
      config,
      history,
      asNumber(state.price),
      "end-of-series",
      Date.now()
    );
    calculateMetrics(history, config, state);
  }

  return computeBacktestSummary(config, state, history);
}

function expandSearchSpace(searchSpace = {}) {
  const entries = Object.entries(searchSpace)
    .filter(([, values]) => Array.isArray(values) && values.length);

  if (!entries.length) return [{}];

  const variants = [];
  const walk = (index, current) => {
    if (index >= entries.length) {
      variants.push({ ...current });
      return;
    }

    const [key, values] = entries[index];
    for (const value of values) {
      current[key] = value;
      walk(index + 1, current);
    }
  };

  walk(0, {});
  return variants;
}

function scoreBacktestResult(result) {
  const metrics = result.metrics || {};
  const tradeCount = asNumber(result.tradeCount, 0);
  const netPnl = asNumber(metrics.netPnl, result.netPnl);
  const winRate = asNumber(metrics.winRatePct, 0);
  const profitFactor = Math.min(5, asNumber(metrics.profitFactor, 0));
  const maxDrawdownPct = asNumber(metrics.maxDrawdownPct, 0);
  const expectancy = asNumber(metrics.expectancy, 0);
  const activityBonus = Math.min(tradeCount, 40) * 0.03;

  return (
    netPnl +
    expectancy * 8 +
    winRate * 0.4 +
    profitFactor * 12 +
    activityBonus -
    maxDrawdownPct * 2.5
  );
}

function optimizeBacktest({
  series = [],
  baseConfig = {},
  searchSpace = {},
  topN = 10
} = {}) {
  const variants = expandSearchSpace(searchSpace);
  const results = variants.map((variant) => {
    const config = { ...baseConfig, ...variant };
    const result = runBacktest({ series, config });
    return {
      score: scoreBacktestResult(result),
      config,
      result
    };
  });

  results.sort((a, b) => b.score - a.score);
  return {
    tested: results.length,
    top: results.slice(0, Math.max(1, topN))
  };
}

function summarizeRuntime(config, state, history) {
  return {
    config,
    state: {
      onboarded: state.onboarded,
      nick: state.nick,
      algoOn: state.algoOn,
      balance: state.balance,
      price: state.price,
      fundingRate: state.fundingRate,
      nextFundingTs: state.nextFundingTs,
      cycleCount: state.cycleCount,
      lastTickAt: state.lastTickAt,
      lastMessage: state.lastMessage,
      position: state.position,
      mlSignal: state.mlSignal,
      metrics: state.metrics
    },
    history: {
      trades: (history.trades || []).slice(0, 25)
    }
  };
}

async function runTradingCycle({ firestore, collectionPath = DEFAULT_COLLECTION, trigger = "manual" }) {
  const runtime = await loadRuntime({ firestore, collectionPath });
  const { refs, config, state, history } = runtime;
  const nowTs = Date.now();

  state.cycleCount += 1;
  state.lastTickAt = nowIso(nowTs);

  if (!state.onboarded) {
    state.lastMessage = "Waiting for onboarding";
    await saveRuntime({ refs, config, state, history });
    return { ok: true, trigger, skipped: true, reason: "not-onboarded", ...summarizeRuntime(config, state, history) };
  }

  if (!state.algoOn) {
    state.lastMessage = "Algo disabled";
    await saveRuntime({ refs, config, state, history });
    return { ok: true, trigger, skipped: true, reason: "algo-disabled", ...summarizeRuntime(config, state, history) };
  }

  const market = await fetchMarketSnapshot(config);
  state.price = market.price;
  state.fundingRate = market.fundingRate;
  state.nextFundingTs = market.nextFundingTs;
  appendPricePoint(state, config, market.price, nowTs);
  updateMlSignal(state, config, nowTs);
  applyFundingAccrual(state, config, nowTs);
  maybeManageOpenPosition(state, config, history, nowTs);
  if (!state.position) {
    maybeOpenTrade(state, config, nowTs);
  }
  calculateMetrics(history, config, state);
  await saveRuntime({ refs, config, state, history });

  return { ok: true, trigger, ...summarizeRuntime(config, state, history) };
}

async function activateDemoTrader({ firestore, collectionPath = DEFAULT_COLLECTION, payload = {} }) {
  const runtime = await loadRuntime({ firestore, collectionPath });
  const config = sanitizeConfig({ ...runtime.config, ...payload, onboarded: true });
  const state = sanitizeState(runtime.state, config);
  const history = sanitizeHistory(runtime.history, config);

  state.onboarded = true;
  state.nick = String(payload.nick || config.nick || state.nick || "");
  state.balance = Math.max(0, asNumber(payload.startBalance, config.startBalance));
  state.algoOn = normalizeBoolean(payload.algoOn, false);
  state.lastMessage = "Demo trader activated";
  state.metrics = defaultMetrics(state.balance);
  history.trades = [];

  await saveRuntime({ refs: runtime.refs, config, state, history });
  return { ok: true, ...summarizeRuntime(config, state, history) };
}

async function setTraderRunning({ firestore, collectionPath = DEFAULT_COLLECTION, running }) {
  const runtime = await loadRuntime({ firestore, collectionPath });
  const state = sanitizeState(runtime.state, runtime.config);
  state.algoOn = Boolean(running);
  state.lastMessage = running ? "Algo started manually" : "Algo stopped manually";
  await saveRuntime({ refs: runtime.refs, config: runtime.config, state, history: runtime.history });
  return { ok: true, ...summarizeRuntime(runtime.config, state, runtime.history) };
}

async function updateTraderConfig({ firestore, collectionPath = DEFAULT_COLLECTION, payload = {} }) {
  const runtime = await loadRuntime({ firestore, collectionPath });
  const config = sanitizeConfig({ ...runtime.config, ...payload });
  const state = sanitizeState(runtime.state, config);
  const history = sanitizeHistory(runtime.history, config);
  calculateMetrics(history, config, state);
  await saveRuntime({ refs: runtime.refs, config, state, history });
  return { ok: true, ...summarizeRuntime(config, state, history) };
}

async function getTradingStatus({ firestore, collectionPath = DEFAULT_COLLECTION }) {
  const runtime = await loadRuntime({ firestore, collectionPath });
  calculateMetrics(runtime.history, runtime.config, runtime.state);
  await saveRuntime({
    refs: runtime.refs,
    config: runtime.config,
    state: runtime.state,
    history: runtime.history
  });
  return { ok: true, ...summarizeRuntime(runtime.config, runtime.state, runtime.history) };
}

module.exports = {
  DEFAULT_COLLECTION,
  defaultConfig,
  defaultState,
  runBacktest,
  optimizeBacktest,
  sanitizeConfig,
  sanitizeState,
  loadRuntime,
  runTradingCycle,
  activateDemoTrader,
  setTraderRunning,
  updateTraderConfig,
  getTradingStatus
};
