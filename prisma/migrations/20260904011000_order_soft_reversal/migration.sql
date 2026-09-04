-- Keep purchase and sale documents after a reversal so lot provenance remains auditable.
ALTER TABLE "PurchaseOrder" ADD COLUMN "reversedAt" DATETIME;
ALTER TABLE "PurchaseOrder" ADD COLUMN "reversedBy" TEXT;
ALTER TABLE "SaleOrder" ADD COLUMN "reversedAt" DATETIME;
ALTER TABLE "SaleOrder" ADD COLUMN "reversedBy" TEXT;

CREATE INDEX "PurchaseOrder_reversedAt_date_idx" ON "PurchaseOrder"("reversedAt", "date");
CREATE INDEX "SaleOrder_reversedAt_date_idx" ON "SaleOrder"("reversedAt", "date");
