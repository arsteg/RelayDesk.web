export const dynamic = "force-dynamic";

import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui";
import { billingEnabled, signupEnabled } from "@/lib/features";
import { getPlans } from "@/lib/plans";

export default async function Home() {
  const billing = billingEnabled();
  const signup = signupEnabled();
  const plans = billing ? Object.values(await getPlans()) : [];
  const startLabel = billing ? "Start free trial" : "Create account";
  const startHref = "/register";

  return (
    <main className="bg-stone-50 text-stone-900">
      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-stone-200/80 bg-stone-50/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Logo />
            RelayDesk
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-medium text-stone-600 md:flex">
            <a href="#how" className="hover:text-stone-900">How it works</a>
            <a href="#features" className="hover:text-stone-900">Features</a>
            <a href="#usecases" className="hover:text-stone-900">Who it&apos;s for</a>
            {plans.length > 0 && <a href="#pricing" className="hover:text-stone-900">Pricing</a>}
            <a href="#faq" className="hover:text-stone-900">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <ButtonLink href="/login" variant="ghost" size="sm">Sign in</ButtonLink>
            {signup && <ButtonLink href={startHref} size="sm">{startLabel}</ButtonLink>}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-32 -z-10 h-96 bg-gradient-to-b from-brand-100/70 to-transparent blur-2xl" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-14 sm:pt-20 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
              Orders · clients · payments, in one place
            </span>
            <h1 className="mt-5 text-pretty text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
              Every order, deposit and balance — in one ledger you trust.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-stone-600">
              Custom and recurring orders shouldn&apos;t live in a notebook and three chat threads. RelayDesk tracks
              what&apos;s due today, who has paid a deposit, what balance is owed, and prints a branded invoice — so
              nothing slips and everyone&apos;s on the same page.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {signup && <ButtonLink href={startHref} size="md">{startLabel}</ButtonLink>}
              <ButtonLink href="/login" variant={signup ? "secondary" : "primary"} size="md">
                Sign in
              </ButtonLink>
            </div>
            <p className="mt-4 text-sm text-stone-500">
              {billing ? "14-day free trial · no card required · cancel anytime." : "Built for small teams · your data is always exportable."}
            </p>
          </div>

          {/* Product mock */}
          <div className="relative">
            <OrderCardMock />
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="border-y border-stone-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-14 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            The order is easy. Remembering everything around it isn&apos;t.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-stone-600">
            A deposit taken on UPI last week. A delivery due at 6pm. A balance someone swears they already paid.
            When it&apos;s scattered across chats and paper, something always falls through — usually the money.
          </p>
          <div className="mx-auto mt-10 grid max-w-3xl gap-4 text-left sm:grid-cols-3">
            {[
              ["Missed balances", "Orders delivered, balance never collected."],
              ["Double-booked days", "No single view of what's due and when."],
              ["“Did they pay?”", "Deposits and refunds with no paper trail."],
            ].map(([t, d]) => (
              <div key={t} className="rounded-xl bg-stone-50 p-4 ring-1 ring-stone-200">
                <p className="text-sm font-semibold text-stone-900">{t}</p>
                <p className="mt-1 text-sm text-stone-600">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
        <SectionHeading eyebrow="How it works" title="From enquiry to paid in three steps" />
        <ol className="mt-10 grid gap-6 md:grid-cols-3">
          {[
            ["01", "Log the order", "Add the client, items, quantities and the date it's due. Pricing, tax and totals are calculated for you."],
            ["02", "Take a deposit", "Record a deposit or partial payment against the order. RelayDesk tracks the running balance automatically."],
            ["03", "Deliver & get paid", "Mark it ready, collect the balance, and send a branded invoice. Every change is logged."],
          ].map(([n, t, d]) => (
            <li key={n} className="relative rounded-2xl bg-white p-6 shadow-xs ring-1 ring-stone-200">
              <span className="text-sm font-semibold text-brand-600">{n}</span>
              <h3 className="mt-2 text-lg font-semibold">{t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-stone-200 bg-white">
        <div className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
          <SectionHeading eyebrow="Everything in one place" title="Run the whole order, not just the sale" />
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl bg-stone-50 p-6 ring-1 ring-stone-200">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-100 text-brand-700">{f.icon}</div>
                <h3 className="mt-4 text-base font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-stone-600">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section id="usecases" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
        <SectionHeading
          eyebrow="Who it&apos;s for"
          title="Made for order-driven businesses"
          subtitle="If customers place orders in advance, pay in parts, and expect them on a date — RelayDesk fits."
        />
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          {[
            "Cake studios & home bakers",
            "Catering & tiffin services",
            "Print, signage & framing",
            "Boutique & made-to-order goods",
            "Repair & service shops",
            "Florists & event décor",
          ].map((u) => (
            <span key={u} className="rounded-full bg-white px-4 py-2 text-sm font-medium text-stone-700 ring-1 ring-stone-200">
              {u}
            </span>
          ))}
        </div>
      </section>

      {/* Trust */}
      <section className="border-y border-stone-200 bg-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 lg:grid-cols-2">
          <div>
            <SectionHeading eyebrow="Built to be trusted" title="Your records, kept straight" align="left" />
            <ul className="mt-6 space-y-4">
              {[
                ["Separated by business", "Each business's data is isolated at the database level — one workspace can never see another's."],
                ["A real audit trail", "Payments are never edited or deleted — they're voided with a reason and re-recorded, so the history always adds up."],
                ["Roles that fit a team", "Owner, admin and staff roles decide who can change prices, void payments or invite people."],
                ["Your data is yours", "Export clients, orders and payments to CSV whenever you want. No lock-in."],
              ].map(([t, d]) => (
                <li key={t} className="flex gap-3">
                  <CheckIcon />
                  <div>
                    <p className="font-medium text-stone-900">{t}</p>
                    <p className="mt-0.5 text-sm text-stone-600">{d}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl bg-gradient-to-br from-brand-50 to-stone-50 p-8 ring-1 ring-brand-100">
            <h3 className="text-lg font-semibold">Let customers order themselves</h3>
            <p className="mt-2 text-sm leading-relaxed text-stone-600">
              Invite a customer and they get their own simple ordering portal — browse your catalogue, place an order,
              and watch its status update <span className="font-medium text-stone-800">live</span> as you move it from
              confirmed to ready. New orders land on your dashboard the moment they&apos;re placed.
            </p>
            <dl className="mt-6 grid grid-cols-3 gap-4 text-center">
              {[
                ["Live", "status updates"],
                ["Web + app", "customer ordering"],
                ["One", "shared ledger"],
              ].map(([v, l]) => (
                <div key={l} className="rounded-xl bg-white/70 p-3 ring-1 ring-stone-200">
                  <dt className="text-xl font-bold text-brand-700">{v}</dt>
                  <dd className="mt-0.5 text-xs text-stone-600">{l}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* Pricing */}
      {plans.length > 0 && (
        <section id="pricing" className="mx-auto max-w-5xl scroll-mt-20 px-4 py-16">
          <SectionHeading eyebrow="Pricing" title="Simple plans, no surprises" subtitle="Start free for 14 days. Upgrade when you&apos;re ready — your data stays either way." />
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {plans.map((p, i) => (
              <div
                key={p.id}
                className={`relative rounded-2xl bg-white p-7 shadow-xs ring-1 ${i === plans.length - 1 ? "ring-2 ring-brand-500" : "ring-stone-200"}`}
              >
                {i === plans.length - 1 && (
                  <span className="absolute -top-3 right-6 rounded-full bg-brand-600 px-3 py-0.5 text-xs font-semibold text-white">
                    Most popular
                  </span>
                )}
                <h3 className="text-lg font-semibold">{p.name}</h3>
                <p className="mt-1 text-sm text-stone-500">{p.description}</p>
                <p className="mt-5 text-3xl font-bold tracking-tight">{p.priceLabel}</p>
                <ul className="mt-6 space-y-2.5 text-sm text-stone-600">
                  <li className="flex gap-2"><CheckIcon sm /> {p.maxMembers ?? "Unlimited"} team members</li>
                  <li className="flex gap-2"><CheckIcon sm /> {p.maxMonthlyOrders ?? "Unlimited"} orders per month</li>
                  <li className="flex gap-2"><CheckIcon sm /> Deposits, balances &amp; refunds</li>
                  <li className="flex gap-2"><CheckIcon sm /> Branded invoices &amp; CSV export</li>
                  <li className="flex gap-2"><CheckIcon sm /> Customer self-ordering &amp; live status</li>
                </ul>
                {signup && (
                  <ButtonLink href={startHref} variant={i === plans.length - 1 ? "primary" : "secondary"} className="mt-7 w-full">
                    {startLabel}
                  </ButtonLink>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* FAQ */}
      <section id="faq" className="border-t border-stone-200 bg-white">
        <div className="mx-auto max-w-3xl scroll-mt-20 px-4 py-16">
          <SectionHeading eyebrow="FAQ" title="Questions, answered" />
          <div className="mt-8 divide-y divide-stone-200 overflow-hidden rounded-2xl ring-1 ring-stone-200">
            {FAQS.map((f) => (
              <details key={f.q} className="group bg-white open:bg-stone-50">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-medium text-stone-900">
                  {f.q}
                  <span className="text-lg leading-none text-stone-400 transition group-open:rotate-45">+</span>
                </summary>
                <p className="px-5 pb-5 text-sm leading-relaxed text-stone-600">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 to-brand-700 px-6 py-14 text-center text-white sm:px-12">
          <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight">
            Stop chasing balances. Start today.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-brand-50">
            Set up your business in a minute and log your first order before the kettle boils.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {signup && (
              <ButtonLink href={startHref} variant="secondary" size="md">
                {startLabel}
              </ButtonLink>
            )}
            <ButtonLink
              href="/login"
              size="md"
              className="bg-white/10 text-white ring-1 ring-inset ring-white/40 hover:bg-white/20"
            >
              Sign in
            </ButtonLink>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-stone-500 sm:flex-row">
          <span className="flex items-center gap-2">
            <Logo sm /> © RelayDesk
          </span>
          <div className="flex gap-5">
            <a href="#features" className="hover:text-stone-900">Features</a>
            {plans.length > 0 && <a href="#pricing" className="hover:text-stone-900">Pricing</a>}
            <Link href="/login" className="hover:text-stone-900">Sign in</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

/* ---------------------------------------------------------------- content */

const FEATURES: { title: string; body: string; icon: ReactNode }[] = [
  { title: "Orders & scheduling", body: "Every order with its items, due date, pickup or delivery, and status from draft to completed — see what's due today at a glance.", icon: <IconClipboard /> },
  { title: "Deposits & balances", body: "Record deposits, partial payments and refunds. The balance owed is always current and impossible to lose track of.", icon: <IconWallet /> },
  { title: "Clients & history", body: "A contact book that remembers every order, payment and note — so repeat customers are effortless.", icon: <IconUsers /> },
  { title: "Branded invoices", body: "Your logo, tax number and footer on a clean invoice, with your own numbering. Print or share in seconds.", icon: <IconDoc /> },
  { title: "Customer self-ordering", body: "Invited customers place their own orders and follow the status live on web or the mobile app.", icon: <IconPhone /> },
  { title: "Team roles & audit", body: "Owner, admin and staff permissions, plus an audit log of who changed what — nothing is silently edited.", icon: <IconShield /> },
];

const FAQS: { q: string; a: string }[] = [
  { q: "Is RelayDesk only for a specific industry?", a: "No. It fits any small business that takes orders in advance and gets paid in parts — cake studios, caterers, print shops, made-to-order goods, repair and service shops, and more." },
  { q: "How do deposits and balances work?", a: "Record a deposit or partial payment against an order and RelayDesk keeps the running balance for you. Payments are never edited or deleted — a correction is a void with a reason plus a fresh entry, so the trail always adds up." },
  { q: "Can my customers place their own orders?", a: "Yes. Invite a customer and they get a simple ordering portal on the web or mobile app. Their order appears on your dashboard instantly and its status updates live as you work through it." },
  { q: "Can I run more than one business?", a: "Yes. One login can belong to several businesses and switch between them, with each business's data kept completely separate." },
  { q: "Will I be locked in?", a: "No. Clients, orders and payments export to CSV any time. Your records belong to you." },
  { q: "Do I need a credit card to start?", a: "No. Start on a free trial and add billing only when you're ready to continue." },
];

/* ------------------------------------------------------------------ bits */

function SectionHeading({ eyebrow, title, subtitle, align = "center" }: { eyebrow: string; title: string; subtitle?: string; align?: "center" | "left" }) {
  return (
    <div className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-xl"}>
      <p className="text-sm font-semibold text-brand-600" dangerouslySetInnerHTML={{ __html: eyebrow }} />
      <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
      {subtitle && <p className="mt-3 text-stone-600" dangerouslySetInnerHTML={{ __html: subtitle }} />}
    </div>
  );
}

function Logo({ sm }: { sm?: boolean }) {
  return (
    <span aria-hidden className={`grid place-items-center rounded-lg bg-brand-600 font-bold text-white ${sm ? "h-6 w-6 text-xs" : "h-8 w-8 text-sm"}`}>
      R
    </span>
  );
}

function OrderCardMock() {
  return (
    <div className="mx-auto w-full max-w-md rounded-2xl bg-white p-5 shadow-lg ring-1 ring-stone-200">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-stone-500">Order ORD-108</p>
          <p className="text-sm font-semibold">Priya Menon</p>
        </div>
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">In progress</span>
      </div>
      <div className="mt-4 space-y-2 border-y border-stone-100 py-4 text-sm">
        <div className="flex justify-between"><span className="text-stone-600">2-tier fondant cake</span><span className="font-medium">₹3,200</span></div>
        <div className="flex justify-between"><span className="text-stone-600">Red velvet cupcakes × 6</span><span className="font-medium">₹660</span></div>
        <div className="flex justify-between text-stone-500"><span>Delivery · tax</span><span>₹343</span></div>
      </div>
      <div className="mt-4 flex items-end justify-between">
        <div>
          <p className="text-xs text-stone-500">Due today · 6:30 pm</p>
          <p className="mt-1 text-xs font-medium text-green-700">Deposit ₹2,100 paid</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-stone-500">Balance due</p>
          <p className="text-xl font-bold tracking-tight">₹2,103</p>
        </div>
      </div>
    </div>
  );
}

function CheckIcon({ sm }: { sm?: boolean }) {
  return (
    <svg className={`${sm ? "h-4 w-4" : "h-5 w-5"} flex-none text-brand-600`} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 10.7a1 1 0 1 1 1.4-1.4l3.1 3.1 6.8-6.8a1 1 0 0 1 1.4 0z" clipRule="evenodd" />
    </svg>
  );
}

/* minimalist inline glyphs */
function svg(children: ReactNode) {
  return <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>;
}
function IconClipboard() { return svg(<><rect x="8" y="3" width="8" height="4" rx="1" /><path d="M9 5H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3" /><path d="M9 12h6M9 16h4" /></>); }
function IconWallet() { return svg(<><path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M16 12h.01M3 9h18" /></>); }
function IconUsers() { return svg(<><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5a3 3 0 0 1 0 6M21 20a6 6 0 0 0-5-5.9" /></>); }
function IconDoc() { return svg(<><path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>); }
function IconPhone() { return svg(<><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>); }
function IconShield() { return svg(<><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9.5 12l1.8 1.8L15 10" /></>); }
