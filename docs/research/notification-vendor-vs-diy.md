# Research: hosted in-app notification vendor vs DIY

- **Ticket:** [devo-devo/cohort-005-project#2](https://github.com/devo-devo/cohort-005-project/issues/2) (`wayfinder:research`)
- **Date:** 2026-11-14
- **Question:** Should Cadence's in-app notifications be built DIY (a `notifications` table + queries + UI on the existing SQLite/Drizzle stack) or on a hosted in-app notification vendor (Knock, Novu, MagicBell, Courier)?
- **File location note:** `docs/` currently holds only `adr/` and `agents/` — there is no research-notes convention in this repo. This file creates a `docs/research/` convention; future research tickets can add siblings here.

## Recommendation: DIY

Build the in-app notification system on the existing stack: a `notifications` table in SQLite/Drizzle, server helpers, a bell + inbox UI component, and SSE (or plain polling for v1) for live updates.

**One-line rationale:** every credible vendor's free tier is either small (MagicBell: 1,000 deliveries/mo) or branded (Knock, Novu), the first paid tier starts at $30–$250/mo for a feature Cadence can build in days on infrastructure it already owns, integration requires the same server-side JWT signing work DIY needs (without eliminating it), notification data would leave a SQLite file that currently never leaves the process, and the app's actual requirement — "tell a signed-in user something happened" at single-cohort scale — is the smallest slice of what these vendors charge for.

### Flip triggers (revisit this decision if any of these become true)

1. Cadence needs **cross-channel orchestration** — digests/batching, per-user channel fallback, SMS/push — not just in-app + already-wired Postmark email.
2. Notification **volume grows past hobby scale** in a way that makes the DIY feed queries a real performance problem.
3. A **non-technical operator** needs to edit notification templates visually (hosted workflow editors are the vendors' core value).
4. If a vendor is ever reconsidered, **Novu** is the leading candidate: cheapest paid tier ($30/mo), US+EU data residency on the free plan, `<Inbox />` React component. **Knock** is the more mature alternative but jumps to $250/mo to remove branding and is US-resident only.

---

## Context: what Cadence actually needs

Grounded in the repo (read-only inspection, no changes made):

- React Router v8 framework mode, single Node process, cookie sessions (`app/lib/session.ts`).
- SQLite via better-sqlite3 + Drizzle (`app/db/index.ts`); `app/db/schema.ts` has **no notifications table today** — this is greenfield.
- Postmark is the only wired vendor (`app/lib/mailer.server.ts`), with a file-based `.outbox/` fallback for dev/tests.
- A cohort-based course platform: users, courses, lessons, comments, enrollments. Candidate notification triggers: new comment/reply on your lesson question, enrollment confirmed, lesson published, refund decision.
- Scale: single-cohort/hobby product — at most hundreds of active users, a few thousand notification rows per month.

The requirement is: **per-user feed, unread state, click-to-navigate, optional live update.** No digests, no multi-tenancy, no SMS/push, no preference matrix beyond maybe "mute this type."

---

## Vendor comparison

| | **Knock** | **Novu** | **MagicBell** | **Courier** |
|---|---|---|---|---|
| Free tier | $0 — 10,000 messages/mo, 500 guide recipients, unlimited profiles/workflows [1] | $0 — 10,000 workflow runs/mo, all channels incl. in-app, **US + EU residency**, max 5 workflows, 3 team members [2] | $0 — **1,000 deliveries/mo**, 1 project, unlimited users [3] | $0 — 10,000 sends/mo [4] |
| First paid tier | Starter **$250/mo** — 50k messages then $0.005/ea [1] | Pro **from $30/mo** — 30k runs, $1.20/1k overage [2] | Startup **$249/mo** — 50k deliveries, $0.0025/ea [3] | Business **$0.005/send** pay-as-you-go (50k sends ≈ $250/mo) [4] |
| Branding | Knock branding on feed UI; removal requires Starter ($250/mo) [1] | Novu branding; removal requires Pro ($30/mo) [2] | Not flagged on pricing page | Not flagged on pricing page |
| React SDK | `@knocklabs/react` — prebuilt feed/inbox/toast/preferences components **and** headless hooks [5] | `@novu/react` — `<Inbox />`, `<Bell />`, headless `InboxContent`/render props; React 18+ [6] | `@magicbell/react` — `FloatingInbox`, `Inbox`, `UserPreferences`, toasts [7] | `<courier-inbox>` web component + React SDK [8] |
| Real-time | WebSockets via Knock's real-time service (socket behavior is overridable) [5][9] | WebSockets (`socketUrl` prop on `<Inbox />`) [6] | Client library handles updates (not detailed on the pages reviewed) [7] | WebSockets [8] |
| Server-side work still required | Yes — backend must sign an **RS256 JWT user token** (`@knocklabs/node`) for production "enhanced security mode," plus trigger workflows via server API [9] | Yes — `subscriberHash`/subscriber identity passed to the component; workflows triggered server-side [6] | Yes — server must generate a **User JWT** per session [7] | Yes — server must `signIn` users with a **JWT** [8] |
| Data residency | **US only.** Docs: "We expect to support EU data residency by the end of 2026." All subprocessors are US-based [10][11] | **US + EU on the free plan**; more regions (SG, UK, AU, JP, KR) on Enterprise; self-hosting on Enterprise [2] | **US.** Privacy policy: data processed at US operating offices; no residency option advertised [12] | **EU residency available on Business plan** [4] |
| Lock-in profile | Feed data, workflows, and preferences all live in Knock; exit = rebuild everything | Same shape; mitigated by open-source/self-host option at Enterprise tier | Same shape; inbox data lives in MagicBell | Same shape; inbox data lives in Courier |

### Billing-unit gotchas (all from vendor pricing pages)

- **Knock:** a message sent to one user on two channels (in-app + email) counts as **2 messages**. Also still pays downstream providers (Postmark) separately [1].
- **MagicBell:** same rule — one notification delivered on N channels = N deliveries, against only **1,000/mo free** [3].
- **Courier:** the generous outlier — one template to one recipient = **1 send regardless of channel count** [4].
- **Novu:** bills **workflow runs**, not messages [2].

---

## What you get vs what you'd build

| Capability | Vendors give you | DIY effort on this stack |
|---|---|---|
| Feed storage + per-user read/unread/seen/archived states | Hosted [5][6] | One table (`id, user_id, type, payload JSON, url, read_at, seen_at, created_at`) + 4–5 Drizzle queries [13] |
| Hosted/batteries-included inbox UI | Prebuilt components, themeable [5][6][7][8] | A bell + dropdown list built from existing `app/components/ui/*` (button, card, tabs) — the repo already ships its own component kit [13] |
| Real-time delivery | WebSockets, managed [6][8][9] | In-process EventEmitter → SSE resource route (single-process app makes this genuinely simple); **polling every 30s is an acceptable v1** and needs ~zero new infra [13] |
| User preferences (channel toggles per category) | Prebuilt `Preferences` components [5][6][7] | Overkill for v1 — a `muted_types` column or small prefs table |
| Cross-channel fan-out (email/SMS/push via one trigger) | Core vendor value [1][2][3][4] | Not needed — email is already direct-to-Postmark; adding Knock/Courier for email would create a **second path to the same inbox** and split billing [1] |
| Digest/batching, workflow editor dashboard, analytics, i18n | Core vendor value [1][2] | Not in scope for Cadence's use cases |
| Server-side identity/auth for the vendor | Required for all four (JWT signing) [6][7][8][9] | Same work exists in DIY as "which user is asking" — already solved by the session cookie [13] |

### DIY v1 cost estimate

~2–4 dev-days, all incremental on pieces the app already has:

1. **Schema + migration:** `notifications` table + FK to users (0.5 day).
2. **Server module** (`app/lib/notifications.ts`): `create()`, `listForUser()`, `unreadCount()`, `markRead()`, `markAllRead()` — follows the existing `app/lib/comments.ts` pattern (0.5 day).
3. **Routes:** loader + actions on an `inbox` route, or a JSON resource route for polling (0.5 day).
4. **UI:** bell with unread badge in the app layout + dropdown list reusing `ui/card`, `ui/button` (1 day).
5. **Live updates (optional):** SSE resource route fed by an in-process EventEmitter; degrade to polling (0.5–1 day).

Recurring cost: **$0.** Data never leaves the SQLite file.

---

## Evidence for the recommendation

1. **The vendor's paid floor is mispriced for the need.** To remove vendor branding and unlock sane free-tier limits you land on Novu Pro ($30/mo, 5-workflow cap on free) or Knock Starter/MagicBell Startup ($249–$250/mo) [1][2][3]. DIY is $0/mo for a feature with a 2–4 day build on an existing stack.
2. **Integration does not eliminate server work.** All four vendors require the backend to issue per-user JWTs (Knock RS256 user tokens [9], MagicBell User JWTs [7], Courier JWT sign-in [8]) plus server-side workflow triggers. The genuinely hard parts of DIY (which user is this? did they read it?) are things the app already handles with cookie sessions and will handle with one table + one query.
3. **Data residency points away from vendors for this product.** Knock is US-only today with EU residency only *expected* by end of 2026 [10][11]; MagicBell is US [12]; Novu offers US+EU on free [2] and Courier on Business [4]. DIY keeps notification data in the same local SQLite file as the rest of Cadence's data — the strongest residency story available.
4. **Scope mismatch.** The vendors' differentiators — cross-channel orchestration, digesting, hosted template editors, tenant-scoped feeds, analytics [1][2] — are all things Cadence does not need for "notify a student their question got a reply." Paying for orchestration to deliver in-app + the Postmark email the app already sends directly would mean two paths to the user's inbox and split billing [1].
5. **Lock-in asymmetry.** DIY keeps the notification feed as ordinary rows next to users/comments; any later migration to a vendor is additive (start sending duplicates to the vendor and seed history). Going the other direction — extracting history, preferences, and read state from a vendor feed API — is strictly harder.

---

## Sources

All claims checked against primary vendor sources on 2026-11-14.

1. Knock pricing — https://knock.app/pricing (free tier, Starter $250/mo, message counting, branding removal, Postmark-billed-separately FAQ)
2. Novu pricing — https://novu.co/pricing/ (free tier: 10k runs, US+EU residency, 5 workflows, 3 seats; Pro from $30/mo; Enterprise regions/self-host)
3. MagicBell pricing — https://www.magicbell.com/pricing (Builder $0/1,000 deliveries; Startup $249/mo; delivery counting FAQ)
4. Courier pricing — https://www.courier.com/pricing/ (Developer free 10k sends; Business $0.005/send; EU data residency; send-counting FAQ) and https://www.courier.com/docs/workspaces/billing
5. Knock React SDK — https://docs.knock.app/sdks/react/overview (`@knocklabs/react`, prebuilt + headless) and https://docs.knock.app/in-app-ui/react/sdk/overview
6. Novu React SDK — https://docs.novu.co/platform/sdks/react/overview (`@novu/react`, `<Inbox />` with `socketUrl`, React 18+)
7. MagicBell React components — https://www.magicbell.com/docs/libraries/magicbell-react (`@magicbell/react`, server-generated User JWT)
8. Courier Inbox — https://www.courier.com/platform/inbox (`<courier-inbox>`, `@trycourier/courier-js` JWT `signIn`, WebSocket real-time)
9. Knock security & authentication — https://docs.knock.app/in-app-ui/security-and-authentication.md (RS256 user-token signing, enhanced security mode)
10. Knock security — https://docs.knock.app/developer-tools/security (SOC 2, EU residency "expected by end of 2026")
11. Knock subprocessors — https://knock.app/legal/subprocessors (all named subprocessors US-based)
12. MagicBell privacy policy — https://www.magicbell.com/privacy-policy (MagicBell, Inc., San Francisco; US processing)
13. Repo facts — `app/db/schema.ts` (no notifications table), `app/db/index.ts`, `app/lib/session.ts`, `app/lib/mailer.server.ts`, `app/components/ui/*` (inspected 2026-11-14 on branch `research/notification-vendor-vs-diy`)
