import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { authenticate, requestPasswordReset, resetPassword, sendVerificationEmail, verifyEmail } from "@/server/auth";
import { mailbox } from "./setup";
import { createUser, resetDb } from "./helpers";

const tokenFrom = (text: string, marker = "token=") => decodeURIComponent(text.split(marker)[1].split(/\s/)[0]);
const mailWith = (subjectPart: string) => mailbox.sent.find((m) => m.subject.includes(subjectPart))!;

beforeEach(async () => {
  await resetDb();
  mailbox.sent = [];
});

describe("verification and reset token lifecycle", () => {
  it("rejects an expired verification token and leaves the user unverified", async () => {
    const u = await createUser("v@x.test", { verified: false });
    await sendVerificationEmail(u.id);
    const token = tokenFrom(mailbox.sent[0].text);
    await prisma.authToken.updateMany({ where: { userId: u.id, type: "EMAIL_VERIFICATION" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await verifyEmail(token)).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).emailVerifiedAt).toBeNull();
  });

  it("rejects an expired password-reset token", async () => {
    await createUser("r@x.test");
    await requestPasswordReset("r@x.test");
    const token = tokenFrom(mailbox.sent[0].text);
    await prisma.authToken.updateMany({ where: { type: "PASSWORD_RESET" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await resetPassword(token, "placeholder-pw")).toBe(false);
    // Original password still works.
    expect(await authenticate("r@x.test", "correct horse battery")).toBeTruthy();
  });

  it("does not accept a reset token for verification, nor a verification token for reset", async () => {
    const u = await createUser("x@x.test", { verified: false });
    await sendVerificationEmail(u.id);
    const verifyToken = tokenFrom(mailWith("Verify").text);
    await requestPasswordReset("x@x.test");
    const resetToken = tokenFrom(mailWith("Reset").text);

    expect(await resetPassword(verifyToken, "placeholder-pw")).toBe(false);
    expect(await verifyEmail(resetToken)).toBe(false);
  });

  it("invalidates the previous verification token when a new one is issued", async () => {
    const u = await createUser("n@x.test", { verified: false });
    await sendVerificationEmail(u.id);
    const first = tokenFrom(mailbox.sent[0].text);
    await sendVerificationEmail(u.id);
    const second = tokenFrom(mailbox.sent[1].text);
    expect(await verifyEmail(first)).toBe(false);
    expect(await verifyEmail(second)).toBe(true);
  });

  it("invalidates the previous reset token when a new one is issued", async () => {
    await createUser("m@x.test");
    await requestPasswordReset("m@x.test");
    const first = tokenFrom(mailbox.sent[0].text);
    await requestPasswordReset("m@x.test");
    const second = tokenFrom(mailbox.sent[1].text);
    expect(await resetPassword(first, "placeholder-pw")).toBe(false);
    expect(await resetPassword(second, "brand-new-password")).toBe(true);
    expect(await authenticate("m@x.test", "brand-new-password")).toBeTruthy();
  });
});
