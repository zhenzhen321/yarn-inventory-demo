-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Inventory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "warehouseId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "weight" DECIMAL NOT NULL,
    "cost" DECIMAL NOT NULL DEFAULT 0,
    "freight" DECIMAL NOT NULL DEFAULT 0,
    "processingFeeSettled" BOOLEAN NOT NULL DEFAULT false,
    "processingFeePerKg" DECIMAL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Inventory_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Inventory_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "YarnVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Inventory_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Inventory" ("batchId", "cost", "freight", "id", "updatedAt", "variantId", "warehouseId", "weight") SELECT "batchId", "cost", "freight", "id", "updatedAt", "variantId", "warehouseId", "weight" FROM "Inventory";
DROP TABLE "Inventory";
ALTER TABLE "new_Inventory" RENAME TO "Inventory";
CREATE UNIQUE INDEX "Inventory_warehouseId_variantId_batchId_key" ON "Inventory"("warehouseId", "variantId", "batchId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
