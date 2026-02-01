-- CreateEnum
CREATE TYPE "Source" AS ENUM ('CHATGPT', 'CLAUDE', 'GROK', 'MIXED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('WORK', 'LEARNING', 'CREATIVE', 'MUNDANE', 'PERSONAL', 'OTHER', 'MEDICAL', 'MENTAL_HEALTH', 'ADDICTION_RECOVERY', 'INTIMACY', 'FINANCIAL', 'LEGAL', 'EMBARRASSING');

-- CreateEnum
CREATE TYPE "FilterMode" AS ENUM ('INCLUDE', 'EXCLUDE');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Stage" AS ENUM ('CLASSIFY', 'SUMMARIZE', 'REDACT');

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "Source" NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "statsJson" JSONB NOT NULL,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_atoms" (
    "id" TEXT NOT NULL,
    "atomStableId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "source" "Source" NOT NULL,
    "sourceConversationId" TEXT,
    "sourceMessageId" TEXT,
    "timestampUtc" TIMESTAMP(3) NOT NULL,
    "dayDate" DATE NOT NULL,
    "role" "Role" NOT NULL,
    "text" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_atoms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_labels" (
    "id" TEXT NOT NULL,
    "messageAtomId" TEXT NOT NULL,
    "category" "Category" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_entries" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "source" "Source" NOT NULL,
    "dayDate" DATE NOT NULL,
    "contentText" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "filter_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "FilterMode" NOT NULL,
    "categories" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "filter_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompts" (
    "id" TEXT NOT NULL,
    "stage" "Stage" NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_versions" (
    "id" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "templateText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runs" (
    "id" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "importBatchId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "sources" JSONB NOT NULL,
    "filterProfileId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "outputTarget" TEXT NOT NULL DEFAULT 'db',
    "configJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "dayDate" DATE NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "error" TEXT,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outputs" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stage" "Stage" NOT NULL,
    "outputText" TEXT NOT NULL,
    "outputJson" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersionId" TEXT NOT NULL,
    "bundleHash" TEXT NOT NULL,
    "bundleContextHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outputs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_atoms_atomStableId_key" ON "message_atoms"("atomStableId");

-- CreateIndex
CREATE INDEX "message_atoms_importBatchId_idx" ON "message_atoms"("importBatchId");

-- CreateIndex
CREATE INDEX "message_atoms_dayDate_idx" ON "message_atoms"("dayDate");

-- CreateIndex
CREATE INDEX "message_atoms_source_idx" ON "message_atoms"("source");

-- CreateIndex
CREATE INDEX "message_labels_messageAtomId_idx" ON "message_labels"("messageAtomId");

-- CreateIndex
CREATE INDEX "message_labels_promptVersionId_idx" ON "message_labels"("promptVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "message_labels_messageAtomId_promptVersionId_model_key" ON "message_labels"("messageAtomId", "promptVersionId", "model");

-- CreateIndex
CREATE INDEX "raw_entries_importBatchId_idx" ON "raw_entries"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "raw_entries_importBatchId_source_dayDate_key" ON "raw_entries"("importBatchId", "source", "dayDate");

-- CreateIndex
CREATE UNIQUE INDEX "filter_profiles_name_key" ON "filter_profiles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "prompts_stage_name_key" ON "prompts"("stage", "name");

-- CreateIndex
CREATE INDEX "prompt_versions_promptId_idx" ON "prompt_versions"("promptId");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_versions_promptId_versionLabel_key" ON "prompt_versions"("promptId", "versionLabel");

-- CreateIndex
CREATE INDEX "runs_importBatchId_idx" ON "runs"("importBatchId");

-- CreateIndex
CREATE INDEX "runs_status_idx" ON "runs"("status");

-- CreateIndex
CREATE INDEX "jobs_runId_idx" ON "jobs"("runId");

-- CreateIndex
CREATE INDEX "jobs_status_idx" ON "jobs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_runId_dayDate_key" ON "jobs"("runId", "dayDate");

-- CreateIndex
CREATE INDEX "outputs_jobId_idx" ON "outputs"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "outputs_jobId_stage_key" ON "outputs"("jobId", "stage");

-- AddForeignKey
ALTER TABLE "message_atoms" ADD CONSTRAINT "message_atoms_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_labels" ADD CONSTRAINT "message_labels_messageAtomId_fkey" FOREIGN KEY ("messageAtomId") REFERENCES "message_atoms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_labels" ADD CONSTRAINT "message_labels_promptVersionId_fkey" FOREIGN KEY ("promptVersionId") REFERENCES "prompt_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_entries" ADD CONSTRAINT "raw_entries_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "prompts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_filterProfileId_fkey" FOREIGN KEY ("filterProfileId") REFERENCES "filter_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outputs" ADD CONSTRAINT "outputs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outputs" ADD CONSTRAINT "outputs_promptVersionId_fkey" FOREIGN KEY ("promptVersionId") REFERENCES "prompt_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
