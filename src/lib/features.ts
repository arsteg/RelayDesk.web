/**
 * Deployment-wide switches. Both are off unless explicitly set to "true":
 * - SIGNUP_ENABLED: public registration, account creation from invitations and
 *   creating new businesses. When off, `npm run accounts:create` sets these up.
 * - BILLING_ENABLED: subscriptions, trials and plan limits. When off, every
 *   workspace has full access with no plan limits and billing pages are hidden.
 * CHANGE_EMAILS_ENABLED is the exception: on unless set to "false". It emails all
 * members of a business when clients, orders or payments change.
 */
export const signupEnabled = () => process.env.SIGNUP_ENABLED === "true";
export const billingEnabled = () => process.env.BILLING_ENABLED === "true";
export const changeEmailsEnabled = () => process.env.CHANGE_EMAILS_ENABLED !== "false";
