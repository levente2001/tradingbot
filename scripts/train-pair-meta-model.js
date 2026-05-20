#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function sigmoid(value) {
  if (value >= 35) return 1;
  if (value <= -35) return 0;
  return 1 / (1 + Math.exp(-value));
}

function dot(weights, vector, bias) {
  let z = bias;
  for (let i = 0; i < weights.length; i += 1) z += weights[i] * vector[i];
  return z;
}

function metrics(rows, probabilities) {
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  let probSum = 0;
  let winSum = 0;
  let winCount = 0;
  let lossSum = 0;
  let lossCount = 0;
  rows.forEach((row, index) => {
    const probability = probabilities[index];
    const predicted = probability >= 0.5 ? 1 : 0;
    const label = row.label;
    if (predicted === 1 && label === 1) tp += 1;
    else if (predicted === 0 && label === 0) tn += 1;
    else if (predicted === 1 && label === 0) fp += 1;
    else fn += 1;
    probSum += probability;
    const pnl = asNumber(row.netPnl);
    if (pnl > 0) {
      winSum += pnl;
      winCount += 1;
    } else {
      lossSum += Math.abs(pnl);
      lossCount += 1;
    }
  });
  const total = rows.length || 1;
  return {
    rows: rows.length,
    accuracy: (tp + tn) / total,
    precision: tp + fp > 0 ? tp / (tp + fp) : 0,
    recall: tp + fn > 0 ? tp / (tp + fn) : 0,
    averagePredictedProbability: probSum / total,
    avgWin: winCount ? winSum / winCount : 0,
    avgLoss: lossCount ? lossSum / lossCount : 0,
    confusionMatrix: { tp, tn, fp, fn }
  };
}

function printUsage() {
  console.log(`
Usage:
  node scripts/train-pair-meta-model.js --data ./data/pair-setups.json --out ./data/pair-meta-model.json

Options:
  --epochs 600
  --lr 0.05
  --l2 0.001
  --validation-ratio 0.25
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.data || !args.out) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const dataset = JSON.parse(fs.readFileSync(path.resolve(args.data), "utf8"));
  const rows = (dataset.rows || [])
    .filter((row) => row && row.features && (row.label === 0 || row.label === 1));
  if (rows.length < 10) throw new Error("Need at least 10 labeled setup rows to train a useful meta-model");

  const featureNames = Object.keys(rows[0].features).filter((key) => rows.every((row) => Number.isFinite(Number(row.features[key]))));
  if (!featureNames.length) throw new Error("No numeric features found");

  const validationRatio = Math.min(0.5, Math.max(0.1, asNumber(args["validation-ratio"] || args.validationRatio, 0.25)));
  const split = Math.max(1, Math.floor(rows.length * (1 - validationRatio)));
  const trainRows = rows.slice(0, split);
  const validationRows = rows.slice(split);
  if (!validationRows.length) throw new Error("Validation split is empty");

  const mu = {};
  const sigma = {};
  for (const name of featureNames) {
    const values = trainRows.map((row) => asNumber(row.features[name]));
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1);
    mu[name] = mean;
    sigma[name] = Math.max(1e-9, Math.sqrt(variance));
  }

  const vectorize = (row) => featureNames.map((name) => (asNumber(row.features[name]) - mu[name]) / sigma[name]);
  const trainX = trainRows.map(vectorize);
  const trainY = trainRows.map((row) => row.label);
  const validationX = validationRows.map(vectorize);
  const weights = new Array(featureNames.length).fill(0);
  let bias = 0;
  const epochs = Math.max(1, Math.round(asNumber(args.epochs, 600)));
  const lr = asNumber(args.lr, 0.05);
  const l2 = Math.max(0, asNumber(args.l2, 0.001));

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradW = new Array(weights.length).fill(0);
    let gradB = 0;
    for (let i = 0; i < trainX.length; i += 1) {
      const prediction = sigmoid(dot(weights, trainX[i], bias));
      const error = prediction - trainY[i];
      for (let j = 0; j < weights.length; j += 1) gradW[j] += error * trainX[i][j];
      gradB += error;
    }
    for (let j = 0; j < weights.length; j += 1) {
      gradW[j] = gradW[j] / trainX.length + l2 * weights[j];
      weights[j] -= lr * gradW[j];
    }
    bias -= lr * (gradB / trainX.length);
  }

  const validationProbabilities = validationX.map((vector) => sigmoid(dot(weights, vector, bias)));
  const validation = metrics(validationRows, validationProbabilities);
  const weightObject = {};
  featureNames.forEach((name, index) => {
    weightObject[name] = weights[index];
  });

  const model = {
    type: "logistic_regression",
    features: featureNames,
    mu,
    sigma,
    weights: weightObject,
    bias,
    validation,
    createdAt: new Date().toISOString()
  };

  fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(model, null, 2)}\n`);
  console.log(JSON.stringify({
    out: path.resolve(args.out),
    trainRows: trainRows.length,
    validation
  }, null, 2));
}

main();
