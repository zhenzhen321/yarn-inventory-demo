-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Inventory_variantId_batchId_idx" ON "Inventory"("variantId", "batchId");

-- CreateIndex
CREATE INDEX "ProcessingReturnItem_orderId_idx" ON "ProcessingReturnItem"("orderId");

-- CreateIndex
CREATE INDEX "PurchaseItem_orderId_idx" ON "PurchaseItem"("orderId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "SaleItem_orderId_idx" ON "SaleItem"("orderId");

-- CreateIndex
CREATE INDEX "SaleOrder_customerId_idx" ON "SaleOrder"("customerId");

-- CreateIndex
CREATE INDEX "Settlement_counterpartyId_date_idx" ON "Settlement"("counterpartyId", "date");

-- CreateIndex
CREATE INDEX "StocktakeItem_stocktakeId_idx" ON "StocktakeItem"("stocktakeId");

-- CreateIndex
CREATE INDEX "TransferItem_orderId_idx" ON "TransferItem"("orderId");
