-- CreateTable
CREATE TABLE "run_batches" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "run_batches_runId_idx" ON "run_batches"("runId");

-- CreateIndex
CREATE INDEX "run_batches_importBatchId_idx" ON "run_batches"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "run_batches_runId_importBatchId_key" ON "run_batches"("runId", "importBatchId");

-- AddForeignKey
ALTER TABLE "run_batches" ADD CONSTRAINT "run_batches_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_batches" ADD CONSTRAINT "run_batches_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: create one RunBatch row per existing Run (idempotent)
INSERT INTO "run_batches" ("id", "runId", "importBatchId", "createdAt")
SELECT
    gen_random_uuid()::text,
    r."id",
    r."importBatchId",
    NOW()
FROM "runs" r
ON CONFLICT ("runId", "importBatchId") DO NOTHING;
