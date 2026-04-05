require("dotenv").config();
const express = require("express");
const cors = require("cors");
const db = require("./db");
const { publicGet } = require("./binance");
const { isDemo, runOnce, sellPercent, getDemoSummary, resetDemo } = require("./bot");

const app = express();
app.use(cors());
app.use(express.json());

let botTimer = null;
let botRunning = false;
let botIntervalSec = null;

async function tickBot() {
  if (botRunning) return; // ne fusson párhuzamosan
  botRunning = true;
  try {
    await runOnce();
  } catch (e) {
    console.error("[bot] run error:", e.message);
  } finally {
    botRunning = false;
  }
}

function startBot(intervalSec) {
  const requested = Number(intervalSec || process.env.BOT_INTERVAL_SEC || 900);
  const sec = Math.max(10, Number.isFinite(requested) ? requested : 900); // min 10 mp
  botIntervalSec = sec;

  if (botTimer) clearInterval(botTimer);
  botTimer = setInterval(tickBot, sec * 1000);
  tickBot(); // induláskor fusson egyet
  return sec;
}

function stopBot() {
  if (botTimer) clearInterval(botTimer);
  botTimer = null;
}

/** --- meta / mode --- */
app.get("/api/mode", async (req, res) => {
  const mode = isDemo() ? "demo" : "live";
  if (mode === "demo") {
    const s = await getDemoSummary();
    return res.json({ mode, ...s });
  }
  res.json({ mode });
});

/** --- bot control --- */
app.get("/api/bot/status", (req, res) => {
  res.json({
    mode: isDemo() ? "demo" : "live",
    enabled: !!botTimer,
    runningNow: botRunning,
    intervalSec: botIntervalSec || Number(process.env.BOT_INTERVAL_SEC || 900)
  });
});

app.post("/api/bot/start", (req, res) => {
  const { intervalSec } = req.body || {};
  const sec = startBot(intervalSec);
  res.json({ ok: true, intervalSec: sec });
});

app.post("/api/bot/stop", (req, res) => {
  stopBot();
  res.json({ ok: true });
});

app.post("/api/bot/run", async (req, res) => {
  try {
    const results = await runOnce();
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** --- demo endpoints --- */
app.get("/api/demo/summary", async (req, res) => {
  try {
    const s = await getDemoSummary();
    if (!s) return res.status(400).json({ error: "Demo mode is not enabled (TRADING_MODE=demo)" });
    res.json(s);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/demo/reset", (req, res) => {
  try {
    const { usdt } = req.body || {};
    const out = resetDemo(usdt);
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** --- watchlist --- */
app.get("/api/watchlist", (req, res) => {
  res.json(db.prepare("SELECT * FROM watchlist").all());
});

app.post("/api/watchlist", (req, res) => {
  const { symbol, windowSize = "7d", maxPerRun = 50, enabled = 1 } = req.body || {};
  const usdPerPercent = 1; // 1% -> 1 USDT
  if (!symbol) return res.status(400).json({ error: "symbol required (e.g. BTCUSDT)" });

  db.prepare(`
    INSERT INTO watchlist(symbol, windowSize, usdPerPercent, maxPerRun, enabled)
    VALUES(?,?,?,?,?)
    ON CONFLICT(symbol) DO UPDATE SET
      windowSize=excluded.windowSize,
      usdPerPercent=excluded.usdPerPercent,
      maxPerRun=excluded.maxPerRun,
      enabled=excluded.enabled
  `).run(symbol.toUpperCase(), windowSize, usdPerPercent, maxPerRun, enabled);

  res.json({ ok: true });
});

app.delete("/api/watchlist/:symbol", (req, res) => {
  db.prepare("DELETE FROM watchlist WHERE symbol=?").run(req.params.symbol.toUpperCase());
  res.json({ ok: true });
});

/** --- positions --- */
app.get("/api/positions", async (req, res) => {
  const rows = db.prepare("SELECT * FROM positions").all();
  const out = [];
  for (const r of rows) {
    if (r.qty <= 0) continue;
    const t = await publicGet("/api/v3/ticker/price", { symbol: r.symbol });
    const last = Number(t.price);
    const avg = r.cost / r.qty;
    const unreal = r.qty * (last - avg);
    out.push({
      ...r,
      lastPrice: last,
      avgPrice: avg,
      unrealized: unreal,
      totalPnl: r.realized + unreal
    });
  }
  res.json(out);
});

/** --- manual sell (demo/live compatible) --- */
app.post("/api/sell", async (req, res) => {
  try {
    const { symbol, percent = 100 } = req.body || {};
    if (!symbol) return res.status(400).json({ error: "symbol required" });

    const out = await sellPercent(symbol.toUpperCase(), percent);
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** --- trades --- */
app.get("/api/trades", (req, res) => {
  res.json(db.prepare("SELECT * FROM trades ORDER BY ts DESC LIMIT 200").all());
});

app.listen(process.env.PORT || 8080, () => {
  console.log(`API running on http://localhost:${process.env.PORT || 8080}`);

  if (String(process.env.BOT_AUTOSTART || "0") === "1") {
    const sec = startBot(process.env.BOT_INTERVAL_SEC || 900);
    console.log(`[bot] autostart ON (interval=${sec}s)`);
  }
});
