-- CreateTable
CREATE TABLE "SyncEvent" (
    "seq" BIGSERIAL NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "projectId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,

    CONSTRAINT "SyncEvent_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "SyncMutationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientMutationId" TEXT NOT NULL,
    "mutationType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "serverId" TEXT,
    "version" INTEGER,
    "errorJson" JSONB,
    "resultJson" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncMutationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncEvent_projectId_seq_idx" ON "SyncEvent"("projectId", "seq");

-- CreateIndex
CREATE INDEX "SyncEvent_entityType_entityId_seq_idx" ON "SyncEvent"("entityType", "entityId", "seq");

-- CreateIndex
CREATE INDEX "SyncMutationLog_userId_processedAt_idx" ON "SyncMutationLog"("userId", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncMutationLog_userId_clientMutationId_key" ON "SyncMutationLog"("userId", "clientMutationId");
