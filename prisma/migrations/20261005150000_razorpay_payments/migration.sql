-- Razorpay payments: platform SaaS billing (supplier pays RelayDesk) and
-- end-customer order payments (settle to the supplier's own Razorpay account).
-- Additive only.

-- AlterEnum: online payment method
ALTER TYPE "PaymentMethod" ADD VALUE 'RAZORPAY';

-- AlterTable: supplier's own Razorpay credentials (for collecting order payments)
ALTER TABLE "Business"
    ADD COLUMN "razorpayKeyId" TEXT,
    ADD COLUMN "razorpayKeySecret" TEXT,
    ADD COLUMN "razorpayWebhookSecret" TEXT;

-- AlterTable: map a pricing tier to a Razorpay Plan (platform SaaS billing)
ALTER TABLE "PricingPlan" ADD COLUMN "razorpayPlanId" TEXT;

-- AlterTable: Razorpay SaaS-subscription identifiers (platform account)
ALTER TABLE "Subscription"
    ADD COLUMN "razorpayCustomerId" TEXT,
    ADD COLUMN "razorpaySubscriptionId" TEXT;
CREATE UNIQUE INDEX "Subscription_razorpaySubscriptionId_key" ON "Subscription"("razorpaySubscriptionId");

-- AlterTable: Razorpay references on a recorded order payment
ALTER TABLE "Payment"
    ADD COLUMN "razorpayOrderId" TEXT,
    ADD COLUMN "razorpayPaymentId" TEXT;
CREATE UNIQUE INDEX "Payment_razorpayPaymentId_key" ON "Payment"("razorpayPaymentId");
