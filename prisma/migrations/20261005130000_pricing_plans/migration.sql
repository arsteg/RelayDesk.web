-- Operator-editable pricing plan attributes. Seeded with the built-in STARTER
-- and PRO defaults so behaviour is unchanged until an operator edits them.

-- CreateTable
CREATE TABLE "PricingPlan" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priceLabel" TEXT NOT NULL,
    "maxMembers" INTEGER,
    "maxMonthlyOrders" INTEGER,
    "stripePriceId" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingPlan_pkey" PRIMARY KEY ("code")
);

-- Seed defaults (idempotent). Mirrors src/lib/plans.ts built-in values.
INSERT INTO "PricingPlan"
    ("code", "name", "description", "priceLabel", "maxMembers", "maxMonthlyOrders", "stripePriceId", "isPublic", "isActive", "sortOrder", "createdAt", "updatedAt")
VALUES
    ('STARTER', 'Starter', 'For solo owners and small teams getting started.', '₹999 / month', 3, 200, NULL, true, true, 0, now(), now()),
    ('PRO', 'Pro', 'For busy teams that need more seats and unlimited orders.', '₹2,499 / month', 25, NULL, NULL, true, true, 1, now(), now())
ON CONFLICT ("code") DO NOTHING;
