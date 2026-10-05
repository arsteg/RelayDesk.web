import type { Db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export interface AuditActor {
  userId: string | null;
  email?: string | null;
}

export async function audit(
  db: Db,
  entry: {
    businessId: string | null;
    actor: AuditActor | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Prisma.InputJsonValue;
    scope?: "business" | "platform" | "system" | "user";
  },
) {
  await db.auditLog.create({
    data: {
      businessId: entry.businessId,
      actorUserId: entry.actor?.userId ?? null,
      actorEmail: entry.actor?.email ?? null,
      scope: entry.scope ?? "business",
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata,
    },
  });
}
