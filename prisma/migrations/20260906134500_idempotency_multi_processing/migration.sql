-- 业务写请求幂等记录。记录与业务数据在同一事务内提交。
CREATE TABLE "IdempotencyRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "resourceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME
);

CREATE UNIQUE INDEX "IdempotencyRequest_operation_key_key"
ON "IdempotencyRequest"("operation", "key");
CREATE INDEX "IdempotencyRequest_createdAt_idx" ON "IdempotencyRequest"("createdAt");

-- 多投入多产出加工保存成本分配依据及各成本池的分配结果。
ALTER TABLE "ProcessingJob"
ADD COLUMN "costAllocationBasis" TEXT NOT NULL DEFAULT 'OUTPUT_WEIGHT';

ALTER TABLE "ProcessingOutput"
ADD COLUMN "allocationWeight" DECIMAL NOT NULL DEFAULT 0;
ALTER TABLE "ProcessingOutput"
ADD COLUMN "allocatedProcessingCost" DECIMAL NOT NULL DEFAULT 0;
ALTER TABLE "ProcessingOutput"
ADD COLUMN "allocatedOtherCost" DECIMAL NOT NULL DEFAULT 0;

UPDATE "ProcessingOutput" SET "allocationWeight" = "weight";
UPDATE "ProcessingOutput"
SET "allocatedProcessingCost" = COALESCE((
  SELECT "processingCost" FROM "InventoryLot"
  WHERE "InventoryLot"."id" = "ProcessingOutput"."lotId"
), 0);
