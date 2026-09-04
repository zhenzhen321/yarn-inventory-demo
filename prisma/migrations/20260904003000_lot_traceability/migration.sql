-- 新批次/流水框架采用纯增量迁移：保留全部旧表和旧业务记录。
CREATE TABLE "InventoryLot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lotNo" TEXT NOT NULL,
    "scanCode" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'PURCHASE',
    "provenanceQuality" TEXT NOT NULL DEFAULT 'EXACT',
    "variantId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "initialWeight" DECIMAL NOT NULL,
    "initialPackages" INTEGER,
    "goodsCost" DECIMAL NOT NULL DEFAULT 0,
    "freightCost" DECIMAL NOT NULL DEFAULT 0,
    "processingCost" DECIMAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryLot_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "YarnVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryLot_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "InventoryLot_lotNo_key" ON "InventoryLot"("lotNo");
CREATE UNIQUE INDEX "InventoryLot_scanCode_key" ON "InventoryLot"("scanCode");
CREATE INDEX "InventoryLot_variantId_batchId_idx" ON "InventoryLot"("variantId", "batchId");
CREATE INDEX "InventoryLot_status_createdAt_idx" ON "InventoryLot"("status", "createdAt");

ALTER TABLE "PurchaseItem" ADD COLUMN "lotId" TEXT REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Inventory" ADD COLUMN "lotId" TEXT REFERENCES "InventoryLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Inventory" ADD COLUMN "packages" INTEGER;
ALTER TABLE "Inventory" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TransferItem" ADD COLUMN "destinationInventoryId" TEXT;
ALTER TABLE "ProcessingReturnItem" ADD COLUMN "outputLotId" TEXT;
ALTER TABLE "ProcessingReturnItem" ADD COLUMN "destinationInventoryId" TEXT;

-- 每条旧库存行生成一个独立的历史汇总批次。旧数据不做无法证明的采购归因。
INSERT INTO "InventoryLot" (
    "id", "lotNo", "scanCode", "sourceType", "provenanceQuality",
    "variantId", "batchId", "initialWeight", "initialPackages",
    "goodsCost", "freightCost", "processingCost", "status", "createdAt"
)
SELECT
    'legacy-' || "id",
    'LEGACY-' || substr("id", 1, 12),
    'YMS-L-LEGACY-' || "id",
    'LEGACY_AGGREGATED',
    'LEGACY_AGGREGATED',
    "variantId",
    "batchId",
    "weight",
    NULL,
    "cost",
    "freight",
    0,
    CASE
      WHEN "archived" = 1 THEN 'ARCHIVED'
      WHEN "weight" <= 0 THEN 'CONSUMED'
      ELSE 'AVAILABLE'
    END,
    "updatedAt"
FROM "Inventory";

UPDATE "Inventory" SET "lotId" = 'legacy-' || "id";

CREATE UNIQUE INDEX "PurchaseItem_lotId_key" ON "PurchaseItem"("lotId");
CREATE INDEX "Inventory_lotId_warehouseId_archived_idx" ON "Inventory"("lotId", "warehouseId", "archived");

CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lotId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "referenceItemId" TEXT,
    "fromWarehouseId" TEXT,
    "toWarehouseId" TEXT,
    "weight" DECIMAL NOT NULL,
    "packages" INTEGER,
    "goodsCost" DECIMAL NOT NULL DEFAULT 0,
    "freightCost" DECIMAL NOT NULL DEFAULT 0,
    "reversalOfId" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "StockMovement_lotId_occurredAt_idx" ON "StockMovement"("lotId", "occurredAt");
CREATE INDEX "StockMovement_referenceType_referenceId_idx" ON "StockMovement"("referenceType", "referenceId");

CREATE TABLE "SaleAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "saleItemId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "inventoryId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "weight" DECIMAL NOT NULL,
    "packages" INTEGER,
    "unitCost" DECIMAL NOT NULL,
    "unitFreight" DECIMAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaleAllocation_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SaleAllocation_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SaleAllocation_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "SaleAllocation_saleItemId_idx" ON "SaleAllocation"("saleItemId");
CREATE INDEX "SaleAllocation_lotId_createdAt_idx" ON "SaleAllocation"("lotId", "createdAt");

CREATE TABLE "ProcessingJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderNo" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "factoryId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "feeBasis" TEXT NOT NULL DEFAULT 'OUTPUT',
    "chargedWeight" DECIMAL NOT NULL,
    "feePerKg" DECIMAL NOT NULL,
    "feeTotal" DECIMAL NOT NULL,
    "outboundFreight" DECIMAL NOT NULL DEFAULT 0,
    "returnFreight" DECIMAL NOT NULL DEFAULT 0,
    "otherCost" DECIMAL NOT NULL DEFAULT 0,
    "inputWeight" DECIMAL NOT NULL,
    "outputWeight" DECIMAL NOT NULL,
    "weightDiff" DECIMAL NOT NULL,
    "handlerName" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcessingJob_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProcessingJob_orderNo_key" ON "ProcessingJob"("orderNo");
CREATE INDEX "ProcessingJob_factoryId_date_idx" ON "ProcessingJob"("factoryId", "date");

CREATE TABLE "ProcessingInput" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "weight" DECIMAL NOT NULL,
    "packages" INTEGER,
    "goodsCost" DECIMAL NOT NULL,
    "freightCost" DECIMAL NOT NULL,
    CONSTRAINT "ProcessingInput_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProcessingJob" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProcessingInput_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProcessingInput_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ProcessingInput_jobId_idx" ON "ProcessingInput"("jobId");
CREATE INDEX "ProcessingInput_lotId_idx" ON "ProcessingInput"("lotId");

CREATE TABLE "ProcessingOutput" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "weight" DECIMAL NOT NULL,
    "packages" INTEGER,
    "allocatedGoodsCost" DECIMAL NOT NULL,
    "allocatedFreight" DECIMAL NOT NULL,
    CONSTRAINT "ProcessingOutput_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProcessingJob" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProcessingOutput_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProcessingOutput_lotId_key" ON "ProcessingOutput"("lotId");
CREATE INDEX "ProcessingOutput_jobId_idx" ON "ProcessingOutput"("jobId");

ALTER TABLE "ProcessingFeeSettlement" ADD COLUMN "processingJobId" TEXT REFERENCES "ProcessingJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "ProcessingFeeSettlement_processingJobId_key" ON "ProcessingFeeSettlement"("processingJobId");
