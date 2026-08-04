-- One measurement row per (action, metric): the series is updated in place as
-- snapshots accumulate, rather than appending a new row on every verify pass.
CREATE UNIQUE INDEX "Measurement_actionId_metric_key" ON "Measurement"("actionId", "metric");
