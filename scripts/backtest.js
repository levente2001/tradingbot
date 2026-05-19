#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { runBacktest, optimizeBacktest, defaultConfig } = require("../shared/trader-core");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function parseScalar(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  const num = Number(value);
  return Number.isFinite(num) ? num : value;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const headers = lines[0].split(",").map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((value) => value.trim());
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index];
    });

    if (row.basePrice != null || row.quotePrice != null) {
      return {
        ts: row.ts == null || row.ts === "" ? undefined : Number(row.ts),
        basePrice: Number(row.basePrice ?? row.base ?? row.price),
        quotePrice: Number(row.quotePrice ?? row.quote),
        fundingRateBase: row.fundingRateBase == null || row.fundingRateBase === "" ? 0 : Number(row.fundingRateBase),
        fundingRateQuote: row.fundingRateQuote == null || row.fundingRateQuote === "" ? 0 : Number(row.fundingRateQuote)
      };
    }

    return {
      price: Number(row.price ?? row.p ?? row.close),
      fundingRate: row.fundingRate == null || row.fundingRate === "" ? 0 : Number(row.fundingRate),
      ts: row.ts == null || row.ts === "" ? undefined : Number(row.ts)
    };
  });
}

function loadSeries(filePath) {
  const absolutePath = path.resolve(filePath);
  if (absolutePath.endsWith(".json")) {
    const data = readJson(absolutePath);
    return Array.isArray(data) ? data : data.series;
  }
  if (absolutePath.endsWith(".csv")) {
    return parseCsv(fs.readFileSync(absolutePath, "utf8"));
  }
  throw new Error("Unsupported data file. Use .json or .csv");
}

function loadConfig(args) {
  const config = {};
  let configFileHasUseMlFilter = false;
  if (args.config) {
    const fileConfig = readJson(path.resolve(args.config));
    configFileHasUseMlFilter = Object.prototype.hasOwnProperty.call(fileConfig, "useMlFilter");
    Object.assign(config, fileConfig);
  }

  for (const [key, value] of Object.entries(args)) {
    if (!key.startsWith("set-")) continue;
    config[key.slice(4)] = parseScalar(value);
  }
  if (args.strategy) {
    config.strategyMode = args.strategy === "pairs" ? "pairs" : "trend";
  }

  return { config, configFileHasUseMlFilter };
}

function loadSearchSpace(args, strategyMode = "trend") {
  if (args.search) {
    return readJson(path.resolve(args.search));
  }

  if (strategyMode === "pairs") {
    // First-pass grid only. Treat results as hypothesis generation and validate with walk-forward/out-of-sample data.
    return {
      pairEntryZScore: [1.6, 2.0, 2.4],
      pairMaxEntryZScore: [2.6, 2.8, 3.0],
      pairExitZScore: [0.2, 0.4, 0.6],
      pairStopZScore: [2.8, 3.2, 3.8],
      pairLookbackBars: [80, 120, 180],
      pairMinCorrelation: [0.55, 0.65, 0.75],
      pairRiskPerTradePct: [0.25, 0.5, 0.75]
    };
  }

  return {
    thresholdPct: [0.08, 0.1, 0.12, 0.16],
    stopLossPct: [0.3, 0.4, 0.5],
    takeProfitRR: [1.0, 1.35, 1.7],
    trendFastBars: [4, 5, 6],
    trendSlowBars: [11, 13, 15],
    maxVolatilityPct: [0.25, 0.35, 0.5],
    breakEvenTriggerR: [0.5, 0.7, 0.9],
    trailingStopR: [0.9, 1.1, 1.4],
    maxHoldCycles: [12, 18, 24]
  };
}

function formatSummary(result) {
  const metrics = result.metrics || {};
  return {
    finalBalance: Number(result.finalBalance.toFixed(2)),
    netPnl: Number(result.netPnl.toFixed(2)),
    closedTrades: metrics.closedTrades,
    winRatePct: Number((metrics.winRatePct || 0).toFixed(2)),
    expectancy: Number((metrics.expectancy || 0).toFixed(4)),
    profitFactor: Number((metrics.profitFactor || 0).toFixed(3)),
    maxDrawdownPct: Number((metrics.maxDrawdownPct || 0).toFixed(2)),
    avgHoldingCycles: Number((result.avgHoldingCycles || 0).toFixed(2)),
    pairSignalCount: result.pairSignalCount || 0,
    rejectedSignals: result.rejectedSignals || {}
  };
}

