-- CreateEnum
CREATE TYPE "DailyReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MediaScanStatus" AS ENUM ('PENDING', 'CLEAN', 'FLAGGED');

-- CreateTable
CREATE TABLE "DailyReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "siteId" TEXT,
    "reportDate" DATE NOT NULL,
    "weather" TEXT,
    "workSummary" TEXT NOT NULL,
    "workforceSummary" TEXT,
    "equipmentSummary" TEXT,
    "issues" TEXT,
    "safetyNotes" TEXT,
    "nextDayPlan" TEXT,
    "status" "DailyReportStatus" NOT NULL DEFAULT 'DRAFT',
    "revisionNo" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyReportWorker" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jobTitle" TEXT,
    "workerCount" INTEGER NOT NULL DEFAULT 1,
    "hours" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "DailyReportWorker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyReportRevision" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyReportRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyReportMedia" (
    "reportId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyReportMedia_pkey" PRIMARY KEY ("reportId","mediaId")
);

-- CreateTable
CREATE TABLE "MediaFile" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT,
    "scanStatus" "MediaScanStatus" NOT NULL DEFAULT 'PENDING',
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyReport_projectId_reportDate_idx" ON "DailyReport"("projectId", "reportDate");

-- CreateIndex
CREATE INDEX "DailyReport_status_idx" ON "DailyReport"("status");

-- CreateIndex
CREATE INDEX "DailyReportWorker_reportId_idx" ON "DailyReportWorker"("reportId");

-- CreateIndex
CREATE INDEX "DailyReportRevision_reportId_idx" ON "DailyReportRevision"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReportRevision_reportId_revisionNo_key" ON "DailyReportRevision"("reportId", "revisionNo");

-- CreateIndex
CREATE INDEX "DailyReportMedia_reportId_idx" ON "DailyReportMedia"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaFile_storageKey_key" ON "MediaFile"("storageKey");

-- AddForeignKey
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReportWorker" ADD CONSTRAINT "DailyReportWorker_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DailyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReportRevision" ADD CONSTRAINT "DailyReportRevision_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DailyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReportRevision" ADD CONSTRAINT "DailyReportRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReportMedia" ADD CONSTRAINT "DailyReportMedia_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DailyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReportMedia" ADD CONSTRAINT "DailyReportMedia_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaFile" ADD CONSTRAINT "MediaFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
