-- CreateTable
CREATE TABLE "Property" (
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "conversionRoute" TEXT NOT NULL,
    "publishingPolicy" TEXT NOT NULL DEFAULT 'review_first',
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("domain")
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "engineVersion" TEXT NOT NULL,
    "degradedAdapters" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "indexable" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT,
    "metaDescription" TEXT,
    "h1" TEXT,
    "canonical" TEXT,
    "robotsMeta" TEXT,
    "schemaTypes" JSONB NOT NULL DEFAULT '[]',
    "internalLinks" INTEGER NOT NULL DEFAULT 0,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "rawTextLength" INTEGER NOT NULL DEFAULT 0,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueryCluster" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "demand" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "demandSource" TEXT NOT NULL DEFAULT 'modeled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueryCluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "subject" TEXT NOT NULL,
    "clusterId" TEXT,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawRef" TEXT,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detectorId" TEXT NOT NULL,
    "detectorVersion" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "impact" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "fit" DOUBLE PRECISION NOT NULL,
    "tacticPrior" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "effort" DOUBLE PRECISION NOT NULL,
    "rawScore" DOUBLE PRECISION NOT NULL,
    "priority" INTEGER NOT NULL,
    "isBlocker" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "spec" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "lastCheck" JSONB,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "path" TEXT,
    "body" TEXT NOT NULL,
    "reviewState" TEXT NOT NULL DEFAULT 'draft',
    "producedBy" TEXT NOT NULL DEFAULT 'template',
    "qa" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Measurement" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "actionId" TEXT,
    "metric" TEXT NOT NULL,
    "baseline" DOUBLE PRECISION,
    "current" DOUBLE PRECISION,
    "windowDays" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL DEFAULT 'too_early',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Measurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "detail" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdapterCall" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdapterCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Snapshot_domain_startedAt_idx" ON "Snapshot"("domain", "startedAt");

-- CreateIndex
CREATE INDEX "Page_domain_url_idx" ON "Page"("domain", "url");

-- CreateIndex
CREATE UNIQUE INDEX "Page_snapshotId_url_key" ON "Page"("snapshotId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "QueryCluster_domain_market_query_key" ON "QueryCluster"("domain", "market", "query");

-- CreateIndex
CREATE INDEX "Evidence_snapshotId_kind_idx" ON "Evidence"("snapshotId", "kind");

-- CreateIndex
CREATE INDEX "Evidence_domain_kind_fetchedAt_idx" ON "Evidence"("domain", "kind", "fetchedAt");

-- CreateIndex
CREATE INDEX "Opportunity_domain_priority_idx" ON "Opportunity"("domain", "priority");

-- CreateIndex
CREATE INDEX "Opportunity_snapshotId_idx" ON "Opportunity"("snapshotId");

-- CreateIndex
CREATE INDEX "Action_domain_status_idx" ON "Action"("domain", "status");

-- CreateIndex
CREATE INDEX "Measurement_domain_metric_idx" ON "Measurement"("domain", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "AdapterCall_snapshotId_adapter_requestKey_key" ON "AdapterCall"("snapshotId", "adapter", "requestKey");

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_domain_fkey" FOREIGN KEY ("domain") REFERENCES "Property"("domain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_domain_fkey" FOREIGN KEY ("domain") REFERENCES "Property"("domain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueryCluster" ADD CONSTRAINT "QueryCluster_domain_fkey" FOREIGN KEY ("domain") REFERENCES "Property"("domain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_domain_fkey" FOREIGN KEY ("domain") REFERENCES "Property"("domain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "QueryCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_domain_fkey" FOREIGN KEY ("domain") REFERENCES "Property"("domain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_domain_fkey" FOREIGN KEY ("domain") REFERENCES "Property"("domain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdapterCall" ADD CONSTRAINT "AdapterCall_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
