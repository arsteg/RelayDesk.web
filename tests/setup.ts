import "dotenv/config";
import { afterAll } from "vitest";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
// The suite covers billing and sign-up flows; both are off by default.
process.env.BILLING_ENABLED = "true";
process.env.SIGNUP_ENABLED = "true";
process.env.STRIPE_SECRET_KEY = "";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
process.env.STRIPE_PRICE_STARTER = "price_starter_test";
process.env.STRIPE_PRICE_PRO = "price_pro_test";

const { setEmailAdapter, MemoryEmailAdapter } = await import("@/lib/email");
export const mailbox = new MemoryEmailAdapter();
setEmailAdapter(mailbox);

afterAll(async () => {
  const { prisma } = await import("@/lib/db");
  await prisma.$disconnect();
});
