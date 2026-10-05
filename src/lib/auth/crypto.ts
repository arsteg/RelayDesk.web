import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Tokens (sessions, resets, invitations) are stored only as SHA-256 hashes. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Used to keep login timing similar whether or not the email exists.
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO5m5jXQ5bGvO6v6qbbQe4rS3wK5c4F2e";
export async function burnPasswordCheck(password: string) {
  await bcrypt.compare(password, DUMMY_HASH).catch(() => false);
}
