const crypto = require("crypto");

/**
 * Two base URLs:
 * - PUBLIC_BASE: for public market data (prices, tickers). In DEMO mode you typically want REAL prices:
 *   BINANCE_PUBLIC_BASE_URL=https://api.binance.com
 * - TRADE_BASE: for signed trading requests (orders). Can be testnet or live:
 *   BINANCE_TRADE_BASE_URL=https://testnet.binance.vision
 */
const PUBLIC_BASE = process.env.BINANCE_PUBLIC_BASE_URL || process.env.BINANCE_BASE_URL || "https://api.binance.com";
const TRADE_BASE  = process.env.BINANCE_TRADE_BASE_URL  || process.env.BINANCE_BASE_URL || "https://api.binance.com";

const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;

function qs(params) {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) usp.append(k, String(v));
  });
  return usp.toString();
}

function sign(queryString) {
  return crypto.createHmac("sha256", API_SECRET).update(queryString).digest("hex");
}

async function publicGet(path, params = {}) {
  const url = `${PUBLIC_BASE}${path}?${qs(params)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Binance public error ${r.status}: ${await r.text()}`);
  return r.json();
}

async function signedRequest(method, path, params = {}) {
  if (!API_KEY || !API_SECRET) throw new Error("Missing BINANCE_API_KEY/SECRET");

  const timestamp = Date.now();
  const query = qs({ ...params, timestamp });
  const signature = sign(query);

  const url = `${TRADE_BASE}${path}?${query}&signature=${signature}`;
  const r = await fetch(url, {
    method,
    headers: { "X-MBX-APIKEY": API_KEY }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Binance signed error ${r.status}: ${text}`);
  return JSON.parse(text);
}

module.exports = { publicGet, signedRequest };
