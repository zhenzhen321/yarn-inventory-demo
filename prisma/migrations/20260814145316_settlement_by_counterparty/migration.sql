/*
  Warnings:

  - You are about to drop the column `orderId` on the `Settlement` table. All the data in the column will be lost.
  - You are about to drop the column `orderType` on the `Settlement` table. All the data in the column will be lost.
  - Added the required column `counterpartyId` to the `Settlement` table without a default value. This is not possible if the table is not empty.
  - Added the required column `side` to the `Settlement` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Settlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "side" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "date" DATETIME NOT NULL,
    "method" TEXT,
    "handlerName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Settlement_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Settlement" ("amount", "createdAt", "date", "handlerName", "id", "method") SELECT "amount", "createdAt", "date", "handlerName", "id", "method" FROM "Settlement";
DROP TABLE "Settlement";
ALTER TABLE "new_Settlement" RENAME TO "Settlement";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
