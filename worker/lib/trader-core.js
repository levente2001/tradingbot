// This file mirrors ../../shared/trader-core.js so that `gcloud run jobs deploy --source ./worker`
// can build a self-contained worker source tree.
module.exports = require("./trader-core.generated");
