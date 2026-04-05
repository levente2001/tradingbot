const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const {
  activateDemoTrader,
  getTradingStatus,
  runTradingCycle,
  setTraderRunning,
  updateTraderConfig
} = require("../shared/trader-core");

if (!admin.apps.length) {
  admin.initializeApp();
}

const firestore = admin.firestore();
const region = process.env.GCP_REGION || "europe-west1";

function getCollectionPath() {
  return process.env.TRADER_COLLECTION || "demoTrader";
}

function bodyFor(req) {
  return req.method === "POST" ? req.body || {} : req.query || {};
}

function wrap(handler) {
  return async (req, res) => {
    try {
      const payload = bodyFor(req);
      const result = await handler(req, payload);
      res.json(result);
    } catch (error) {
      logger.error("HTTP handler failed", { message: error.message, stack: error.stack });
      res.status(500).json({ ok: false, error: error.message });
    }
  };
}

exports.activateDemoTrader = onRequest(
  { region, cors: true },
  wrap(async (_req, payload) => activateDemoTrader({
    firestore,
    collectionPath: getCollectionPath(),
    payload
  }))
);

exports.startTrader = onRequest(
  { region, cors: true },
  wrap(async () => setTraderRunning({
    firestore,
    collectionPath: getCollectionPath(),
    running: true
  }))
);

exports.stopTrader = onRequest(
  { region, cors: true },
  wrap(async () => setTraderRunning({
    firestore,
    collectionPath: getCollectionPath(),
    running: false
  }))
);

exports.tradingStatus = onRequest(
  { region, cors: true },
  wrap(async () => getTradingStatus({
    firestore,
    collectionPath: getCollectionPath()
  }))
);

exports.updateTraderConfig = onRequest(
  { region, cors: true },
  wrap(async (req, payload) => {
    if (req.method !== "POST") {
      return { ok: false, error: "Use POST" };
    }
    return updateTraderConfig({
      firestore,
      collectionPath: getCollectionPath(),
      payload
    });
  })
);

exports.runTradingLoop = onRequest(
  { region, cors: true },
  wrap(async () => runTradingCycle({
    firestore,
    collectionPath: getCollectionPath(),
    trigger: "functions-http"
  }))
);
