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
    strategyMode: "trend",
    symbol: "BTCUSDT",
    baseSymbol: "BTCUSDT",
    quoteSymbol: "ETHUSDT",
    cycleIntervalMinutes: 5,
    lookbackBars: 6,
    thresholdPct: 0.08,
    thresholdCostMultiplier: 1,
    cooldownCycles: 0,
    pairLookbackBars: 120,
    pairMinCorrelation: 0.65,
    pairEntryZScore: 2.0,
    pairMaxEntryZScore: 2.8,
    pairExitZScore: 0.4,
    pairStopZScore: 3.2,
    usePairMetaModel: false,
    pairMetaModelPath: "./data/pair-meta-model.json",
    pairMetaModel: null,
    pairMetaMinProbability: 0.58,
    pairMetaMinExpectedR: 0.0,
    pairMetaFailOpen: true,
    pairMetaRequirePositiveEV: true,
    pairRequireReversionConfirmation: true,
    pairReversionConfirmDelta: 0.15,
    pairReversionConfirmBars: 2,
    pairMaxSpreadVolatility: 0,
    pairMinRecentTradeProfitFactor: 0,
    pairPauseAfterPairLosses: 0,
    pairUseLogSpread: true,
    pairHedgeMode: "beta",
    pairBetaLookbackBars: 120,
    pairRiskPerTradePct: 0.5,
    pairMaxGrossExposurePct: 30,
    pairMinHalfLifeBars: 3,
    pairMaxHalfLifeBars: 80,
    pairCooldownCycles: 2,
    pairPartialExitEnabled: false,
    pairEarlyExitZScore: 1.2,
    pairEarlyExitMinProfitUsd: 1.0,
    pairUniverseEnabled: false,
    pairUniverse: [
      ["BTCUSDT", "ETHUSDT"],
      ["BTCUSDT", "SOLUSDT"],
      ["ETHUSDT", "SOLUSDT"],
      ["BTCUSDT", "BNBUSDT"],
      ["ETHUSDT", "BNBUSDT"],
      ["SOLUSDT", "BNBUSDT"]
    ],
    allowTrendFallbackWhenNoPair: false,
    leverage: 8,
    riskPerTradePct: 0.75,
    maxMarginPct: 20,
    minMarginUsd: 25,
    stopLossPct: 0.45,
    takeProfitRR: 1.6,
    trendFastBars: 4,
    trendSlowBars: 11,
    momentumBars: 2,
    volatilityBars: 8,
    maxVolatilityPct: 0.55,
    minTrendStrengthPct: 0.05,
    pullbackLookbackBars: 4,
    pullbackTolerancePct: 0.28,
    breakEvenTriggerR: 0.9,
    trailingStopR: 1.45,
    maxHoldCycles: 30,
    exitOnTrendFlip: true,
    feeBps: 4,
    slipBps: 2,
    fundingBufferBps: 1,
    useMlFilter: true,
    mlMinConfPct: 56,
    maxDailyLossPct: 5,
    maxWeeklyLossPct: 12,
    maxConsecutiveLosses: 5,
    lossStreakCooldownCycles: 72,
    lossStreakReducedRiskMultiplier: 0.35,
    autoResumeAfterLossCooldown: true,
    hardStopAfterConsecutiveLosses: 10,
    pauseAfterDrawdownPct: 15,
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
    basePrice: null,
    quotePrice: null,
    fundingRate: null,
    fundingRateBase: null,
    fundingRateQuote: null,
    nextFundingTs: null,
    nextFundingTsBase: null,
    nextFundingTsQuote: null,
    priceSeries: [],
    pairSeries: [],
    pairSeriesByKey: {},
    symbolPrices: {},
    position: null,
    algoOn: false,
    cycleCount: 0,
    lastTradeCycle: -999999,
    lastTickAt: null,
    lastMessage: "Initialized",
    lastPairAnalysis: null,
    lastPairMeta: null,
    pairSetupLog: [],
    pendingPairSignal: null,
    pendingPairSignalByKey: {},
    pairRecentStats: null,
    pairOpportunities: [],
    rejectedSignals: {},
    riskMode: "normal",
    lossCooldownUntilCycle: null,
    reducedRiskRecoveryWins: 0,
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

function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizePairUniverse(raw, fallback) {
  let source = raw;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch (error) {
      source = fallback;
    }
  }
  if (!Array.isArray(source)) source = fallback;

  const seen = new Set();
  const pairs = [];
  for (const item of source) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const base = normalizeSymbol(item[0]);
    const quote = normalizeSymbol(item[1]);
    if (!base || !quote || base === quote) continue;
    const key = pairKey(base, quote);
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push([base, quote]);
  }
  return pairs.length ? pairs : fallback.map(([base, quote]) => [base, quote]);
}

function pairKey(baseSymbol, quoteSymbol) {
  return `${normalizeSymbol(baseSymbol)}_${normalizeSymbol(quoteSymbol)}`;
}

