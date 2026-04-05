const admin = require("firebase-admin");
const { runTradingCycle } = require("./lib/trader-core");

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp();
  }

  const firestore = admin.firestore();
  const collectionPath = process.env.TRADER_COLLECTION || "demoTrader";
  const result = await runTradingCycle({
    firestore,
    collectionPath,
    trigger: "cloud-run-job"
  });

  console.log(JSON.stringify({
    ok: result.ok,
    trigger: result.trigger,
    skipped: result.skipped || false,
    reason: result.reason || null,
    balance: result.state && result.state.balance,
    price: result.state && result.state.price,
    lastMessage: result.state && result.state.lastMessage
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message,
    stack: error.stack
  }));
  process.exit(1);
});
