-- Operations workflow: per-customer pricing, business-configurable units,
-- variable-measure capture, delivery/receipt adjustments, payment reconciliation.
-- Additive only — no existing column is changed or dropped.

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('SHORTFALL', 'NOT_DELIVERED', 'OTHER');

-- AlterTable: Product configuration
ALTER TABLE "Product"
    ADD COLUMN "isVariableMeasure" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "orderUnits" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "estConversionPerOrderUnit" INTEGER;

-- AlterTable: OrderItem ordered-vs-billed fields
ALTER TABLE "OrderItem"
    ADD COLUMN "orderUnit" TEXT,
    ADD COLUMN "orderedQtyMilli" INTEGER,
    ADD COLUMN "capturedQtyMilli" INTEGER;

-- AlterTable: Payment reconciliation
ALTER TABLE "Payment"
    ADD COLUMN "reconciledAt" TIMESTAMP(3),
    ADD COLUMN "reconciledById" TEXT;

-- CreateTable: CustomerPrice
CREATE TABLE "CustomerPrice" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPrice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerPrice_businessId_clientId_productId_key" ON "CustomerPrice"("businessId", "clientId", "productId");
CREATE INDEX "CustomerPrice_businessId_clientId_idx" ON "CustomerPrice"("businessId", "clientId");
CREATE INDEX "CustomerPrice_businessId_productId_idx" ON "CustomerPrice"("businessId", "productId");

-- CreateTable: TarePreset
CREATE TABLE "TarePreset" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tareMilli" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TarePreset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TarePreset_businessId_idx" ON "TarePreset"("businessId");

-- CreateTable: OrderItemCapture
CREATE TABLE "OrderItemCapture" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "grossMilli" INTEGER NOT NULL,
    "tareMilli" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItemCapture_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrderItemCapture_orderItemId_idx" ON "OrderItemCapture"("orderItemId");

-- CreateTable: OrderAdjustment
CREATE TABLE "OrderAdjustment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "type" "AdjustmentType" NOT NULL,
    "fromQtyMilli" INTEGER,
    "toQtyMilli" INTEGER,
    "reason" TEXT NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderAdjustment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrderAdjustment_businessId_orderId_idx" ON "OrderAdjustment"("businessId", "orderId");

-- Foreign keys
ALTER TABLE "CustomerPrice" ADD CONSTRAINT "CustomerPrice_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerPrice" ADD CONSTRAINT "CustomerPrice_businessId_clientId_fkey" FOREIGN KEY ("businessId", "clientId") REFERENCES "Client"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerPrice" ADD CONSTRAINT "CustomerPrice_businessId_productId_fkey" FOREIGN KEY ("businessId", "productId") REFERENCES "Product"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TarePreset" ADD CONSTRAINT "TarePreset_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItemCapture" ADD CONSTRAINT "OrderItemCapture_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderAdjustment" ADD CONSTRAINT "OrderAdjustment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderAdjustment" ADD CONSTRAINT "OrderAdjustment_businessId_orderId_fkey" FOREIGN KEY ("businessId", "orderId") REFERENCES "Order"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
