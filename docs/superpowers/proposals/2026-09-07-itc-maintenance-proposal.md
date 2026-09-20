# Island Training Club — Web App Maintenance Proposal

Prepared for: ITC leadership / committee
Prepared by: [your name]
Date: 7 September 2026
Status: Draft for review

---

## 1. Where the project stands

Over the past month I have built, with ITC's blessing, a working prototype of the new community web app:

- A clickable prototype covering home, schedule, activities, member area, and admin tools.
- A shared HYROX booking and payment workflow for the BFT + Midtown Pool (plus a separate Island ECC track).
- A Supabase backend covering identity, applications, approvals, giving, and the operational booking tables.
- A Vercel deployment used for live review.

That work has produced a strong starting point but it is still labelled **pre-production** in the README and handoff. Several decisions are still unresolved — HYROX pricing, refunds, payment provider, full waiver and privacy text, and the Admin permission matrix. No payments have been integrated with a real provider.

This proposal is about what happens **after** the prototype: how the app is finished, kept running, and improved for the community.

---

## 2. Two parts to the work

### Part A — Finish and launch (one-off, paid on milestones)

The list below turns the unresolved decisions and engineering tasks into deliverables ITC can sign off on. Each line maps back to a real document in the repo so nothing is invented.

1. **Product policy workshop.** Resolve the open questions in `docs/phase-one-product-brief.md`: HYROX price, capacity, schedule, cancellation and refund policy, payment provider, signup fields, Admin permission matrix. Deliverable: a one-page signed product policy.
2. **Real payment integration.** Replace the prototype payment stub with the agreed provider (Stripe / PayMe / FPS). Receipts, refunds, partial refunds, deferral, and the Midtown-closed queue logic.
3. **Final legal texts.** Waiver, privacy policy, and community guidelines copy, version-pinned and signed by leadership.
4. **Email and WhatsApp delivery.** Booking confirmations, payment receipts, HYROX registration open reminders, payment-due reminders.
5. **Apply pending Supabase migrations** to the production project, run the disposable-database verifier, and execute the two-browser acceptance test from `docs/runbooks/operational-backend.md`.
6. **Cross-device QA pass.** iOS Safari, Android Chrome, low-end Android. Accessibility pass: contrast, screen reader, focus order, dynamic type.
7. **Observability.** Error monitoring (Sentry or equivalent), uptime ping, basic alerting on Supabase / Vercel incidents.
8. **Admin handover pack.** Short Loom-style walkthroughs, written runbook, on-call rotation.

Estimated duration: **4–8 weeks** of focused work after the policy workshop lands.

Fixed price for Part A: **HK$48,000** (to be agreed after the policy workshop, once the payment provider is chosen). Split into three milestones: 30% on launch-ready build, 40% on successful production deploy, 30% on a 30-day stability window.

### Part B — Ongoing maintenance (monthly, cancellable on 30 days notice)

Once the app is live, the recurring work is:

- Bug fixes from member / admin reports (estimated 4–8 hours a week).
- Small UI / copy changes from leadership feedback.
- Supabase and Vercel bill review, schema housekeeping.
- Weekly HYROX cycle sweep verification (the Monday 6 PM transitions and the Friday 9 PM sweep).
- Payment reconciliation and donor receipt acknowledgement.
- Quarterly review of dependency updates and Supabase migrations.
- Backup and incident-response cover.

**Tier 1 — Bare maintenance (recommended for the first 6 months)**
HK$8,000/month retainer, plus a small expense pool (HK$1,500/month) covering Supabase Pro, Vercel Pro, Resend/Postmark, Sentry, and the domain.

What is included:

- Up to 8 hours of reactive work per month.
- 1 hour of proactive maintenance per week (logging, dependency review, sweep verification).
- One short monthly report (uptime, incidents, planned changes).

What is **not** included in Tier 1:

- New features (quoted separately at HK$1,200 / day).
- Member-facing communications (handled by leadership).
- After-hours emergency response (available on call, billed at HK$1,500 per incident).

**Tier 2 — Light operations**
HK$15,000/month retainer + HK$2,500/month expense pool.

- Up to 20 hours of reactive work per month.
- Same-day response during working hours.
- One small feature per month included.
- Quarterly product workshop.

**Tier 3 — Recommended if ITC wants a real community operation**
HK$25,000/month retainer + HK$4,000/month expense pool, with optional part-time community manager and bookkeeper added separately.

---

## 3. About the past month of work

I want to be transparent: the prototype phase was treated by both sides as if it were a full-time job, without a formal agreement. To be fair, I propose that the **first two months of the chosen Tier retainer are treated as partial back-pay** for the work already delivered — i.e., the agreed monthly rate covers the month you have already worked, and the month following launch. After that, the retainer continues at the same rate as ordinary maintenance.

If the committee prefers a one-off retrospective payment instead, I am open to a figure of **HK$20,000** for the prototype phase, paid out of the Part A fixed price on signing.

---

## 4. What I am asking from ITC

1. **A short signed agreement** covering Part A fixed price, the chosen retainer tier, and the back-pay arrangement above.
2. **A named point of contact** for product decisions and approvals.
3. **Access to billing** for Supabase, Vercel, Resend/Postmark, Sentry, the payment provider, and the domain.
4. **Up to two working sessions per week** with the leadership for product decisions during Part A.

---

## 5. What you get

- A working production app that ITC fully owns.
- Stable weekly HYROX booking and payment that does not break when you are busy.
- A clear handover document so the next maintainer can step in if I am unavailable.
- Honest reporting and predictable monthly costs.

---

## 6. How to respond

Reply with:

- Tier preference (1, 2, or 3).
- Preferred back-pay option (retainer offset or one-off).
- Two possible times for a 30-minute call to walk through this.

I am happy to revise any section of this proposal before signing.

---

## 7. Optional appendix — minimum cost stack

For transparency, the realistic monthly out-of-pocket costs (independent of my retainer) are roughly:

| Item | Approx. cost (HK$/month) |
| --- | --- |
| Supabase Pro | 900 |
| Vercel Pro | 200 |
| Domain (annual, prorated) | 15 |
| Resend / Postmark (transactional email) | 300–800 |
| Sentry / error monitoring | 200 |
| Stripe / payment provider fees | % of transactions |
| Resend / WhatsApp Business API | 400–1,200 |
| **Total infra (excluding fees)** | **≈ HK$2,000–3,000** |

If ITC prefers to host the infra under a club-owned account, I will hand over admin access and document the credentials.
