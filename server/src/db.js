const Database = require("better-sqlite3");

const db = new Database("bot.sqlite");

db.exec(`
  CREATE TABLE IF NOT EXISTS watchlist (
    symbol TEXT PRIMARY KEY,
    windowSize TEXT NOT NULL DEFAULT '7d',
    usdPerPercent REAL NOT NULL DEFAULT 5,
    maxPerRun REAL NOT NULL DEFAULT 50,
    enabled INTEGER NOT NULL DEFAULT 1,
    lastBuyAt INTEGER
  );

  CREATE TABLE IF NOT EXISTS positions (
    symbol TEXT PRIMARY KEY,
    qty REAL NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0,       -- USDT-ben (átlagáras cost basis)
    realized REAL NOT NULL DEFAULT 0    -- realizált PnL USDT
  );

  CREATE TABLE IF NOT EXISTS wallet (
    asset TEXT PRIMARY KEY,
    free REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    qty REAL NOT NULL,
    quoteQty REAL NOT NULL,
    avgPrice REAL NOT NULL,
    orderId TEXT
  );
`);

module.exports = db;
