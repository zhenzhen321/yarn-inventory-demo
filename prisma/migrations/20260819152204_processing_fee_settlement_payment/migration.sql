-- CreateTable
CREATE TABLE "ProcessingFeeSettlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "warehouseId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "inputWeight" DECIMAL NOT NULL,
    "outputWeight" DECIMAL NOT NULL,
    "feePerKg" DECIMAL NOT NULL,
    "feeTotal" DECIMAL NOT NULL,
    "remainingWeight" DECIMAL NOT NULL,
    "newUnitCost" DECIMAL NOT NULL,
    "handlerName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcessingFeeSettlement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProcessingFeeSettlement_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "YarnVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProcessingFeePayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "factoryId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "date" DATETIME NOT NULL,
    "method" TEXT,
    "handlerName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcessingFeePayment_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProcessingFeeSettlement_warehouseId_createdAt_idx" ON "ProcessingFeeSettlement"("warehouseId", "createdAt");

-- CreateIndex
CREATE INDEX "ProcessingFeePayment_factoryId_date_idx" ON "ProcessingFeePayment"("factoryId", "date");
