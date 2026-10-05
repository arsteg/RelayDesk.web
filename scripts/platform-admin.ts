/**
 * Grant or revoke platform-admin rights (separate from business roles).
 *   npm run platform-admin -- grant you@company.com
 *   npm run platform-admin -- revoke you@company.com
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { audit } from "../src/lib/audit";

async function main() {
  const [cmd, rawEmail] = process.argv.slice(2);
  const email = rawEmail?.trim().toLowerCase();
  if (!["grant", "revoke"].includes(cmd ?? "") || !email) {
    console.error("Usage: npm run platform-admin -- <grant|revoke> <email>");
    process.exitCode = 1;
    return;
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user with email ${email}. They must register first.`);
    process.exitCode = 1;
    return;
  }
  const isPlatformAdmin = cmd === "grant";
  await prisma.user.update({ where: { id: user.id }, data: { isPlatformAdmin } });
  if (!isPlatformAdmin) await prisma.session.deleteMany({ where: { userId: user.id } });
  await audit(prisma, {
    businessId: null,
    actor: null,
    scope: "platform",
    action: isPlatformAdmin ? "platform_admin.granted" : "platform_admin.revoked",
    entityType: "User",
    entityId: user.id,
    metadata: { email, via: "cli" },
  });
  console.log(`${isPlatformAdmin ? "Granted" : "Revoked"} platform admin for ${email}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
