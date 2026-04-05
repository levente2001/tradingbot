# Deploy

This repo is split into:

- Firebase Hosting for the mobile control panel
- Firebase Functions v2 for lightweight HTTP admin/status endpoints
- Cloud Run Job for the actual scheduled trading worker

Assumptions:

- `REGION` defaults to `europe-west1`
- Firestore is the source of truth
- trading remains demo-only
- the Cloud Run Job is deployed from `./worker`
- `worker/lib/trader-core.generated.js` is the worker-local copy used for source-based Cloud Run builds

## Variables

Replace these placeholders before running commands:

- `PROJECT_ID`
- `PROJECT_NUMBER`
- `REGION`
- `JOB_NAME`
- `SCHEDULER_JOB_NAME`

Recommended values:

- `REGION=europe-west1`
- `JOB_NAME=demo-trader-worker`
- `SCHEDULER_JOB_NAME=demo-trader-scheduler`

## A. Initial Google Cloud Setup

```bash
gcloud init
gcloud config set project PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com cloudscheduler.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com secretmanager.googleapis.com
```

If Firestore is not initialized yet, create it once in Native mode from the Google Cloud Console or Firebase Console before running the worker.

## B. Deploy The Cloud Run Job From Source

From the repo root:

```bash
gcloud run jobs deploy JOB_NAME \
  --source ./worker \
  --region REGION \
  --project PROJECT_ID \
  --task-timeout=600 \
  --max-retries=1 \
  --tasks=1 \
  --memory=512Mi \
  --cpu=1 \
  --set-env-vars=TRADER_COLLECTION=demoTrader,GCP_REGION=REGION
```

Notes:

- The job runs one trading cycle and exits.
- `TRADER_COLLECTION` can be changed later if you want isolated environments such as `demoTraderDev` and `demoTraderProd`.

## C. Create The Cloud Scheduler Trigger For The Cloud Run Job

```bash
gcloud scheduler jobs create http SCHEDULER_JOB_NAME \
  --location REGION \
  --schedule="*/5 * * * *" \
  --uri="https://run.googleapis.com/v2/projects/PROJECT_ID/locations/REGION/jobs/JOB_NAME:run" \
  --http-method POST \
  --oauth-service-account-email PROJECT_NUMBER-compute@developer.gserviceaccount.com
```

Manually run the scheduler job later:

```bash
gcloud scheduler jobs run SCHEDULER_JOB_NAME --location REGION
```

## D. Firebase Deployment

Initialize hosting once if needed:

```bash
firebase init hosting
```

Deploy hosting:

```bash
firebase deploy --only hosting
```

Deploy all functions:

```bash
firebase deploy --only functions
```

Or deploy only the trader functions:

```bash
firebase deploy --only functions:activateDemoTrader,functions:startTrader,functions:stopTrader,functions:tradingStatus,functions:updateTraderConfig,functions:runTradingLoop
```

## E. Post-Deploy Verification

### Manually execute the Cloud Run Job

```bash
gcloud run jobs execute JOB_NAME --region REGION --project PROJECT_ID --wait
```

### Check logs

Cloud Run Job logs:

```bash
gcloud run jobs executions list --job JOB_NAME --region REGION --project PROJECT_ID
gcloud beta run jobs executions logs read EXECUTION_NAME --region REGION --project PROJECT_ID
```

Firebase Functions logs:

```bash
firebase functions:log
```

### Verify the Firebase endpoints

After function deploy, open or call the generated HTTPS endpoints for:

- `activateDemoTrader`
- `startTrader`
- `stopTrader`
- `tradingStatus`
- `updateTraderConfig`
- `runTradingLoop`

Example `curl` calls:

```bash
curl -X POST "FUNCTION_URL_FOR_activateDemoTrader" \
  -H "Content-Type: application/json" \
  -d '{"nick":"DemoUser","startBalance":10000,"algoOn":false}'

curl "FUNCTION_URL_FOR_tradingStatus"

curl -X POST "FUNCTION_URL_FOR_startTrader"

curl -X POST "FUNCTION_URL_FOR_updateTraderConfig" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","lookbackBars":6,"thresholdPct":0.12,"riskPerTradePct":0.75,"stopLossPct":0.45}'
```

### Verify the Hosting panel

After Hosting deploy:

1. Open the Hosting URL.
2. Confirm the panel loads without localhost references.
3. Confirm `Start` and `Stop` call the Firebase endpoints successfully.
4. Confirm `Balance`, price, status text, and metrics load from `tradingStatus`.

## Recommended First-Time Sequence

```bash
gcloud config set project PROJECT_ID
gcloud run jobs deploy JOB_NAME \
  --source ./worker \
  --region REGION \
  --project PROJECT_ID \
  --task-timeout=600 \
  --max-retries=1 \
  --tasks=1 \
  --memory=512Mi \
  --cpu=1 \
  --set-env-vars=TRADER_COLLECTION=demoTrader,GCP_REGION=REGION

firebase deploy --only functions
firebase deploy --only hosting

gcloud run jobs execute JOB_NAME --region REGION --project PROJECT_ID --wait
gcloud scheduler jobs create http SCHEDULER_JOB_NAME \
  --location REGION \
  --schedule="*/5 * * * *" \
  --uri="https://run.googleapis.com/v2/projects/PROJECT_ID/locations/REGION/jobs/JOB_NAME:run" \
  --http-method POST \
  --oauth-service-account-email PROJECT_NUMBER-compute@developer.gserviceaccount.com
```

## Operational Notes

- The worker is intentionally demo-only and never places real-money orders.
- The current Firestore schema stores config in `demoTrader/config`, state in `demoTrader/state`, and recent trade history in `demoTrader/history`.
- The first scheduled runs will warm up price history before signals become eligible.
- Because the scheduler is every 5 minutes, features and lookbacks are bar-based rather than second-based.
- `runTradingLoop` exists only as an admin/manual fallback. The normal production path is Cloud Scheduler -> Cloud Run Job.

## Remaining TODOs

- Regenerate `worker/lib/trader-core.generated.js` whenever `shared/trader-core.js` changes.
- If trade history grows beyond demo-scale usage, move closed trades from the single history document into a Firestore subcollection.