function sanitizeConfig(raw = {}) {
  const base = defaultConfig();
  const cycleIntervalMinutes = clamp(asNumber(raw.cycleIntervalMinutes ?? base.cycleIntervalMinutes, base.cycleIntervalMinutes), 1, 60);
  const legacyLookbackSec = raw.lookbackSec == null ? null : asNumber(raw.lookbackSec, 0);
  const derivedLookbackBars = legacyLookbackSec ? Math.max(2, Math.round(legacyLookbackSec / (cycleIntervalMinutes * 60))) : base.lookbackBars;
  const strategyMode = raw.strategyMode === "pairs" ? "pairs" : "trend";
  const pairEntryZScore = clamp(asNumber(raw.pairEntryZScore, base.pairEntryZScore), 0.5, 6);
  const pairExitZScore = clamp(asNumber(raw.pairExitZScore, base.pairExitZScore), 0.05, pairEntryZScore - 0.05);
  const pairStopZScore = clamp(asNumber(raw.pairStopZScore, base.pairStopZScore), pairEntryZScore + 0.1, 10);
  const pairMaxEntryZScore = clamp(asNumber(raw.pairMaxEntryZScore, base.pairMaxEntryZScore), pairEntryZScore, pairStopZScore);
  const pairUniverse = normalizePairUniverse(raw.pairUniverse, base.pairUniverse);

  return {
    ...base,
    ...raw,
    region: String(raw.region || base.region),
    source: raw.source === "binance_spot" ? "binance_spot" : "binance_futures",
    strategyMode,
    symbol: String(raw.symbol || base.symbol).trim().toUpperCase(),
    baseSymbol: String(raw.baseSymbol || raw.symbol || base.baseSymbol).trim().toUpperCase(),
    quoteSymbol: String(raw.quoteSymbol || base.quoteSymbol).trim().toUpperCase(),
    cycleIntervalMinutes,
    lookbackBars: clamp(asNumber(raw.lookbackBars ?? derivedLookbackBars, derivedLookbackBars), 2, 48),
    thresholdPct: Math.max(0.01, asNumber(raw.thresholdPct, base.thresholdPct)),
    thresholdCostMultiplier: clamp(asNumber(raw.thresholdCostMultiplier, base.thresholdCostMultiplier), 1, 3),
    cooldownCycles: clamp(Math.round(asNumber(raw.cooldownCycles, base.cooldownCycles)), 0, 24),
    pairLookbackBars: clamp(Math.round(asNumber(raw.pairLookbackBars, base.pairLookbackBars)), 20, 500),
    pairMinCorrelation: clamp(asNumber(raw.pairMinCorrelation, base.pairMinCorrelation), 0, 0.99),
    pairEntryZScore,
    pairMaxEntryZScore,
    pairExitZScore,
    pairStopZScore,
    usePairMetaModel: normalizeBoolean(raw.usePairMetaModel, base.usePairMetaModel),
    pairMetaModelPath: String(raw.pairMetaModelPath || base.pairMetaModelPath),
    pairMetaModel: raw.pairMetaModel && typeof raw.pairMetaModel === "object" ? raw.pairMetaModel : base.pairMetaModel,
    pairMetaMinProbability: clamp(asNumber(raw.pairMetaMinProbability, base.pairMetaMinProbability), 0, 1),
    pairMetaMinExpectedR: asNumber(raw.pairMetaMinExpectedR, base.pairMetaMinExpectedR),
    pairMetaFailOpen: normalizeBoolean(raw.pairMetaFailOpen, base.pairMetaFailOpen),
    pairMetaRequirePositiveEV: normalizeBoolean(raw.pairMetaRequirePositiveEV, base.pairMetaRequirePositiveEV),
    pairRequireReversionConfirmation: normalizeBoolean(raw.pairRequireReversionConfirmation, base.pairRequireReversionConfirmation),
    pairReversionConfirmDelta: clamp(asNumber(raw.pairReversionConfirmDelta, base.pairReversionConfirmDelta), 0, 5),
    pairReversionConfirmBars: clamp(Math.round(asNumber(raw.pairReversionConfirmBars, base.pairReversionConfirmBars)), 1, 24),
    pairMaxSpreadVolatility: clamp(asNumber(raw.pairMaxSpreadVolatility, base.pairMaxSpreadVolatility), 0, 100),
    pairMinRecentTradeProfitFactor: clamp(asNumber(raw.pairMinRecentTradeProfitFactor, base.pairMinRecentTradeProfitFactor), 0, 100),
    pairPauseAfterPairLosses: clamp(Math.round(asNumber(raw.pairPauseAfterPairLosses, base.pairPauseAfterPairLosses)), 0, 100),
    pairUseLogSpread: normalizeBoolean(raw.pairUseLogSpread, base.pairUseLogSpread),
    pairHedgeMode: raw.pairHedgeMode === "notional" ? "notional" : "beta",
    pairBetaLookbackBars: clamp(Math.round(asNumber(raw.pairBetaLookbackBars, base.pairBetaLookbackBars)), 20, 500),
    pairRiskPerTradePct: clamp(asNumber(raw.pairRiskPerTradePct, base.pairRiskPerTradePct), 0.05, 5),
    pairMaxGrossExposurePct: clamp(asNumber(raw.pairMaxGrossExposurePct, base.pairMaxGrossExposurePct), 1, 100),
    pairMinHalfLifeBars: clamp(asNumber(raw.pairMinHalfLifeBars, base.pairMinHalfLifeBars), 1, 200),
    pairMaxHalfLifeBars: clamp(asNumber(raw.pairMaxHalfLifeBars, base.pairMaxHalfLifeBars), 2, 500),
    pairCooldownCycles: clamp(Math.round(asNumber(raw.pairCooldownCycles, base.pairCooldownCycles)), 0, 48),
    pairPartialExitEnabled: normalizeBoolean(raw.pairPartialExitEnabled, base.pairPartialExitEnabled),
    pairEarlyExitZScore: clamp(asNumber(raw.pairEarlyExitZScore, base.pairEarlyExitZScore), 0.05, pairEntryZScore),
    pairEarlyExitMinProfitUsd: Math.max(0, asNumber(raw.pairEarlyExitMinProfitUsd, base.pairEarlyExitMinProfitUsd)),
    pairUniverseEnabled: normalizeBoolean(raw.pairUniverseEnabled, base.pairUniverseEnabled),
    pairUniverse,
    allowTrendFallbackWhenNoPair: normalizeBoolean(raw.allowTrendFallbackWhenNoPair, base.allowTrendFallbackWhenNoPair),
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
    maxDailyLossPct: clamp(asNumber(raw.maxDailyLossPct, base.maxDailyLossPct), 0.1, 100),
    maxWeeklyLossPct: clamp(asNumber(raw.maxWeeklyLossPct, base.maxWeeklyLossPct), 0.1, 100),
    maxConsecutiveLosses: clamp(Math.round(asNumber(raw.maxConsecutiveLosses, base.maxConsecutiveLosses)), 1, 100),
    lossStreakCooldownCycles: clamp(Math.round(asNumber(raw.lossStreakCooldownCycles, base.lossStreakCooldownCycles)), 1, 10000),
    lossStreakReducedRiskMultiplier: clamp(asNumber(raw.lossStreakReducedRiskMultiplier, base.lossStreakReducedRiskMultiplier), 0.01, 1),
    autoResumeAfterLossCooldown: normalizeBoolean(raw.autoResumeAfterLossCooldown, base.autoResumeAfterLossCooldown),
    hardStopAfterConsecutiveLosses: clamp(Math.round(asNumber(raw.hardStopAfterConsecutiveLosses, base.hardStopAfterConsecutiveLosses)), Math.max(1, asNumber(raw.maxConsecutiveLosses, base.maxConsecutiveLosses)), 1000),
    pauseAfterDrawdownPct: clamp(asNumber(raw.pauseAfterDrawdownPct, base.pauseAfterDrawdownPct), 0.1, 100),
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

function sanitizePairSeriesByKey(raw = {}, config) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [key, series] of Object.entries(raw)) {
    if (!Array.isArray(series)) continue;
    out[key] = series.slice(-config.maxPricePoints);
  }
  return out;
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
    basePrice: raw.basePrice == null ? null : asNumber(raw.basePrice, null),
    quotePrice: raw.quotePrice == null ? null : asNumber(raw.quotePrice, null),
    fundingRate: raw.fundingRate == null ? null : asNumber(raw.fundingRate, null),
    fundingRateBase: raw.fundingRateBase == null ? null : asNumber(raw.fundingRateBase, null),
    fundingRateQuote: raw.fundingRateQuote == null ? null : asNumber(raw.fundingRateQuote, null),
    nextFundingTs: raw.nextFundingTs == null ? null : asNumber(raw.nextFundingTs, null),
    nextFundingTsBase: raw.nextFundingTsBase == null ? null : asNumber(raw.nextFundingTsBase, null),
    nextFundingTsQuote: raw.nextFundingTsQuote == null ? null : asNumber(raw.nextFundingTsQuote, null),
    priceSeries: Array.isArray(raw.priceSeries) ? raw.priceSeries.slice(-config.maxPricePoints) : [],
    pairSeries: Array.isArray(raw.pairSeries) ? raw.pairSeries.slice(-config.maxPricePoints) : [],
    pairSeriesByKey: sanitizePairSeriesByKey(raw.pairSeriesByKey, config),
    symbolPrices: raw.symbolPrices && typeof raw.symbolPrices === "object" ? raw.symbolPrices : {},
    position: raw.position || null,
    algoOn: normalizeBoolean(raw.algoOn, base.algoOn),
    cycleCount: Math.max(0, Math.round(asNumber(raw.cycleCount, 0))),
    lastTradeCycle: Math.round(asNumber(raw.lastTradeCycle, base.lastTradeCycle)),
    lastTickAt: raw.lastTickAt || null,
    lastMessage: String(raw.lastMessage || base.lastMessage),
    lastPairAnalysis: raw.lastPairAnalysis || null,
    lastPairMeta: raw.lastPairMeta || null,
    pairSetupLog: Array.isArray(raw.pairSetupLog) ? raw.pairSetupLog.slice(-1000) : [],
    pendingPairSignal: raw.pendingPairSignal || null,
    pendingPairSignalByKey: raw.pendingPairSignalByKey && typeof raw.pendingPairSignalByKey === "object" ? raw.pendingPairSignalByKey : {},
    pairRecentStats: raw.pairRecentStats || null,
    pairOpportunities: Array.isArray(raw.pairOpportunities) ? raw.pairOpportunities.slice(0, 10) : [],
    rejectedSignals: raw.rejectedSignals || {},
    riskMode: raw.riskMode === "reduced" ? "reduced" : "normal",
    lossCooldownUntilCycle: raw.lossCooldownUntilCycle == null ? null : Math.max(0, Math.round(asNumber(raw.lossCooldownUntilCycle, 0))),
    reducedRiskRecoveryWins: Math.max(0, Math.round(asNumber(raw.reducedRiskRecoveryWins, 0))),
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
  if (config.strategyMode === "pairs") {
    if (config.pairUniverseEnabled) {
      const symbols = uniqueUniverseSymbols(config);
      const snapshots = await Promise.all(symbols.map((symbol) => fetchSingleMarketSnapshot(config, symbol)));
      const bySymbol = {};
      symbols.forEach((symbol, index) => {
        bySymbol[symbol] = snapshots[index];
      });
      const trend = bySymbol[config.symbol] || {};
      const base = bySymbol[config.baseSymbol] || snapshots[0] || {};
      const quote = bySymbol[config.quoteSymbol] || snapshots[1] || {};
      return {
        price: trend.price == null ? base.price : trend.price,
        basePrice: base.price,
        quotePrice: quote.price,
        fundingRate: base.fundingRate,
        fundingRateBase: base.fundingRate,
        fundingRateQuote: quote.fundingRate,
        nextFundingTs: base.nextFundingTs,
        nextFundingTsBase: base.nextFundingTs,
        nextFundingTsQuote: quote.nextFundingTs,
        symbolPrices: Object.fromEntries(Object.entries(bySymbol).map(([symbol, snapshot]) => [symbol, snapshot.price])),
        symbolFundingRates: Object.fromEntries(Object.entries(bySymbol).map(([symbol, snapshot]) => [symbol, snapshot.fundingRate])),
        symbolNextFundingTs: Object.fromEntries(Object.entries(bySymbol).map(([symbol, snapshot]) => [symbol, snapshot.nextFundingTs]))
      };
    }
    const [base, quote] = await Promise.all([
      fetchSingleMarketSnapshot(config, config.baseSymbol),
      fetchSingleMarketSnapshot(config, config.quoteSymbol)
    ]);
    return {
      price: base.price,
      basePrice: base.price,
      quotePrice: quote.price,
      fundingRate: base.fundingRate,
      fundingRateBase: base.fundingRate,
      fundingRateQuote: quote.fundingRate,
      nextFundingTs: base.nextFundingTs,
      nextFundingTsBase: base.nextFundingTs,
      nextFundingTsQuote: quote.nextFundingTs
    };
  }

  return fetchSingleMarketSnapshot(config, config.symbol);
}

function uniqueUniverseSymbols(config) {
  const symbols = [];
  const seen = new Set();
  for (const [base, quote] of normalizePairUniverse(config.pairUniverse, defaultConfig().pairUniverse)) {
    for (const symbol of [base, quote]) {
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      symbols.push(symbol);
    }
  }
  if (!seen.has(config.baseSymbol)) {
    seen.add(config.baseSymbol);
    symbols.push(config.baseSymbol);
  }
  if (!seen.has(config.quoteSymbol)) {
    seen.add(config.quoteSymbol);
    symbols.push(config.quoteSymbol);
  }
  if (config.allowTrendFallbackWhenNoPair && !seen.has(config.symbol)) symbols.push(config.symbol);
  return symbols;
}

