# Architecture

## Split

- `functions/index.js`
  Keeps only lightweight Firebase HTTP endpoints:
  - `activateDemoTrader`
  - `startTrader`
  - `stopTrader`
  - `tradingStatus`
  - `updateTraderConfig`
  - `runTradingLoop` as a manual admin/emergency trigger

- `worker/worker.js`
  Runs exactly one trading cycle, logs the result, then exits. This is the Cloud Run Job entrypoint that Cloud Scheduler triggers.

- `shared/trader-core.js`
  Holds the shared trading domain logic:
  - Firestore config/state/history load and save
  - market snapshot fetching
  - feature engineering
  - ML inference and online updates
  - risk-based sizing
  - stop-loss / take-profit / liquidation logic
  - funding accrual for futures demo positions
  - performance metrics
  - one-cycle execution orchestration

## Why This Is Better

- Firebase Functions are now small control-plane endpoints instead of being responsible for long-lived orchestration.
- The actual trading loop is isolated into a Cloud Run Job, which is a better fit for scheduled background work that must run when local devices are offline.
- The shared core is easier to test, reason about, and reuse from both the admin endpoints and the worker.
- Firestore remains the source of truth for config, runtime state, and trade history.
- The worker now performs one deterministic cycle and exits cleanly, which is safer for Cloud Scheduler-driven automation than mixing scheduling and business logic inside Functions.
