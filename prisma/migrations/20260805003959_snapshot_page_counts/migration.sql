-- Outcome checks compare the first and last snapshot in a series. Deriving that
-- by counting pages per snapshot made verification cost grow with the square of
-- elapsed time: snapshots accumulate nightly, and every action re-counted all of
-- them. Denormalising turns the whole check into one indexed read.
ALTER TABLE "Snapshot" ADD COLUMN "indexablePages" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Snapshot" ADD COLUMN "totalPages" INTEGER NOT NULL DEFAULT 0;

-- Backfill from existing pages so historical series stay correct.
UPDATE "Snapshot" s SET
  "indexablePages" = (SELECT COUNT(*) FROM "Page" p WHERE p."snapshotId" = s.id AND p.indexable),
  "totalPages"     = (SELECT COUNT(*) FROM "Page" p WHERE p."snapshotId" = s.id);

-- Foreign keys Prisma does not index on Postgres. Each is a cascade or set-null
-- target, so without these a delete degrades into a sequential scan.
CREATE INDEX "Action_opportunityId_idx"   ON "Action"("opportunityId");
CREATE INDEX "Asset_actionId_idx"         ON "Asset"("actionId");
CREATE INDEX "Evidence_clusterId_idx"     ON "Evidence"("clusterId");
CREATE INDEX "Measurement_snapshotId_idx" ON "Measurement"("snapshotId");

-- The evidence lookups in checks.ts filter on subject and order by time; the
-- previous index stopped at (domain, kind), so Postgres read and discarded
-- every row for that domain and kind.
CREATE INDEX "Evidence_domain_kind_subject_fetchedAt_idx"
  ON "Evidence"("domain","kind","subject","fetchedAt");
DROP INDEX IF EXISTS "Evidence_domain_kind_fetchedAt_idx";

-- The single most repeated query in the system: indexable page counts per
-- snapshot. Partial index keeps it index-only.
CREATE INDEX "Page_snapshotId_indexable_idx" ON "Page"("snapshotId") WHERE indexable;

-- Dashboard sort orders that were previously done in memory.
CREATE INDEX "Opportunity_snapshotId_priority_idx" ON "Opportunity"("snapshotId","priority" DESC);
CREATE INDEX "QueryCluster_domain_demand_idx"      ON "QueryCluster"("domain","demand" DESC);