function runWalkForward({ series, baseConfig, args }) {
  const trainWindow = Math.max(100, Number(args.trainWindow || args["train-window"] || 240));
  const validationWindow = Math.max(20, Number(args.validationWindow || args["validation-window"] || 80));
  const topN = Math.max(1, Number(args.top || 1));
  const windows = [];
  for (let start = 0; start + trainWindow + validationWindow <= series.length; start += validationWindow) {
    const train = series.slice(start, start + trainWindow);
    const validation = series.slice(start + trainWindow, start + trainWindow + validationWindow);
    const optimized = optimizeBacktest({
      series: train,
      baseConfig,
      searchSpace: loadSearchSpace(args, baseConfig.strategyMode),
      topN
    });
    const best = optimized.top[0];
    const validationResult = runBacktest({ series: validation, config: best.config });
    windows.push({
      trainStart: start,
      trainEnd: start + trainWindow - 1,
      validationStart: start + trainWindow,
      validationEnd: start + trainWindow + validationWindow - 1,
      trainScore: Number(best.score.toFixed(3)),
      config: best.config,
      validation: formatSummary(validationResult)
    });
  }

  const aggregateNetPnl = windows.reduce((sum, window) => sum + window.validation.netPnl, 0);
  const aggregateTrades = windows.reduce((sum, window) => sum + (window.validation.closedTrades || 0), 0);
  return {
    windows,
    aggregate: {
      windows: windows.length,
      netPnl: Number(aggregateNetPnl.toFixed(2)),
      closedTrades: aggregateTrades
    }
  };
}

function printUsage() {
  console.log(`
Usage:
  node scripts/backtest.js --data ./data/prices.json
  node scripts/backtest.js --data ./data/prices.csv --config ./config.json
  node scripts/backtest.js --data ./data/prices.json --optimize
  node scripts/backtest.js --data ./data/prices.json --optimize --search ./search-space.json --top 5
  node scripts/backtest.js --data ./data/pair-prices.csv --strategy pairs --walk-forward

Data formats:
  JSON: [100, 101, 102] or [{ "price": 100, "fundingRate": 0.0001, "ts": 1710000000000 }]
  CSV:  price,fundingRate,ts
        100,0.0001,1710000000000
  Pair JSON: [{ "ts": 1710000000000, "basePrice": 65000, "quotePrice": 3200, "fundingRateBase": 0.0001, "fundingRateQuote": 0.0001 }]
  Pair CSV:  ts,basePrice,quotePrice,fundingRateBase,fundingRateQuote

Config overrides:
  --set-thresholdPct 0.1 --set-stopLossPct 0.4 --set-useMlFilter false --set-strategyMode pairs
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.data) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const series = loadSeries(args.data);
  if (!Array.isArray(series) || !series.length) {
    throw new Error("The provided data file does not contain a usable price series");
  }

  const { config: loadedConfig, configFileHasUseMlFilter } = loadConfig(args);
  const explicitMlFlag = Object.prototype.hasOwnProperty.call(args, "set-useMlFilter");
  const baseConfig = { ...defaultConfig(), ...loadedConfig };
  if (!explicitMlFlag && !configFileHasUseMlFilter) {
    baseConfig.useMlFilter = false;
  }
  if (baseConfig.strategyMode === "pairs") {
    const invalidPairPoint = series.find((point) => typeof point !== "object" || !Number.isFinite(Number(point.basePrice ?? point.base)) || !Number.isFinite(Number(point.quotePrice ?? point.quote)));
    if (invalidPairPoint) {
      throw new Error("Pairs strategy requires basePrice and quotePrice in every usable data row");
    }
  }
  if (args["walk-forward"] || args.walkForward) {
    console.log(JSON.stringify({
      mode: "walk-forward",
      warning: "First-pass grid search only; use broader out-of-sample and walk-forward validation before trusting parameters.",
      ...runWalkForward({ series, baseConfig, args })
    }, null, 2));
    return;
  }
  if (args.optimize) {
    const topN = Math.max(1, Number(args.top || 10));
    const output = optimizeBacktest({
      series,
      baseConfig,
      searchSpace: loadSearchSpace(args, baseConfig.strategyMode),
      topN
    });

    console.log(JSON.stringify({
      mode: "optimize",
      tested: output.tested,
      top: output.top.map((entry) => ({
        score: Number(entry.score.toFixed(3)),
        summary: formatSummary(entry.result),
        config: entry.config
      }))
    }, null, 2));
    return;
  }

  const result = runBacktest({ series, config: baseConfig });
  console.log(JSON.stringify({
    mode: "backtest",
    summary: formatSummary(result),
    config: baseConfig,
    lastTrade: result.lastTrade
  }, null, 2));
}

main();
