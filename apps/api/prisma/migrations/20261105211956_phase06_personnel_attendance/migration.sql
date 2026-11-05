-- CreateEnum
CREATE TYPE "PersonnelStatus" AS ENUM ('ACTIVE', 'PASSIVE');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('WEB', 'MOBILE', 'API');

-- CreateTable
CREATE TABLE "Personnel" (
    "id" TEXT NOT NULL,
    "employeeCode" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "jobTitle" TEXT,
    "companyOrSubcontractor" TEXT,
    "status" "PersonnelStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Personnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "siteId" TEXT,
    "personnelId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "shiftKey" TEXT NOT NULL DEFAULT 'GUNDUZ',
    "status" TEXT NOT NULL DEFAULT 'PRESENT',
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "workedMinutes" INTEGER,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "source" "AttendanceSource" NOT NULL DEFAULT 'WEB',
    "clientMutationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "attendanceCustomStatuses" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Personnel_employeeCode_key" ON "Personnel"("employeeCode");

-- CreateIndex
CREATE INDEX "Personnel_status_fullName_idx" ON "Personnel"("status", "fullName");

-- CreateIndex
CREATE INDEX "Personnel_fullName_idx" ON "Personnel"("fullName");

-- CreateIndex
CREATE INDEX "AttendanceRecord_projectId_workDate_idx" ON "AttendanceRecord"("projectId", "workDate");

-- CreateIndex
CREATE INDEX "AttendanceRecord_personnelId_workDate_idx" ON "AttendanceRecord"("personnelId", "workDate");

-- CreateIndex
CREATE INDEX "AttendanceRecord_personnelId_projectId_workDate_idx" ON "AttendanceRecord"("personnelId", "projectId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_personnelId_projectId_workDate_shiftKey_key" ON "AttendanceRecord"("personnelId", "projectId", "workDate", "shiftKey");

-- AddForeignKey
ALTER TABLE "Personnel" ADD CONSTRAINT "Personnel_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "Personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
