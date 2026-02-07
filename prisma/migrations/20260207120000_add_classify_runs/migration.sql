-- CreateTable
CREATE TABLE "classify_runs" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersionId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "totalAtoms" INTEGER NOT NULL,
    "newlyLabeled" INTEGER NOT NULL,
    "skippedAlreadyLabeled" INTEGER NOT NULL,
    "labeledTotal" INTEGER NOT NULL,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classify_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "classify_runs_importBatchId_idx" ON "classify_runs"("importBatchId");

-- CreateIndex
CREATE INDEX "classify_runs_importBatchId_model_promptVersionId_idx" ON "classify_runs"("importBatchId", "model", "promptVersionId");

-- AddForeignKey
ALTER TABLE "classify_runs" ADD CONSTRAINT "classify_runs_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classify_runs" ADD CONSTRAINT "classify_runs_promptVersionId_fkey" FOREIGN KEY ("promptVersionId") REFERENCES "prompt_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