async function fetchSingleMarketSnapshot(config, rawSymbol) {
  const symbol = encodeURIComponent(rawSymbol);

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

function appendPairPoint(state, config, basePrice, quotePrice, ts) {
  const base = asNumber(basePrice);
  const quote = asNumber(quotePrice);
  if (!Number.isFinite(base) || !Number.isFinite(quote) || base <= 0 || quote <= 0) return;
  state.pairSeries = trimPriceSeries(
    [...(state.pairSeries || []), {
      t: ts,
      base,
      quote,
      ratio: quote / base,
      logSpread: Math.log(quote) - Math.log(base)
    }],
    config.maxPricePoints
  );
}

function appendPairUniversePoints(state, config, symbolPrices, ts) {
  if (!symbolPrices || typeof symbolPrices !== "object") return;
  const current = state.pairSeriesByKey && typeof state.pairSeriesByKey === "object" ? state.pairSeriesByKey : {};
  const next = { ...current };
  for (const [baseSymbol, quoteSymbol] of config.pairUniverse) {
    const base = asNumber(symbolPrices[baseSymbol], NaN);
    const quote = asNumber(symbolPrices[quoteSymbol], NaN);
    if (!Number.isFinite(base) || !Number.isFinite(quote) || base <= 0 || quote <= 0) continue;
    const key = pairKey(baseSymbol, quoteSymbol);
    next[key] = trimPriceSeries(
      [...(next[key] || []), {
        t: ts,
        base,
        quote,
        ratio: quote / base,
        logSpread: Math.log(quote) - Math.log(base),
        baseSymbol,
        quoteSymbol
      }],
      config.maxPricePoints
    );
  }
  state.pairSeriesByKey = next;
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

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function covariance(a, b) {
  const length = Math.min(a.length, b.length);
  if (length < 2) return 0;
  const ax = a.slice(-length);
  const bx = b.slice(-length);
  const ma = average(ax);
  const mb = average(bx);
  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    sum += (ax[i] - ma) * (bx[i] - mb);
  }
  return sum / (length - 1);
}

function correlation(a, b) {
  const length = Math.min(a.length, b.length);
  if (length < 3) return 0;
  const ax = a.slice(-length);
  const bx = b.slice(-length);
  const denom = stdev(ax) * stdev(bx);
  return denom > 0 ? covariance(ax, bx) / denom : 0;
}

function estimateBeta(baseReturns, quoteReturns) {
  const variance = covariance(baseReturns, baseReturns);
  if (variance <= 0) return null;
  const beta = covariance(baseReturns, quoteReturns) / variance;
  return Number.isFinite(beta) && beta > 0 ? beta : null;
}

function estimateHalfLife(values) {
  if (values.length < 8) return null;
  const y = [];
  const x = [];
  for (let i = 1; i < values.length; i += 1) {
    y.push(values[i] - values[i - 1]);
    x.push(values[i - 1]);
  }
  const xMean = average(x);
  const yMean = average(y);
  let num = 0;
  let den = 0;
  for (let i = 0; i < x.length; i += 1) {
    num += (x[i] - xMean) * (y[i] - yMean);
    den += (x[i] - xMean) ** 2;
  }
  if (den <= 0) return null;
  const lambda = num / den;
  if (!Number.isFinite(lambda) || lambda >= 0) return null;
  const halfLife = -Math.log(2) / lambda;
  return Number.isFinite(halfLife) && halfLife > 0 ? halfLife : null;
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
  const adaptiveVolatilityPct = maxVolatilityPct + Math.min(trendStrengthPct * 0.9, maxVolatilityPct * 0.9);
  const isTrendStrong = trendStrengthPct >= minTrendStrengthPct;
  const isVolatilityOk = volatilityPct > 0 && volatilityPct <= adaptiveVolatilityPct;
  const pullbackMomentumPct = Math.max(thresholdPct * 0.22, thresholdPct - trendStrengthPct * 0.4);
  const continuationMomentumPct = Math.max(thresholdPct * 0.55, thresholdPct - trendStrengthPct * 0.2);
  const longTrendMomentumPct = thresholdPct * 0.75;
  const shortTrendMomentumPct = -longTrendMomentumPct;
  const continuationTrendStrengthPct = Math.max(minTrendStrengthPct * 1.35, minTrendStrengthPct + 0.02);

  let side = null;
  let reason = "trend";

  if (isTrendStrong && isVolatilityOk) {
    const longPullbackSetup =
      trendSide === "LONG" &&
      momentumPct >= pullbackMomentumPct &&
      longMomentumPct >= longTrendMomentumPct &&
      rangePos <= 0.88 &&
      rsiValue != null &&
      rsiValue >= 40 &&
      rsiValue <= 82;

    const longContinuationSetup =
      trendSide === "LONG" &&
      trendStrengthPct >= continuationTrendStrengthPct &&
      momentumPct >= continuationMomentumPct &&
      longMomentumPct >= thresholdPct * 0.9 &&
      rangePos <= 1 &&
      rsiValue != null &&
      rsiValue >= 46 &&
      rsiValue <= 92;

    const shortPullbackSetup =
      trendSide === "SHORT" &&
      momentumPct <= -pullbackMomentumPct &&
      longMomentumPct <= shortTrendMomentumPct &&
      rangePos >= 0.12 &&
      rsiValue != null &&
      rsiValue <= 60 &&
      rsiValue >= 18;

    const shortContinuationSetup =
      trendSide === "SHORT" &&
      trendStrengthPct >= continuationTrendStrengthPct &&
      momentumPct <= -continuationMomentumPct &&
      longMomentumPct <= -(thresholdPct * 0.9) &&
      rangePos >= 0 &&
      rsiValue != null &&
      rsiValue <= 54 &&
      rsiValue >= 8;

    if (longPullbackSetup || longContinuationSetup) {
      side = "LONG";
      reason = longContinuationSetup && rangePos > 0.45 + pullbackTolerance ? "trend-continuation" : "trend-pullback";
    } else if (shortPullbackSetup || shortContinuationSetup) {
      side = "SHORT";
      reason = shortContinuationSetup && rangePos < 0.55 - pullbackTolerance ? "trend-continuation" : "trend-pullback";
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

function pairReturns(pairSeries, key, bars) {
  const values = pairSeries.map((entry) => asNumber(entry[key]));
  const returns = [];
  for (let i = Math.max(1, values.length - bars + 1); i < values.length; i += 1) {
    const prev = values[i - 1];
    returns.push(prev ? (values[i] - prev) / prev : 0);
  }
  return returns;
}

function rejectPair(reason, extra = {}) {
  return {
    signal: null,
    rejectedReason: reason,
    ...extra
  };
}

function analyzePairMarket(pairSeries, config) {
  const lookback = Math.round(asNumber(config.pairLookbackBars));
  const betaLookback = Math.round(asNumber(config.pairBetaLookbackBars, lookback));
  const minBars = Math.max(lookback, betaLookback, 20);
  if (!Array.isArray(pairSeries) || pairSeries.length < minBars) {
    return rejectPair("warming-up", { requiredBars: minBars, currentBars: Array.isArray(pairSeries) ? pairSeries.length : 0 });
  }

  const window = pairSeries.slice(-lookback);
  const betaWindow = pairSeries.slice(-betaLookback);
  const baseReturns = pairReturns(window, "base", lookback);
  const quoteReturns = pairReturns(window, "quote", lookback);
  const betaBaseReturns = pairReturns(betaWindow, "base", betaLookback);
  const betaQuoteReturns = pairReturns(betaWindow, "quote", betaLookback);
  const corr = correlation(baseReturns, quoteReturns);
  const beta = estimateBeta(betaBaseReturns, betaQuoteReturns) || 1;

  // Spread definition: logSpread = log(quotePrice) - beta * log(basePrice).
  // High z-score means quote is expensive relative to base; low z-score means quote is cheap.
  const spreads = window.map((entry) => {
    const base = asNumber(entry.base);
    const quote = asNumber(entry.quote);
    if (config.pairUseLogSpread) {
      return Math.log(quote) - beta * Math.log(base);
    }
    return quote - beta * base;
  });
  const spread = spreads[spreads.length - 1];
  const mean = average(spreads);
  const sd = stdev(spreads);
  const zScore = sd > 0 ? (spread - mean) / sd : 0;
  const halfLifeBars = estimateHalfLife(spreads);
  const absZ = Math.abs(zScore);
  let signal = null;
  let rejectedReason = null;

  if (corr < asNumber(config.pairMinCorrelation)) {
    rejectedReason = "correlation-below-min";
  } else if (
    halfLifeBars != null &&
    (halfLifeBars < asNumber(config.pairMinHalfLifeBars) || halfLifeBars > asNumber(config.pairMaxHalfLifeBars))
  ) {
    rejectedReason = "half-life-out-of-range";
  } else if (absZ < asNumber(config.pairEntryZScore)) {
    rejectedReason = "zscore-below-entry";
  } else if (absZ > asNumber(config.pairMaxEntryZScore) || absZ > asNumber(config.pairStopZScore)) {
    rejectedReason = "zscore-above-max-entry";
  } else if (zScore > 0) {
    signal = {
      type: "PAIR_SHORT_SPREAD",
      side: "SHORT_SPREAD",
      baseSide: "LONG",
      quoteSide: "SHORT"
    };
  } else {
    signal = {
      type: "PAIR_LONG_SPREAD",
      side: "LONG_SPREAD",
      baseSide: "SHORT",
      quoteSide: "LONG"
    };
  }

  return {
    signal,
    rejectedReason,
    zScore,
    absZScore: absZ,
    correlation: corr,
    beta,
    spread,
    spreadMean: mean,
    spreadStd: sd,
    halfLifeBars,
    baseReturnLast: baseReturns[baseReturns.length - 1] || 0,
    quoteReturnLast: quoteReturns[quoteReturns.length - 1] || 0
  };
}

function finiteNumber(value, fallback = 0) {
  const num = asNumber(value, fallback);
  return Number.isFinite(num) ? num : fallback;
}

function pairReturnForBars(pairSeries, key, barsAgo) {
  const last = getBar(pairSeries || [], 0);
  const prev = getBar(pairSeries || [], barsAgo);
  if (!last || !prev) return 0;
  const prevValue = asNumber(prev[key], 0);
  return prevValue ? (asNumber(last[key], 0) - prevValue) / prevValue : 0;
}

function pairVolatilityForBars(pairSeries, key, bars = 12) {
  return stdev(pairReturns((pairSeries || []).slice(-Math.max(3, bars + 1)), key, bars));
}

function pairZScoreAt(pairSeries, config, endOffset = 0) {
  const lookback = Math.round(asNumber(config.pairLookbackBars));
  const end = endOffset > 0 ? pairSeries.length - endOffset : pairSeries.length;
  if (end < lookback) return 0;
  const window = pairSeries.slice(end - lookback, end);
  const baseReturns = pairReturns(window, "base", lookback);
  const quoteReturns = pairReturns(window, "quote", lookback);
  const beta = estimateBeta(baseReturns, quoteReturns) || 1;
  const spreads = window.map((entry) => {
    const base = asNumber(entry.base);
    const quote = asNumber(entry.quote);
    return config.pairUseLogSpread ? Math.log(quote) - beta * Math.log(base) : quote - beta * base;
  });
  const sd = stdev(spreads);
  return sd > 0 ? (spreads[spreads.length - 1] - average(spreads)) / sd : 0;
}

function buildPairSetupFeatures(state, config, analysis, overridePairSeries = null) {
  const pairSeries = Array.isArray(overridePairSeries) ? overridePairSeries : (Array.isArray(state.pairSeries) ? state.pairSeries : []);
  const zNow = finiteNumber(analysis && analysis.zScore);
  const z1 = pairSeries.length > Math.round(asNumber(config.pairLookbackBars)) ? pairZScoreAt(pairSeries, config, 1) : zNow;
  const z3 = pairSeries.length > Math.round(asNumber(config.pairLookbackBars)) + 3 ? pairZScoreAt(pairSeries, config, 3) : zNow;
  const ts = pairSeries.length ? asNumber(pairSeries[pairSeries.length - 1].t, Date.now()) : Date.now();
  const hourOfDay = new Date(ts).getUTCHours();
  const recent = state.pairRecentStats || {};
  return {
    zScore: finiteNumber(zNow),
    absZScore: finiteNumber(analysis && analysis.absZScore, Math.abs(zNow)),
    zScoreVelocity1: finiteNumber(zNow - z1),
    zScoreVelocity3: finiteNumber(zNow - z3),
    correlation: finiteNumber(analysis && analysis.correlation),
    beta: finiteNumber(analysis && analysis.beta, 1),
    halfLifeBars: finiteNumber(analysis && analysis.halfLifeBars),
    spreadStd: finiteNumber(analysis && analysis.spreadStd),
    baseReturn1: finiteNumber(pairReturnForBars(pairSeries, "base", 1)),
    baseReturn3: finiteNumber(pairReturnForBars(pairSeries, "base", 3)),
    baseReturn6: finiteNumber(pairReturnForBars(pairSeries, "base", 6)),
    quoteReturn1: finiteNumber(pairReturnForBars(pairSeries, "quote", 1)),
    quoteReturn3: finiteNumber(pairReturnForBars(pairSeries, "quote", 3)),
    quoteReturn6: finiteNumber(pairReturnForBars(pairSeries, "quote", 6)),
    baseVolatility: finiteNumber(pairVolatilityForBars(pairSeries, "base")),
    quoteVolatility: finiteNumber(pairVolatilityForBars(pairSeries, "quote")),
    fundingRateBase: finiteNumber(state.fundingRateBase),
    fundingRateQuote: finiteNumber(state.fundingRateQuote),
    hourOfDay: finiteNumber(hourOfDay),
    cycleCount: finiteNumber(state.cycleCount),
    recentWinRate: finiteNumber(recent.winRate),
    recentProfitFactor: finiteNumber(recent.profitFactor),
    recentDrawdownPct: finiteNumber(recent.drawdownPct)
  };
}

function pairRecentTradeStats(history, config, limit = 20) {
  const trades = (history.trades || []).filter((trade) => trade.type === "PAIR").slice(0, limit);
  const wins = trades.filter((trade) => asNumber(trade.netPnl) > 0);
  const losses = trades.filter((trade) => asNumber(trade.netPnl) <= 0);
  const grossProfit = wins.reduce((sum, trade) => sum + asNumber(trade.netPnl), 0);
  const grossLossAbs = Math.abs(losses.reduce((sum, trade) => sum + Math.min(0, asNumber(trade.netPnl)), 0));
  let consecutiveLosses = 0;
  for (const trade of trades) {
    if (asNumber(trade.netPnl) <= 0) consecutiveLosses += 1;
    else break;
  }
  return {
    count: trades.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: grossLossAbs > 0 ? grossProfit / grossLossAbs : (grossProfit > 0 ? 999 : 0),
    consecutiveLosses,
    drawdownPct: finiteNumber((history.trades || [])[0] && config.startBalance ? Math.max(0, (asNumber(config.startBalance) - asNumber((history.trades || [])[0].balanceAfter, config.startBalance)) / Math.max(1, asNumber(config.startBalance)) * 100) : 0)
  };
}

function appendPairSetupLog(state, config, entry) {
  const current = Array.isArray(state.pairSetupLog) ? state.pairSetupLog : [];
  state.pairSetupLog = [entry, ...current].slice(0, 1000);
  return entry;
}

function updatePairSetupLogLabel(state, setupId, patch) {
  if (!setupId || !Array.isArray(state.pairSetupLog)) return;
  state.pairSetupLog = state.pairSetupLog.map((entry) => (
    entry.id === setupId ? { ...entry, ...patch } : entry
  )).slice(0, 1000);
}

function loadPairMetaModel(config) {
  if (config.pairMetaModel && typeof config.pairMetaModel === "object") return config.pairMetaModel;
  if (!config.pairMetaModelPath) return null;
  try {
    const fs = require("fs");
    const modelText = fs.readFileSync(String(config.pairMetaModelPath), "utf8");
    return JSON.parse(modelText);
  } catch (error) {
    return null;
  }
}

function sigmoid(value) {
  if (value >= 35) return 1;
  if (value <= -35) return 0;
  return 1 / (1 + Math.exp(-value));
}

function scorePairSetupWithModel(model, features) {
  if (!model || model.type !== "logistic_regression" || !Array.isArray(model.features)) return null;
  let z = asNumber(model.bias, 0);
  for (const name of model.features) {
    const raw = finiteNumber(features[name]);
    const mu = finiteNumber(model.mu && model.mu[name]);
    const sigma = Math.max(1e-9, finiteNumber(model.sigma && model.sigma[name], 1));
    const weight = finiteNumber(model.weights && model.weights[name]);
    z += ((raw - mu) / sigma) * weight;
  }
  return sigmoid(z);
}

function pairExpectedValue(probability, model, state) {
  const metrics = state.metrics || {};
  const validation = model && model.validation ? model.validation : {};
  const avgWin = Math.max(0, finiteNumber(model && model.avgWin, finiteNumber(validation.avgWin, finiteNumber(metrics.avgWin))));
  const avgLoss = Math.abs(finiteNumber(model && model.avgLoss, finiteNumber(validation.avgLoss, finiteNumber(metrics.avgLoss))));
  return probability * avgWin - (1 - probability) * avgLoss;
}

function pairSetupCandidate(state, config, analysis, features, nowTs) {
  const signal = analysis.signal || {};
  return {
    id: `${nowTs}-${state.cycleCount}-${analysis.pairKey || signal.side || "PAIR"}`,
    timestamp: nowTs,
    cycle: state.cycleCount,
    signalType: signal.type,
    side: signal.side,
    pairKey: analysis.pairKey || pairKey(config.baseSymbol, config.quoteSymbol),
    baseSymbol: analysis.baseSymbol || config.baseSymbol,
    quoteSymbol: analysis.quoteSymbol || config.quoteSymbol,
    zScore: analysis.zScore,
    features,
    accepted: false,
    rejectReason: null,
    finalLabel: null
  };
}

function checkPairConfirmation(state, config, analysis) {
  const key = analysis.pairKey || null;
  const pendingStore = key
    ? (state.pendingPairSignalByKey = state.pendingPairSignalByKey && typeof state.pendingPairSignalByKey === "object" ? state.pendingPairSignalByKey : {})
    : null;
  const getPending = () => (key ? pendingStore[key] : state.pendingPairSignal);
  const setPending = (value) => {
    if (key) {
      if (value) pendingStore[key] = value;
      else delete pendingStore[key];
      state.pendingPairSignal = value;
    } else {
      state.pendingPairSignal = value;
    }
  };
  if (!config.pairRequireReversionConfirmation) {
    setPending(null);
    return { ok: true };
  }
  const signal = analysis.signal;
  const currentCycle = asNumber(state.cycleCount);
  const currentZ = asNumber(analysis.zScore);
  const pending = getPending();
  if (!pending || pending.side !== signal.side || currentCycle > asNumber(pending.expiresCycle)) {
    setPending({
      pairKey: key,
      side: signal.side,
      firstZScore: currentZ,
      createdCycle: currentCycle,
      expiresCycle: currentCycle + asNumber(config.pairReversionConfirmBars)
    });
    return { ok: false, reason: "reversion-not-confirmed" };
  }

  const delta = asNumber(config.pairReversionConfirmDelta);
  const firstZ = asNumber(pending.firstZScore);
  const confirmed = signal.side === "LONG_SPREAD"
    ? currentZ >= firstZ + delta
    : currentZ <= firstZ - delta;
  if (!confirmed) return { ok: false, reason: "reversion-not-confirmed" };
  setPending(null);
  return { ok: true };
}

function pairRegimeRejectReason(state, config, analysis) {
  const stats = state.pairRecentStats || {};
  const maxSpreadVol = asNumber(config.pairMaxSpreadVolatility);
  if (maxSpreadVol > 0 && asNumber(analysis.spreadStd) > maxSpreadVol) return "spread-volatility-too-high";
  const minProfitFactor = asNumber(config.pairMinRecentTradeProfitFactor);
  if (minProfitFactor > 0 && asNumber(stats.count) > 0 && asNumber(stats.profitFactor) < minProfitFactor) return "pair-recent-profit-factor-low";
  const pauseLosses = asNumber(config.pairPauseAfterPairLosses);
  if (pauseLosses > 0 && asNumber(stats.consecutiveLosses) >= pauseLosses) return "pair-loss-pause";
  return null;
}

function pairMetaReject(state, config, features) {
  if (!config.usePairMetaModel) return { ok: true, probability: null, expectedValue: null };
  const model = loadPairMetaModel(config);
  if (!model) {
    return config.pairMetaFailOpen
      ? { ok: true, probability: null, expectedValue: null, reason: "pair-meta-model-missing" }
      : { ok: false, probability: null, expectedValue: null, reason: "pair-meta-model-missing" };
  }
  // This model is a trade filter, not an oracle.
  const probability = scorePairSetupWithModel(model, features);
  if (probability == null) return { ok: false, probability: null, expectedValue: null, reason: "pair-meta-model-invalid" };
  const expectedValue = pairExpectedValue(probability, model, state);
  const minProbability = asNumber(config.pairMetaMinProbability);
  if (probability < minProbability) {
    return { ok: false, probability, expectedValue, reason: "pair-meta-probability-low" };
  }
  if (config.pairMetaRequirePositiveEV && expectedValue <= asNumber(config.pairMetaMinExpectedR)) {
    return { ok: false, probability, expectedValue, reason: "pair-meta-ev-low" };
  }
  return { ok: true, probability, expectedValue };
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
    setupWinProbability: Math.max(pLong, pShort),
    expectedR: (Math.max(pLong, pShort) - 0.5) * 2,
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

function riskModeMultiplier(config, state) {
  return state && state.riskMode === "reduced" ? asNumber(config.lossStreakReducedRiskMultiplier, 1) : 1;
}

function effectiveRiskPerTradePct(config, state) {
  return asNumber(config.riskPerTradePct) * riskModeMultiplier(config, state);
}

function effectivePairRiskPerTradePct(config, state) {
  return asNumber(config.pairRiskPerTradePct, config.riskPerTradePct) * riskModeMultiplier(config, state);
}

function estimateFundingPnl(position, fundingRate, elapsedMs) {
  if (!position || !Number.isFinite(fundingRate) || elapsedMs <= 0) return 0;
  const sideFactor = position.side === "LONG" ? -1 : 1;
  const scaledRate = fundingRate * (elapsedMs / EIGHT_HOURS_MS);
  return sideFactor * asNumber(position.notional) * scaledRate;
}

function estimateLegFundingPnl(side, notional, fundingRate, elapsedMs) {
  if (!Number.isFinite(fundingRate) || elapsedMs <= 0) return 0;
  const sideFactor = side === "LONG" ? -1 : 1;
  return sideFactor * asNumber(notional) * fundingRate * (elapsedMs / EIGHT_HOURS_MS);
}

function applyFundingAccrual(state, config, nowTs) {
  if (config.source !== "binance_futures" || !state.position) return 0;
  const position = state.position;
  const lastTs = asNumber(position.lastFundingAccrualTs, nowTs);
  const elapsedMs = Math.max(0, nowTs - lastTs);
  if (position.type === "PAIR") {
    const baseFunding = estimateLegFundingPnl(position.baseSide, position.baseNotional, asNumber(state.fundingRateBase, 0), elapsedMs);
    const quoteFunding = estimateLegFundingPnl(position.quoteSide, position.quoteNotional, asNumber(state.fundingRateQuote, 0), elapsedMs);
    const delta = baseFunding + quoteFunding;
    position.fundingAccrued = asNumber(position.fundingAccrued, 0) + delta;
    position.lastFundingAccrualTs = nowTs;
    return delta;
  }
  const delta = estimateFundingPnl(position, asNumber(state.fundingRate, 0), elapsedMs);
  position.fundingAccrued = asNumber(position.fundingAccrued, 0) + delta;
  position.lastFundingAccrualTs = nowTs;
  return delta;
}

function computeRiskSizing(config, state, entryPrice) {
  const balance = asNumber(state.balance);
  const leverage = asNumber(config.leverage);
  const stopLossPct = asNumber(config.stopLossPct) / 100;
  const riskBudget = balance * (effectiveRiskPerTradePct(config, state) / 100);
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

function computePairRiskSizing(config, state, analysis) {
  const balance = asNumber(state.balance);
  const leverage = asNumber(config.leverage);
  const basePrice = asNumber(state.basePrice);
  const quotePrice = asNumber(state.quotePrice);
  const riskBudget = balance * (effectivePairRiskPerTradePct(config, state) / 100);
  const grossCap = balance * (asNumber(config.pairMaxGrossExposurePct) / 100) * leverage;
  const zDistance = Math.max(0.1, asNumber(config.pairStopZScore) - Math.abs(asNumber(analysis.zScore)));
  const riskFraction = Math.min(0.25, zDistance * 0.04 + (feeRate(config) + slipRate(config)) * 4);
  const grossByRisk = riskBudget / Math.max(riskFraction, 0.005);
  const grossExposure = Math.max(0, Math.min(grossByRisk, grossCap));
  const beta = config.pairHedgeMode === "beta" ? Math.max(0.2, Math.min(5, asNumber(analysis.beta, 1))) : 1;

  let baseNotional = grossExposure / (1 + beta);
  let quoteNotional = grossExposure - baseNotional;
  if (config.pairHedgeMode === "notional") {
    baseNotional = grossExposure / 2;
    quoteNotional = grossExposure / 2;
  }

  const baseEntry = applySlippage(basePrice, analysis.signal.baseSide, true, config);
  const quoteEntry = applySlippage(quotePrice, analysis.signal.quoteSide, true, config);
  const baseQty = baseEntry > 0 ? baseNotional / baseEntry : 0;
  const quoteQty = quoteEntry > 0 ? quoteNotional / quoteEntry : 0;
  const margin = grossExposure / leverage;
  const openFee = grossExposure * feeRate(config);

  return {
    baseEntry,
    quoteEntry,
    baseQty,
    quoteQty,
    baseNotional,
    quoteNotional,
    grossExposure,
    margin,
    openFee,
    riskBudget
  };
}

function incrementReject(state, reason) {
  const key = reason || "unknown";
  state.rejectedSignals = {
    ...(state.rejectedSignals || {}),
    [key]: asNumber((state.rejectedSignals || {})[key], 0) + 1
  };
}

function recentLossStats(history, nowTs) {
  const trades = history.trades || [];
  const dayAgo = nowTs - 24 * 60 * 60 * 1000;
  const weekAgo = nowTs - 7 * 24 * 60 * 60 * 1000;
  let dailyLoss = 0;
  let weeklyLoss = 0;
  let consecutiveLosses = 0;
  for (const trade of trades) {
    const ts = asNumber(trade.closedAt || trade.ts, 0);
    const pnl = asNumber(trade.netPnl, 0);
    if (ts >= dayAgo && pnl < 0) dailyLoss += Math.abs(pnl);
    if (ts >= weekAgo && pnl < 0) weeklyLoss += Math.abs(pnl);
  }
  for (const trade of trades) {
    if (asNumber(trade.netPnl, 0) <= 0) consecutiveLosses += 1;
    else break;
  }
  return { dailyLoss, weeklyLoss, consecutiveLosses };
}

function entryKillSwitchReason(state, config, history, nowTs) {
  const startBalance = Math.max(1, asNumber(config.startBalance, 10000));
  const stats = recentLossStats(history, nowTs);
  const dailyLossPct = (stats.dailyLoss / startBalance) * 100;
  const weeklyLossPct = (stats.weeklyLoss / startBalance) * 100;
  const drawdownPct = asNumber(state.metrics && state.metrics.maxDrawdownPct, 0);
  if (dailyLossPct >= asNumber(config.maxDailyLossPct)) return `daily loss limit hit (${dailyLossPct.toFixed(2)}%)`;
  if (weeklyLossPct >= asNumber(config.maxWeeklyLossPct)) return `weekly loss limit hit (${weeklyLossPct.toFixed(2)}%)`;
  if (stats.consecutiveLosses >= asNumber(config.hardStopAfterConsecutiveLosses)) return "Hard stop: too many consecutive losses";
  if (stats.consecutiveLosses >= asNumber(config.maxConsecutiveLosses)) {
    if (state.riskMode !== "reduced" || state.lossCooldownUntilCycle == null || state.cycleCount <= asNumber(state.lossCooldownUntilCycle)) {
      state.riskMode = "reduced";
      state.reducedRiskRecoveryWins = 0;
      if (state.lossCooldownUntilCycle == null || state.cycleCount >= asNumber(state.lossCooldownUntilCycle)) {
        state.lossCooldownUntilCycle = state.cycleCount + asNumber(config.lossStreakCooldownCycles);
      }
      return `Loss streak cooldown active until cycle ${state.lossCooldownUntilCycle}`;
    }
    if (!config.autoResumeAfterLossCooldown) return `Loss streak cooldown active until cycle ${state.lossCooldownUntilCycle}`;
  }
  if (drawdownPct >= asNumber(config.pauseAfterDrawdownPct)) return `drawdown pause hit (${drawdownPct.toFixed(2)}%)`;
  return null;
}

function updateRiskModeAfterClosedTrade(state, config, netPnl) {
  if (state.riskMode !== "reduced") return;
  if (asNumber(netPnl) > 0) {
    state.reducedRiskRecoveryWins = asNumber(state.reducedRiskRecoveryWins, 0) + 1;
    if (state.reducedRiskRecoveryWins >= 2) {
      state.riskMode = "normal";
      state.lossCooldownUntilCycle = null;
      state.reducedRiskRecoveryWins = 0;
      state.lastMessage = "Reduced risk recovery complete";
    }
  } else {
    state.reducedRiskRecoveryWins = 0;
    state.lossCooldownUntilCycle = state.cycleCount + asNumber(config.lossStreakCooldownCycles);
  }
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
  state.lastMessage = state.riskMode === "reduced"
    ? `Opened ${side} (${reason}) - Reduced risk mode active`
    : `Opened ${side} (${reason})`;
  return true;
}

function openPairPosition(state, config, analysis, reason, nowTs, setup = null) {
  if (!state.onboarded || state.position || !analysis || !analysis.signal) return false;
  if (!Number.isFinite(asNumber(state.basePrice, NaN)) || !Number.isFinite(asNumber(state.quotePrice, NaN))) return false;
  const sizing = computePairRiskSizing(config, state, analysis);

  if (
    sizing.margin < asNumber(config.minMarginUsd) ||
    sizing.baseQty <= 0 ||
    sizing.quoteQty <= 0 ||
    state.balance < sizing.margin + sizing.openFee
  ) {
    state.lastMessage = "Insufficient demo balance for pair entry";
    return false;
  }

  state.balance -= sizing.margin + sizing.openFee;
  state.position = {
    type: "PAIR",
    side: analysis.signal.side,
    baseSymbol: analysis.baseSymbol || config.baseSymbol,
    quoteSymbol: analysis.quoteSymbol || config.quoteSymbol,
    pairKey: analysis.pairKey || pairKey(analysis.baseSymbol || config.baseSymbol, analysis.quoteSymbol || config.quoteSymbol),
    baseSide: analysis.signal.baseSide,
    quoteSide: analysis.signal.quoteSide,
    baseEntry: sizing.baseEntry,
    quoteEntry: sizing.quoteEntry,
    baseQty: sizing.baseQty,
    quoteQty: sizing.quoteQty,
    baseNotional: sizing.baseNotional,
    quoteNotional: sizing.quoteNotional,
    grossExposure: sizing.grossExposure,
    margin: sizing.margin,
    leverage: asNumber(config.leverage),
    openFee: sizing.openFee,
    entryZScore: analysis.zScore,
    currentZScore: analysis.zScore,
    stopZScore: asNumber(config.pairStopZScore),
    exitZScore: asNumber(config.pairExitZScore),
    openedAt: nowTs,
    openedCycle: state.cycleCount,
    reason,
    riskBudget: sizing.riskBudget,
    fundingAccrued: 0,
    lastFundingAccrualTs: nowTs,
    bestZScore: analysis.zScore,
    worstZScore: analysis.zScore,
    correlationBreakCycles: 0,
    beta: analysis.beta,
    setupLogId: setup && setup.id,
    setupFeatures: setup && setup.features ? setup.features : null,
    setupScoreAtEntry: setup ? setup.setupScoreAtEntry : null,
    setupExpectedValueAtEntry: setup ? setup.setupExpectedValueAtEntry : null
  };
  if (setup && setup.id) {
    updatePairSetupLogLabel(state, setup.id, {
      accepted: true,
      rejectReason: null,
      openedAt: nowTs,
      setupScoreAtEntry: setup.setupScoreAtEntry,
      setupExpectedValueAtEntry: setup.setupExpectedValueAtEntry
    });
  }
  state.lastTradeCycle = state.cycleCount;
  state.lastMessage = state.riskMode === "reduced"
    ? `Opened ${analysis.signal.side} (${reason}) - Reduced risk mode active`
    : `Opened ${analysis.signal.side} (${reason})`;
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

function legPnl(side, qty, entry, exit) {
  const direction = side === "LONG" ? 1 : -1;
  return direction * asNumber(qty) * (asNumber(exit) - asNumber(entry));
}

function closePairPosition(state, config, history, note, nowTs, analysis = null) {
  if (!state.position || state.position.type !== "PAIR") return false;
  const position = state.position;
  const baseExit = applySlippage(asNumber(state.basePrice), position.baseSide, false, config);
  const quoteExit = applySlippage(asNumber(state.quotePrice), position.quoteSide, false, config);
  const basePnl = legPnl(position.baseSide, position.baseQty, position.baseEntry, baseExit);
  const quotePnl = legPnl(position.quoteSide, position.quoteQty, position.quoteEntry, quoteExit);
  const grossPnl = basePnl + quotePnl;
  const closeFee = (asNumber(position.baseNotional) + asNumber(position.quoteNotional)) * feeRate(config);
  const fundingPnl = asNumber(position.fundingAccrued, 0);
  const netPnl = grossPnl + fundingPnl - closeFee - asNumber(position.openFee);
  const setupLabel = netPnl > 0 ? 1 : 0;
  const setupReturnR = netPnl / Math.max(1e-9, asNumber(position.riskBudget, 0));
  const holdingCycles = state.cycleCount - asNumber(position.openedCycle, state.cycleCount);

  state.balance += asNumber(position.margin) + grossPnl + fundingPnl - closeFee;
  const closedTrade = {
    ts: nowTs,
    type: "PAIR",
    source: config.source,
    side: position.side,
    pairKey: position.pairKey || pairKey(position.baseSymbol, position.quoteSymbol),
    baseSymbol: position.baseSymbol,
    quoteSymbol: position.quoteSymbol,
    baseSide: position.baseSide,
    quoteSide: position.quoteSide,
    baseEntry: position.baseEntry,
    quoteEntry: position.quoteEntry,
    baseExit,
    quoteExit,
    baseQty: position.baseQty,
    quoteQty: position.quoteQty,
    grossExposure: position.grossExposure,
    grossPnl,
    basePnl,
    quotePnl,
    fundingPnl,
    fees: asNumber(position.openFee) + closeFee,
    netPnl,
    entryZScore: position.entryZScore,
    exitZScore: analysis ? analysis.zScore : position.currentZScore,
    correlation: analysis ? analysis.correlation : null,
    reason: note,
    exitReason: note,
    holdingCycles,
    riskBudget: position.riskBudget,
    setupFeatures: position.setupFeatures || null,
    setupScoreAtEntry: position.setupScoreAtEntry == null ? null : position.setupScoreAtEntry,
    setupExpectedValueAtEntry: position.setupExpectedValueAtEntry == null ? null : position.setupExpectedValueAtEntry,
    setupLabel,
    setupReturnR,
    balanceAfter: state.balance,
    openedAt: position.openedAt,
    closedAt: nowTs
  };
  appendClosedTrade(history, config, closedTrade);
  updateRiskModeAfterClosedTrade(state, config, netPnl);
  updatePairSetupLogLabel(state, position.setupLogId, {
    accepted: true,
    finalLabel: setupLabel,
    setupReturnR,
    netPnl,
    exitReason: note,
    closedAt: nowTs
  });
  state.position = null;
  state.lastTradeCycle = state.cycleCount;
  state.lastMessage = `Closed pair position (${note})`;
  calculateMetrics(history, config, state);
  return true;
}

function closePosition(state, config, history, exitRaw, note, nowTs) {
  if (!state.position) return false;
  const position = state.position;
  if (position.type === "PAIR") {
    syncPairPositionPrices(state, position);
    return closePairPosition(state, config, history, note, nowTs, analyzePairMarket(pairSeriesForPosition(state, position), config));
  }
  const exit = applySlippage(asNumber(exitRaw), position.side, false, config);
  const direction = position.side === "LONG" ? 1 : -1;
  const pricePnl = direction * asNumber(position.qty) * (exit - asNumber(position.entry));
  const closeFee = asNumber(position.notional) * feeRate(config);
  const fundingPnl = asNumber(position.fundingAccrued, 0);
  const netPnl = pricePnl + fundingPnl - closeFee;

  state.balance += asNumber(position.margin) + netPnl;
  const realizedNetPnl = netPnl - asNumber(position.openFee);
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
    netPnl: realizedNetPnl,
    reason: note,
    balanceAfter: state.balance,
    openedAt: position.openedAt,
    closedAt: nowTs
  });
  updateRiskModeAfterClosedTrade(state, config, realizedNetPnl);
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
  const realizedNetPnl = -asNumber(position.margin) + fundingPnl - asNumber(position.openFee);
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
    netPnl: realizedNetPnl,
    reason: `LIQUIDATED (${reason})`,
    balanceAfter: state.balance,
    openedAt: position.openedAt,
    closedAt: nowTs
  });
  updateRiskModeAfterClosedTrade(state, config, realizedNetPnl);
  state.position = null;
  state.lastTradeCycle = state.cycleCount;
  state.lastMessage = `Liquidated (${reason})`;
  calculateMetrics(history, config, state);
  return true;
}

function maybeManagePairPosition(state, config, history, nowTs) {
  const position = state.position;
  syncPairPositionPrices(state, position);
  const activeSeries = pairSeriesForPosition(state, position);
  const analysis = analyzePairMarket(activeSeries, config);
  if (analysis) {
    analysis.pairKey = position.pairKey || pairKey(position.baseSymbol, position.quoteSymbol);
    analysis.baseSymbol = position.baseSymbol;
    analysis.quoteSymbol = position.quoteSymbol;
  }
  state.lastPairAnalysis = analysis;
  if (!analysis || !Number.isFinite(asNumber(analysis.zScore, NaN))) return;

  position.currentZScore = analysis.zScore;
  position.bestZScore = position.side === "SHORT_SPREAD"
    ? Math.min(asNumber(position.bestZScore, position.entryZScore), analysis.zScore)
    : Math.max(asNumber(position.bestZScore, position.entryZScore), analysis.zScore);
  position.worstZScore = position.side === "SHORT_SPREAD"
    ? Math.max(asNumber(position.worstZScore, position.entryZScore), analysis.zScore)
    : Math.min(asNumber(position.worstZScore, position.entryZScore), analysis.zScore);

  if (analysis.correlation < asNumber(config.pairMinCorrelation)) {
    position.correlationBreakCycles = asNumber(position.correlationBreakCycles, 0) + 1;
  } else {
    position.correlationBreakCycles = 0;
  }

  const absZ = Math.abs(asNumber(analysis.zScore));
  const movedAgainstShort = position.side === "SHORT_SPREAD" && analysis.zScore > asNumber(position.entryZScore);
  const movedAgainstLong = position.side === "LONG_SPREAD" && analysis.zScore < asNumber(position.entryZScore);
  const holdingCycles = state.cycleCount - asNumber(position.openedCycle, state.cycleCount);
  const unrealized = calculatePairUnrealizedPnl(state, config);

  if (absZ <= asNumber(config.pairExitZScore)) {
    closePairPosition(state, config, history, "mean-reversion-exit", nowTs, analysis);
    return;
  }
  if (
    config.pairPartialExitEnabled &&
    absZ <= asNumber(config.pairEarlyExitZScore) &&
    unrealized > asNumber(config.pairEarlyExitMinProfitUsd)
  ) {
    closePairPosition(state, config, history, "early-profit-exit", nowTs, analysis);
    return;
  }
  if (absZ >= asNumber(config.pairStopZScore) && (movedAgainstShort || movedAgainstLong)) {
    closePairPosition(state, config, history, "pair-zscore-stop", nowTs, analysis);
    return;
  }
  if (asNumber(position.correlationBreakCycles, 0) >= 3) {
    closePairPosition(state, config, history, "correlation-break", nowTs, analysis);
    return;
  }
  if (holdingCycles >= asNumber(config.maxHoldCycles)) {
    closePairPosition(state, config, history, "time-exit", nowTs, analysis);
    return;
  }
  if (unrealized <= -Math.max(asNumber(position.riskBudget), 1)) {
    closePairPosition(state, config, history, "risk-budget-stop", nowTs, analysis);
  }
}

function pairSeriesForPosition(state, position) {
  const key = position && (position.pairKey || pairKey(position.baseSymbol, position.quoteSymbol));
  if (key && state.pairSeriesByKey && Array.isArray(state.pairSeriesByKey[key])) return state.pairSeriesByKey[key];
  return state.pairSeries || [];
}

function syncPairPositionPrices(state, position) {
  if (!position || !state.symbolPrices) return;
  const basePrice = asNumber(state.symbolPrices[position.baseSymbol], NaN);
  const quotePrice = asNumber(state.symbolPrices[position.quoteSymbol], NaN);
  if (Number.isFinite(basePrice) && basePrice > 0) state.basePrice = basePrice;
  if (Number.isFinite(quotePrice) && quotePrice > 0) state.quotePrice = quotePrice;
}

function calculatePairUnrealizedPnl(state, config) {
  if (!state.position || state.position.type !== "PAIR") return 0;
  const position = state.position;
  const baseExit = applySlippage(asNumber(state.basePrice), position.baseSide, false, config);
  const quoteExit = applySlippage(asNumber(state.quotePrice), position.quoteSide, false, config);
  const basePnl = legPnl(position.baseSide, position.baseQty, position.baseEntry, baseExit);
  const quotePnl = legPnl(position.quoteSide, position.quoteQty, position.quoteEntry, quoteExit);
  const closeFee = (asNumber(position.baseNotional) + asNumber(position.quoteNotional)) * feeRate(config);
  return basePnl + quotePnl + asNumber(position.fundingAccrued, 0) - closeFee - asNumber(position.openFee);
}

function maybeManageOpenPosition(state, config, history, nowTs) {
  if (!state.position) return;
  if (state.position.type === "PAIR") {
    maybeManagePairPosition(state, config, history, nowTs);
    return;
  }
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

function maybeOpenTrendTrade(state, config, history, nowTs, reasonPrefix = null) {
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
  const reason = reasonPrefix ? `${reasonPrefix}-${baseReason}` : baseReason;
  return openPosition(state, config, side, config.useMlFilter ? `${reason}+ml` : reason, nowTs);
}

function maybeOpenTrade(state, config, history, nowTs) {
  if (!state.algoOn || !state.onboarded || state.position) return false;
  const killReason = entryKillSwitchReason(state, config, history, nowTs);
  if (killReason) {
    state.lastMessage = killReason.startsWith("Hard stop:") ? killReason : `No new entries: ${killReason}`;
    return false;
  }
  if (config.strategyMode === "pairs") return maybeOpenPairTrade(state, config, history, nowTs);
  return maybeOpenTrendTrade(state, config, history, nowTs);
}

function rejectPairSetupCandidate(state, config, candidate, reason, extra = {}) {
  incrementReject(state, reason);
  appendPairSetupLog(state, config, {
    ...candidate,
    ...extra,
    accepted: false,
    rejectReason: reason
  });
  return false;
}

function recentPairLossPenalty(history, pairKeyValue) {
  const recent = (history.trades || [])
    .filter((trade) => trade.type === "PAIR" && (trade.pairKey || pairKey(trade.baseSymbol, trade.quoteSymbol)) === pairKeyValue)
    .slice(0, 5);
  let losses = 0;
  for (const trade of recent) {
    if (asNumber(trade.netPnl) <= 0) losses += 1;
    else break;
  }
  return losses * 0.35;
}

function scorePairOpportunity(analysis, meta, history) {
  const spreadStdPenalty = Math.min(2, asNumber(analysis.spreadStd) * 10);
  const metaModelBonus = meta && meta.probability != null ? (asNumber(meta.probability) - 0.5) * 2 : 0;
  return (
    asNumber(analysis.absZScore) * 1.5 +
    Math.max(0, asNumber(analysis.correlation)) * 2 -
    spreadStdPenalty +
    metaModelBonus -
    recentPairLossPenalty(history, analysis.pairKey)
  );
}

function pairOpportunitySummary(analysis, score = null) {
  return {
    pairKey: analysis.pairKey,
    baseSymbol: analysis.baseSymbol,
    quoteSymbol: analysis.quoteSymbol,
    zScore: analysis.zScore,
    correlation: analysis.correlation,
    beta: analysis.beta,
    halfLifeBars: analysis.halfLifeBars,
    rejectedReason: analysis.rejectedReason || null,
    score
  };
}

function withPairContext(analysis, baseSymbol, quoteSymbol) {
  return {
    ...analysis,
    pairKey: pairKey(baseSymbol, quoteSymbol),
    baseSymbol,
    quoteSymbol
  };
}

function maybeOpenPairUniverseTrade(state, config, history, nowTs) {
  const opportunities = [];
  const valid = [];
  state.pairRecentStats = pairRecentTradeStats(history, config);

  for (const [baseSymbol, quoteSymbol] of config.pairUniverse) {
    const key = pairKey(baseSymbol, quoteSymbol);
    const pairSeries = state.pairSeriesByKey && state.pairSeriesByKey[key] ? state.pairSeriesByKey[key] : [];
    let analysis = withPairContext(analyzePairMarket(pairSeries, config), baseSymbol, quoteSymbol);

    if (!analysis.signal) {
      incrementReject(state, analysis.rejectedReason);
      opportunities.push(pairOpportunitySummary(analysis, null));
      continue;
    }

    const features = buildPairSetupFeatures(state, config, analysis, pairSeries);
    const candidate = pairSetupCandidate(state, config, analysis, features, nowTs);
    const regimeReason = pairRegimeRejectReason(state, config, analysis);
    if (regimeReason) {
      incrementReject(state, regimeReason);
      opportunities.push(pairOpportunitySummary({ ...analysis, rejectedReason: regimeReason }, null));
      continue;
    }

    const confirmation = checkPairConfirmation(state, config, analysis);
    if (!confirmation.ok) {
      incrementReject(state, confirmation.reason);
      opportunities.push(pairOpportunitySummary({ ...analysis, rejectedReason: confirmation.reason }, null));
      continue;
    }

    const meta = pairMetaReject(state, config, features);
    if (!meta.ok) {
      incrementReject(state, meta.reason || "pair-meta-model");
      opportunities.push(pairOpportunitySummary({ ...analysis, rejectedReason: meta.reason || "pair-meta-model" }, null));
      continue;
    }

    if (config.useMlFilter) {
      const signal = state.mlSignal;
      const hasEnoughSamples = signal && signal.setupWinProbability != null;
      const enoughConf = hasEnoughSamples && asNumber(signal.setupWinProbability) >= asNumber(config.mlMinConfPct) / 100;
      if (hasEnoughSamples && !enoughConf) {
        incrementReject(state, "ml-filter");
        opportunities.push(pairOpportunitySummary({ ...analysis, rejectedReason: "ml-filter" }, null));
        continue;
      }
    }

    const score = scorePairOpportunity(analysis, meta, history);
    const setup = {
      ...candidate,
      accepted: false,
      setupScoreAtEntry: meta.probability,
      setupExpectedValueAtEntry: meta.expectedValue
    };
    valid.push({ analysis, score, setup, meta });
    opportunities.push(pairOpportunitySummary(analysis, score));
  }

  opportunities.sort((a, b) => asNumber(b.score, -999) - asNumber(a.score, -999));
  state.pairOpportunities = opportunities.slice(0, 10);
  state.lastPairAnalysis = opportunities[0] || null;

  if (!valid.length) {
    state.lastMessage = "No pair signal: no valid universe candidate";
    if (config.allowTrendFallbackWhenNoPair) {
      return maybeOpenTrendTrade(state, config, history, nowTs, "trend-fallback");
    }
    return false;
  }

  valid.sort((a, b) => b.score - a.score);
  const selected = valid[0];
  const basePrice = asNumber(state.symbolPrices && state.symbolPrices[selected.analysis.baseSymbol], NaN);
  const quotePrice = asNumber(state.symbolPrices && state.symbolPrices[selected.analysis.quoteSymbol], NaN);
  if (Number.isFinite(basePrice)) state.basePrice = basePrice;
  if (Number.isFinite(quotePrice)) state.quotePrice = quotePrice;
  state.lastPairAnalysis = selected.analysis;
  state.lastPairMeta = {
    probability: selected.meta.probability,
    expectedValue: selected.meta.expectedValue,
    rejectedReason: null
  };
  const setup = appendPairSetupLog(state, config, selected.setup);
  const opened = openPairPosition(state, config, selected.analysis, selected.analysis.signal.type, nowTs, setup);
  if (!opened) {
    updatePairSetupLogLabel(state, setup.id, { accepted: false, rejectReason: "entry-not-opened" });
  }
  return opened;
}

function maybeOpenPairTrade(state, config, history, nowTs) {
  if (state.cycleCount - asNumber(state.lastTradeCycle, -999999) <= asNumber(config.pairCooldownCycles)) return false;
  if (config.pairUniverseEnabled) return maybeOpenPairUniverseTrade(state, config, history, nowTs);
  state.pairRecentStats = pairRecentTradeStats(history, config);
  const analysis = analyzePairMarket(state.pairSeries, config);
  state.lastPairAnalysis = analysis;
  state.pairOpportunities = [pairOpportunitySummary(withPairContext(analysis, config.baseSymbol, config.quoteSymbol), null)];
  if (!analysis.signal) {
    incrementReject(state, analysis.rejectedReason);
    if (analysis.rejectedReason !== "zscore-below-entry") state.pendingPairSignal = null;
    if (analysis.rejectedReason === "warming-up") {
      state.lastMessage = `Warming up pair history (${analysis.currentBars}/${analysis.requiredBars})`;
    } else {
      state.lastMessage = `No pair signal: ${analysis.rejectedReason || "none"}`;
    }
    return false;
  }

  const features = buildPairSetupFeatures(state, config, analysis);
  const candidate = pairSetupCandidate(state, config, analysis, features, nowTs);

  const regimeReason = pairRegimeRejectReason(state, config, analysis);
  if (regimeReason) {
    state.pendingPairSignal = null;
    state.lastMessage = `No pair signal: ${regimeReason}`;
    return rejectPairSetupCandidate(state, config, candidate, regimeReason);
  }

  const confirmation = checkPairConfirmation(state, config, analysis);
  if (!confirmation.ok) {
    state.lastMessage = "Pair setup waiting for reversion confirmation";
    return rejectPairSetupCandidate(state, config, candidate, confirmation.reason, {
      pendingPairSignal: state.pendingPairSignal
    });
  }

  const meta = pairMetaReject(state, config, features);
  state.lastPairMeta = {
    probability: meta.probability,
    expectedValue: meta.expectedValue,
    rejectedReason: meta.ok ? null : meta.reason
  };
  if (!meta.ok) {
    state.lastMessage = meta.reason === "pair-meta-model-missing"
      ? "Pair setup rejected: meta-model missing"
      : "Pair setup rejected by meta-model";
    return rejectPairSetupCandidate(state, config, candidate, "pair-meta-model", {
      metaRejectReason: meta.reason,
      setupScoreAtEntry: meta.probability,
      setupExpectedValueAtEntry: meta.expectedValue
    });
  }

  if (config.useMlFilter) {
    const signal = state.mlSignal;
    const hasEnoughSamples = signal && signal.setupWinProbability != null;
    const enoughConf = hasEnoughSamples && asNumber(signal.setupWinProbability) >= asNumber(config.mlMinConfPct) / 100;
    if (hasEnoughSamples && !enoughConf) {
      state.lastMessage = "Pair setup rejected by optional ML scorer";
      return rejectPairSetupCandidate(state, config, candidate, "ml-filter", {
        setupScoreAtEntry: meta.probability,
        setupExpectedValueAtEntry: meta.expectedValue
      });
    }
  }

  const setup = appendPairSetupLog(state, config, {
    ...candidate,
    accepted: false,
    setupScoreAtEntry: meta.probability,
    setupExpectedValueAtEntry: meta.expectedValue
  });
  const opened = openPairPosition(state, config, analysis, analysis.signal.type, nowTs, setup);
  if (!opened) {
    updatePairSetupLogLabel(state, setup.id, { accepted: false, rejectReason: "entry-not-opened" });
  }
  return opened;
}

function normalizeBacktestPoint(point, index, config) {
  const stepMs = Math.max(1, asNumber(config.cycleIntervalMinutes, 5)) * 60 * 1000;
  const defaultTs = index * stepMs;

  if (typeof point === "number") {
    if (config.strategyMode === "pairs") {
      return { price: NaN, basePrice: NaN, quotePrice: NaN, ts: defaultTs };
    }
    return {
      price: point,
      fundingRate: 0,
      nextFundingTs: null,
      ts: defaultTs
    };
  }

  if (config.strategyMode === "pairs") {
    if (config.pairUniverseEnabled && point.prices && typeof point.prices === "object") {
      const prices = Object.fromEntries(Object.entries(point.prices).map(([symbol, price]) => [normalizeSymbol(symbol), asNumber(price)]));
      const firstPair = config.pairUniverse[0] || [config.baseSymbol, config.quoteSymbol];
      const baseSymbol = config.baseSymbol || firstPair[0];
      const quoteSymbol = config.quoteSymbol || firstPair[1];
      return {
        price: asNumber(prices[config.symbol], prices[baseSymbol]),
        basePrice: asNumber(prices[baseSymbol]),
        quotePrice: asNumber(prices[quoteSymbol]),
        prices,
        fundingRate: 0,
        fundingRateBase: 0,
        fundingRateQuote: 0,
        nextFundingTs: null,
        nextFundingTsBase: null,
        nextFundingTsQuote: null,
        ts: point.ts == null ? defaultTs : asNumber(point.ts, defaultTs)
      };
    }
    return {
      price: asNumber(point.basePrice ?? point.base ?? point.price ?? point.p),
      basePrice: asNumber(point.basePrice ?? point.base),
      quotePrice: asNumber(point.quotePrice ?? point.quote),
      fundingRate: point.fundingRateBase == null ? 0 : asNumber(point.fundingRateBase, 0),
      fundingRateBase: point.fundingRateBase == null ? 0 : asNumber(point.fundingRateBase, 0),
      fundingRateQuote: point.fundingRateQuote == null ? 0 : asNumber(point.fundingRateQuote, 0),
      nextFundingTs: point.nextFundingTsBase == null ? null : asNumber(point.nextFundingTsBase, null),
      nextFundingTsBase: point.nextFundingTsBase == null ? null : asNumber(point.nextFundingTsBase, null),
      nextFundingTsQuote: point.nextFundingTsQuote == null ? null : asNumber(point.nextFundingTsQuote, null),
      ts: point.ts == null ? defaultTs : asNumber(point.ts, defaultTs)
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
  const pairTrades = trades.filter((trade) => trade.type === "PAIR");
  const holdingTrades = trades.filter((trade) => Number.isFinite(asNumber(trade.holdingCycles, NaN)));
  const avgHoldingCycles = holdingTrades.length
    ? holdingTrades.reduce((sum, trade) => sum + asNumber(trade.holdingCycles), 0) / holdingTrades.length
    : 0;
  return {
    config,
    metrics: { ...(state.metrics || {}) },
    tradeCount: trades.length,
    pairSignalCount: pairTrades.length,
    rejectedSignals: { ...(state.rejectedSignals || {}) },
    avgHoldingCycles,
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
    if (config.strategyMode === "pairs") {
      if (config.pairUniverseEnabled) {
        if (!point.prices || typeof point.prices !== "object") continue;
      } else if (!Number.isFinite(point.basePrice) || !Number.isFinite(point.quotePrice) || point.basePrice <= 0 || point.quotePrice <= 0) continue;
    } else if (!Number.isFinite(point.price) || point.price <= 0) continue;

    state.cycleCount += 1;
    state.lastTickAt = nowIso(point.ts);
    state.price = point.price;
    state.fundingRate = point.fundingRate;
    state.nextFundingTs = point.nextFundingTs;
    state.basePrice = point.basePrice == null ? point.price : point.basePrice;
    state.quotePrice = point.quotePrice == null ? null : point.quotePrice;
    state.fundingRateBase = point.fundingRateBase == null ? point.fundingRate : point.fundingRateBase;
    state.fundingRateQuote = point.fundingRateQuote == null ? null : point.fundingRateQuote;
    state.nextFundingTsBase = point.nextFundingTsBase == null ? point.nextFundingTs : point.nextFundingTsBase;
    state.nextFundingTsQuote = point.nextFundingTsQuote == null ? null : point.nextFundingTsQuote;
    state.symbolPrices = point.prices || {
      [config.symbol]: point.price,
      [config.baseSymbol]: point.basePrice,
      [config.quoteSymbol]: point.quotePrice
    };

    appendPricePoint(state, config, point.price, point.ts);
    if (config.strategyMode === "pairs") {
      appendPairPoint(state, config, point.basePrice, point.quotePrice, point.ts);
      if (config.pairUniverseEnabled) appendPairUniversePoints(state, config, state.symbolPrices, point.ts);
    }
    updateMlSignal(state, config, point.ts);
    applyFundingAccrual(state, config, point.ts);
    maybeManageOpenPosition(state, config, history, point.ts);
    if (!state.position) {
      maybeOpenTrade(state, config, history, point.ts);
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
      strategyMode: config.strategyMode,
      baseSymbol: config.baseSymbol,
      quoteSymbol: config.quoteSymbol,
      balance: state.balance,
      price: state.price,
      basePrice: state.basePrice,
      quotePrice: state.quotePrice,
      fundingRate: state.fundingRate,
      fundingRateBase: state.fundingRateBase,
      fundingRateQuote: state.fundingRateQuote,
      nextFundingTs: state.nextFundingTs,
      nextFundingTsBase: state.nextFundingTsBase,
      nextFundingTsQuote: state.nextFundingTsQuote,
      cycleCount: state.cycleCount,
      riskMode: state.riskMode || "normal",
      effectiveRiskPerTradePct: effectiveRiskPerTradePct(config, state),
      effectivePairRiskPerTradePct: effectivePairRiskPerTradePct(config, state),
      lossCooldownUntilCycle: state.lossCooldownUntilCycle,
      lastTickAt: state.lastTickAt,
      lastMessage: state.lastMessage,
      position: state.position,
      positionType: state.position && state.position.type ? state.position.type : (state.position ? "SINGLE" : null),
      pair: state.lastPairAnalysis ? {
        zScore: state.lastPairAnalysis.zScore,
        correlation: state.lastPairAnalysis.correlation,
        beta: state.lastPairAnalysis.beta,
        halfLifeBars: state.lastPairAnalysis.halfLifeBars,
        rejectedReason: state.lastPairAnalysis.rejectedReason,
        metaProbability: state.lastPairMeta ? state.lastPairMeta.probability : null,
        metaExpectedValue: state.lastPairMeta ? state.lastPairMeta.expectedValue : null,
        metaRejectedReason: state.lastPairMeta ? state.lastPairMeta.rejectedReason : null,
        pendingPairSignal: state.pendingPairSignal || null
      } : null,
      pendingPairSignal: state.pendingPairSignal || null,
      pairOpportunities: Array.isArray(state.pairOpportunities) ? state.pairOpportunities.slice(0, 10) : [],
      pairUniverseStatus: {
        enabled: Boolean(config.pairUniverseEnabled),
        size: Array.isArray(config.pairUniverse) ? config.pairUniverse.length : 0,
        symbols: config.pairUniverseEnabled ? uniqueUniverseSymbols(config) : [config.baseSymbol, config.quoteSymbol]
      },
      pairRecentStats: state.pairRecentStats || null,
      rejectedSignals: state.rejectedSignals,
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
  state.basePrice = market.basePrice == null ? market.price : market.basePrice;
  state.quotePrice = market.quotePrice == null ? null : market.quotePrice;
  state.fundingRate = market.fundingRate;
  state.fundingRateBase = market.fundingRateBase == null ? market.fundingRate : market.fundingRateBase;
  state.fundingRateQuote = market.fundingRateQuote == null ? null : market.fundingRateQuote;
  state.nextFundingTs = market.nextFundingTs;
  state.nextFundingTsBase = market.nextFundingTsBase == null ? market.nextFundingTs : market.nextFundingTsBase;
  state.nextFundingTsQuote = market.nextFundingTsQuote == null ? null : market.nextFundingTsQuote;
  state.symbolPrices = market.symbolPrices || {
    [config.symbol]: market.price,
    [config.baseSymbol]: market.basePrice == null ? market.price : market.basePrice,
    [config.quoteSymbol]: market.quotePrice
  };
  appendPricePoint(state, config, market.price, nowTs);
  if (config.strategyMode === "pairs") {
    appendPairPoint(state, config, market.basePrice, market.quotePrice, nowTs);
    if (config.pairUniverseEnabled) appendPairUniversePoints(state, config, state.symbolPrices, nowTs);
  }
  updateMlSignal(state, config, nowTs);
  applyFundingAccrual(state, config, nowTs);
  maybeManageOpenPosition(state, config, history, nowTs);
  if (!state.position) {
    maybeOpenTrade(state, config, history, nowTs);
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
  buildPairSetupFeatures,
  scorePairSetupWithModel,
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
