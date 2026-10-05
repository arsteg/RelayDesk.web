/**
 * Startup configuration check. In production, misconfiguration that would
 * silently lose data or break security fails the boot; softer issues warn.
 */
export interface EnvReport {
  errors: string[];
  warnings: string[];
}

export function checkEnv(env: NodeJS.ProcessEnv = process.env): EnvReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const prod = env.NODE_ENV === "production";

  if (!env.DATABASE_URL) errors.push("DATABASE_URL is required.");

  if (!env.APP_URL) (prod ? errors : warnings).push("APP_URL is not set; links in emails will point to http://localhost:3000.");
  else if (prod && !env.APP_URL.startsWith("https://")) warnings.push("APP_URL should use https:// in production.");

  const provider = env.EMAIL_PROVIDER ?? (prod ? "smtp" : "console");
  if (!["console", "smtp", "ses"].includes(provider)) errors.push(`EMAIL_PROVIDER must be "console", "smtp" or "ses" (got "${provider}").`);
  if (provider === "smtp" && !env.SMTP_URL) errors.push("EMAIL_PROVIDER=smtp requires SMTP_URL.");
  if (provider === "ses") {
    if (!env.SES_AWS_REGION) errors.push("EMAIL_PROVIDER=ses requires SES_AWS_REGION.");
    const hasId = Boolean(env.SES_AWS_ACCESS_KEY_ID);
    const hasSecret = Boolean(env.SES_AWS_SECRET_ACCESS_KEY);
    if (hasId !== hasSecret) errors.push("Set both SES_AWS_ACCESS_KEY_ID and SES_AWS_SECRET_ACCESS_KEY, or neither.");
    if (prod && !hasId) warnings.push("EMAIL_PROVIDER=ses without SES_AWS_ACCESS_KEY_ID/SES_AWS_SECRET_ACCESS_KEY relies on the AWS default credential chain (instance/task role); hosts like Netlify need explicit SES_AWS_* credentials.");
  }
  if (prod && provider === "console" && env.ALLOW_CONSOLE_EMAIL !== "1") {
    errors.push("EMAIL_PROVIDER=console in production would drop verification, reset and invitation emails. Configure SMTP (or set ALLOW_CONSOLE_EMAIL=1 for a staging box).");
  }
  if (prod && !env.EMAIL_FROM) warnings.push("EMAIL_FROM is not set; a placeholder sender address will be used.");

  if (env.STRIPE_SECRET_KEY) {
    for (const k of ["STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_STARTER", "STRIPE_PRICE_PRO"]) {
      if (!env[k]) errors.push(`${k} is required when STRIPE_SECRET_KEY is set.`);
    }
    if (prod && env.STRIPE_SECRET_KEY.startsWith("sk_test_")) warnings.push("STRIPE_SECRET_KEY is a test-mode key.");
  } else if (prod && env.BILLING_ENABLED === "true") {
    warnings.push("STRIPE_SECRET_KEY is not set: subscriptions cannot be purchased (the dev simulator is disabled in production).");
  }

  if (!env.CRON_SECRET || env.CRON_SECRET === "change-me" || env.CRON_SECRET.length < 16) {
    (prod ? warnings : []).push("CRON_SECRET is missing or weak: /api/cron/daily will reject all calls.");
  }
  if (prod && !env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY) {
    warnings.push("NEXT_SERVER_ACTIONS_ENCRYPTION_KEY is not set: required when running more than one app instance.");
  }
  const hops = env.TRUSTED_PROXY_HOPS;
  if (hops !== undefined && !/^\d+$/.test(hops)) errors.push("TRUSTED_PROXY_HOPS must be a non-negative integer.");
  return { errors, warnings };
}
