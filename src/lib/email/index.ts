import fs from "node:fs/promises";
import path from "node:path";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailAdapter {
  send(message: EmailMessage): Promise<void>;
}

/** Development adapter: logs to the console and writes each email to .dev-mail/. */
export class ConsoleEmailAdapter implements EmailAdapter {
  constructor(private readonly dir = process.env.DEV_MAIL_DIR ?? path.join(process.cwd(), ".dev-mail")) {}

  async send(message: EmailMessage) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeTo = message.to.replace(/[^a-z0-9@._-]/gi, "_");
    const body = `To: ${message.to}\nSubject: ${message.subject}\nDate: ${new Date().toISOString()}\n\n${message.text}\n`;
    console.info(`\n[email] -> ${message.to}: ${message.subject}\n${message.text}\n`);
    try {
      await fs.mkdir(this.dir, { recursive: true });
      await fs.writeFile(path.join(this.dir, `${stamp}_${safeTo}.txt`), body);
    } catch (err) {
      console.warn("[email] could not write dev mail file", err);
    }
  }
}

/** Production adapter: any SMTP provider (SES, Postmark, Mailgun, SendGrid...). */
export class SmtpEmailAdapter implements EmailAdapter {
  private transport: import("nodemailer").Transporter | null = null;

  constructor(
    private readonly url: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage) {
    if (!this.transport) {
      const nodemailer = await import("nodemailer");
      this.transport = nodemailer.createTransport(this.url);
    }
    await this.transport.sendMail({ from: this.from, ...message });
  }
}

/**
 * Amazon SES via its API. Region and credentials are read from SES-prefixed
 * variables (SES_AWS_REGION, SES_AWS_ACCESS_KEY_ID, SES_AWS_SECRET_ACCESS_KEY)
 * so they don't collide with the reserved AWS_* names some hosts forbid (e.g.
 * Netlify). When no explicit credentials are supplied, the AWS SDK's default
 * chain (shared config or an instance/task role) is used instead.
 */
export class SesEmailAdapter implements EmailAdapter {
  private client: import("@aws-sdk/client-sesv2").SESv2Client | null = null;

  constructor(
    private readonly region: string,
    private readonly from: string,
    private readonly credentials?: { accessKeyId: string; secretAccessKey: string },
  ) {}

  async send(message: EmailMessage) {
    const { SESv2Client, SendEmailCommand } = await import("@aws-sdk/client-sesv2");
    // Pass credentials explicitly: with the SES_AWS_* names the SDK's default
    // chain can no longer discover them on its own.
    this.client ??= new SESv2Client({ region: this.region, ...(this.credentials ? { credentials: this.credentials } : {}) });
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: "UTF-8" },
            Body: {
              Text: { Data: message.text, Charset: "UTF-8" },
              ...(message.html ? { Html: { Data: message.html, Charset: "UTF-8" } } : {}),
            },
          },
        },
      }),
    );
  }
}

/** Collects messages in memory - used by tests. */
export class MemoryEmailAdapter implements EmailAdapter {
  sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
  }
}

let override: EmailAdapter | null = null;
let cached: { key: string; adapter: EmailAdapter } | null = null;
export function setEmailAdapter(adapter: EmailAdapter | null) {
  override = adapter;
}

export function getEmailAdapter(): EmailAdapter {
  if (override) return override;
  const provider = process.env.EMAIL_PROVIDER ?? (process.env.NODE_ENV === "production" ? "smtp" : "console");
  const from = process.env.EMAIL_FROM ?? "RelayDesk <no-reply@example.com>";
  if (provider === "smtp") {
    const url = process.env.SMTP_URL;
    if (!url) throw new Error("EMAIL_PROVIDER=smtp requires SMTP_URL");
    const key = `smtp|${url}|${from}`;
    if (cached?.key !== key) cached = { key, adapter: new SmtpEmailAdapter(url, from) };
    return cached.adapter;
  }
  if (provider === "ses") {
    const region = process.env.SES_AWS_REGION;
    if (!region) throw new Error("EMAIL_PROVIDER=ses requires SES_AWS_REGION");
    const accessKeyId = process.env.SES_AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.SES_AWS_SECRET_ACCESS_KEY;
    if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
      throw new Error("Set both SES_AWS_ACCESS_KEY_ID and SES_AWS_SECRET_ACCESS_KEY, or neither (to use an instance/task role).");
    }
    const credentials = accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined;
    const key = `ses|${region}|${from}|${accessKeyId ?? "role"}`;
    if (cached?.key !== key) cached = { key, adapter: new SesEmailAdapter(region, from, credentials) };
    return cached.adapter;
  }
  return new ConsoleEmailAdapter();
}

export async function sendEmail(message: EmailMessage) {
  await getEmailAdapter().send(message);
}

/**
 * Send without throwing: used after the related database work has committed,
 * so a mail outage cannot leave the user facing an error for an action that
 * actually succeeded. Returns whether delivery was accepted.
 */
export async function trySendEmail(message: EmailMessage): Promise<boolean> {
  try {
    await sendEmail(message);
    return true;
  } catch (err) {
    console.error(`[email] delivery to ${message.to} failed: ${(err as Error).message}`);
    return false;
  }
}

export function appUrl(pathname = "/") {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${pathname}`;
}
