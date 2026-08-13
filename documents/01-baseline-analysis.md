# FlexFit Studio — Baseline Analysis

Pre-refactor inspection. No application code has been changed at the time of writing.

Repository: cloned from `Rahul-Callus/flexfit-studio` at `c33f54c`, 8 commits, `main` only.
Size: 47 tracked files, 5,672 lines (5,178 of which are `src/`).

---

## 0. Baseline verification (what actually runs today)

Everything below was run against a clean clone. Results are reported as observed, not assumed.

| Check | Command | Result |
| --- | --- | --- |
| Install | `pnpm install` | Passes. Node 20 required — Node 18 is what's on PATH by default here, so a version pin matters. |
| Schema | `pnpm db:push` | Passes, creates `flexfit.db`. |
| Seed | `pnpm db:seed` | Passes: 16 users, 6 plans, 12 memberships, 96 classes, 791 bookings, 96 check-ins, 5 notifications. |
| Typecheck | `npx tsc --noEmit` | **Passes**, exit 0, zero errors. |
| Build | `pnpm build` | **Passes**. 17 routes, 15 static, 2 dynamic. |
| Dev server | `pnpm dev` | **Runs**. `/` and `/schedule` return 200. |
| Lint | `pnpm lint` | **Fails.** There is no ESLint config in the repo; `next lint` drops into an interactive setup prompt and exits 1. |
| Tests | `pnpm test` | **No tests exist.** `vitest` is installed and a `test` script is defined, but there is not a single test file. |

So two of the "definition of done" boxes are red before any refactoring starts, and the safety net the
refactor most needs — tests — does not exist. That shapes the whole plan below.

---

## A. Current architecture

### Request flow

```
Browser (client component)
  └─ trpc.<router>.<proc>.useQuery/useMutation   (@trpc/react-query + TanStack Query)
       └─ httpBatchLink → POST/GET /api/trpc
            └─ fetchRequestHandler → appRouter
                 └─ createContext(): read `flexfit_session` cookie
                                      → join sessions × users
                                      → check expiry → ctx.user
                      └─ procedure middleware (public / protected / staff / admin)
                           └─ inline handler: validation + business logic + Drizzle queries
                                └─ libSQL client → flexfit.db
```

There is no layer between a tRPC procedure and the database. Every rule about bookings, credits,
waitlists and refunds lives inside a mutation body.

### Routes (`src/app`)

17 routes. **15 of them are `"use client"`** — only `/` and the root layout are server components.
There is no `loading.tsx`, no `error.tsx`, no `middleware.ts`, and no error boundary anywhere in the tree.

| Area | Routes |
| --- | --- |
| Public | `/`, `/login`, `/schedule`, `/plans` |
| Member | `/dashboard`, `/waitlist`, `/notifications` |
| Trainer | `/trainer/schedule` |
| Staff | `/kiosk` |
| Admin | `/admin`, `/admin/reports`, `/admin/attendance`, `/admin/announcements`, `/admin/companies`, `/admin/companies/[id]` |

### tRPC (`src/server`)

`trpc.ts` defines four procedure levels — `publicProcedure`, `protectedProcedure`,
`staffProcedure` (admin *or* trainer), `adminProcedure` — and 12 flat routers:

`auth`, `members`, `plans`, `classes`, `bookings`, `reschedules`, `corporateBookings`,
`payments`, `admin`, `adminCompanies`, `notifications`, `trainers`.

### Data model (`src/db/schema.ts`, 13 tables)

`users` · `sessions` · `membership_plans` · `memberships` · `classes` · `bookings` · `checkins` ·
`payments` · `notifications` · `trainer_availability` · `reschedules` · `companies` ·
`company_members` · `corporate_bookings`

No `relations()` are declared, and no indexes beyond the implicit primary keys and the two `unique()`
columns (`users.email`, `sessions.token`). Every timestamp is stored as an ISO `text` column.

### The domain, as the code actually implements it

- **Credits.** A membership carries `creditsRemaining`. A balance of **999 or more means "unlimited"** and is never decremented (`UNLIMITED_CREDITS` in `bookings.ts`, and the bare literal `999` in two UI files).
- **Booking.** Requires an active membership whose `endDate >= today`; if several qualify, the one with the latest `endDate` wins. If the class is full the member is waitlisted at zero credit cost; otherwise credits are debited immediately.
- **Cancellation.** Free up to **12 hours** before the class (`FREE_CANCELLATION_HOURS`); later cancellations free the spot but forfeit the credit. Cancelling a *confirmed* spot promotes the longest-waiting person on the waitlist and debits their credits.
- **Reschedule.** Allowed up to **4 hours** before the original class, only to a class with the *same name*, and the credits already spent carry over rather than being refunded and re-charged.
- **Corporate.** Employees of a `company` book against `company.creditPoolBalance` instead of a membership, in a **separate table** with a **24-hour** free-cancellation window.
- **Payments.** `plans.subscribe` inserts a membership and an immediately-`paid` payment. Admins can `markPaid` or `refund`; a refund flips the payment to `refunded` and sets the linked membership to `cancelled`.

---

## B. Problems found

Ranked by how much they cost to live with, with evidence.

### 1. Two parallel booking systems that are copies of each other

`bookings.ts` (405 lines) and `corporate-bookings.ts` (325 lines) implement the same five operations —
`mine`, `book`, `cancel`, `markAttended`, `rosterFor` — against two different tables. Large stretches
are line-for-line identical: the same `hoursUntil` helper, the same class-validity checks, the same
"already on the list" check, the same capacity count, the same waitlist-promotion block.

They have already drifted:

| | personal | corporate |
| --- | --- | --- |
| Free-cancellation window | 12h | 24h |
| Credit source | `memberships.creditsRemaining` | `companies.creditPoolBalance` |
| "Unlimited" concept | yes (≥ 999) | no |
| `markAttended` check-in row | `bookingId` set, honours `input.source` | `bookingId: null`, **silently ignores `input.source`** |
| Promotion guard | `creditsRemaining < UNLIMITED_CREDITS` | `creditPoolBalance >= creditCost` |

Any change to booking policy has to be made twice, and one of those two places is easy to forget.

### 2. `reschedules.ts` duplicates its own validation, twice, in one file

`reschedule` (the mutation) and `validateReschedule` (the query) run the **same eight checks in the same
order** — one throws `TRPCError`, the other returns `{valid:false, reason}`. That is roughly 120
duplicated lines inside a single 381-line file, and the two copies can silently disagree the moment
anyone edits one of them.

`validateReschedule` is also **never called by any UI code** — `reschedule-modal.tsx` goes straight to the
mutation. It is a maintained copy of the rules that nothing uses.

### 3. Business logic has nowhere to live except inside procedures

Booking eligibility, credit debit, credit refund and waitlist promotion exist only as statements inside
mutation bodies. Nothing else can call them — not the seed, not a test, not a future admin tool. This is
the root cause of problems 1 and 2 rather than a separate problem.

### 4. No transactions anywhere, and a time-of-check/time-of-use gap on capacity

`bookings.book` does: count confirmed bookings → decide full-or-not → insert booking → update credits.
Four separate statements, no transaction. Two concurrent requests can both read `count < capacity` and
both be confirmed, overselling the class. A failure between the insert and the credit update leaves a
booking that was never paid for. `cancel` has the same shape (update → refund → promote → debit).

Drizzle's libSQL driver supports `db.transaction()`; nothing in the codebase uses it.

### 5. Duplicated helpers and hardcoded policy constants

- `hoursUntil()` — defined identically three times (`bookings.ts:16`, `reschedules.ts:18`, `corporate-bookings.ts:20`).
- `activeMembershipFor()` — defined twice; the copy in `reschedules.ts:22` is **dead code**, never called.
- `999` — the unlimited-credits threshold appears as `UNLIMITED_CREDITS` in `bookings.ts` and as a bare literal in `dashboard/page.tsx` and `plans/page.tsx`.
- Dead imports: `real` in `schema.ts`, `asc`/`desc`/`sql`/`inArray` unused in several routers.

### 6. Authorization is expressed three different ways

1. Middleware — `staffProcedure`, `adminProcedure`.
2. Hand-written role checks inside handlers — `trainers.ts` repeats `if (ctx.user.role !== "trainer") throw FORBIDDEN` **four times** and uses `protectedProcedure` instead of a dedicated procedure.
3. Client-side gates — `kiosk/page.tsx`, `admin/attendance/page.tsx` and `trainer/schedule/page.tsx` render `"Access denied"` based on `trpc.auth.me`. These are cosmetic; the real enforcement is server-side, which is correct, but it means the rule is written twice in two languages.

### 7. Everything is a client component

15 of 17 routes are `"use client"`. Consequences visible in the app today: every page flashes
`Loading...` before its first paint, the schedule and plans pages make a client roundtrip for data that
never changes per-user, and there is no streaming or Suspense boundary anywhere. This is not a
correctness problem; it is a "the framework is being paid for and not used" problem.

### 8. Type safety leaks precisely where the data is most complex

`admin/companies/[id]/page.tsx` uses `any` five times (`user: any`, `m: any`, `member: any`,
`booking: any`) on data that tRPC already types perfectly. `kiosk/page.tsx` holds the selected member in
`useState<any>(null)`. The same file does `parseInt(params.id as string)` with no `NaN` guard, so
`/admin/companies/abc` sends `id: NaN` to the server.

### 9. Query patterns that will not scale past the seed data

- `bookings.waitlisted` runs **one `COUNT(*)` per waitlisted booking** to compute queue position (N+1).
- `trainer/schedule` renders a `ClassCard` per class, and **each card fires two more queries** (`rosterFor`, `checkinCountFor`).
- `trainers.checkAvailability` loads **every non-cancelled class** for a trainer and loops over them in JavaScript to find overlaps.
- `classes.list` with no `from` bound returns the entire `classes` table.
- `admin.classUtilisation` applies `.limit()` with **no `ORDER BY`**, so "top 8" is whatever SQLite returns first.

### 10. The presentation layer has no shared vocabulary

- Inline hex colours (`#f87171`, `#4ade80`, `#fbbf24`, `#ef4444`, `#7f1d1d`, …) appear as `style={{}}` literals across ten files.
- CSS classes are used that **`globals.css` never defines**: `btn-sm`, `btn-outline`, `btn-danger`, and the variables `--fg` and `--bg-secondary`. Those elements are silently unstyled today.
- The error banner (`<p className="panel p-3 text-sm" style={{color:"#f87171"}}>`) and the success banner are copy-pasted roughly eight times.
- `admin/companies/[id]/page.tsx` (255 lines) is the largest component: it is a header, two stat cards, a top-up form, a member-search form, a member list and a booking list in one function with six pieces of local state.

### 11. Infrastructure gaps

- **No ESLint configuration at all** — `pnpm lint` cannot run non-interactively.
- **No tests**, though `vitest` is a dependency and `pnpm test` is wired up.
- **No indexes** on `bookings.class_id`, `bookings.user_id`, `classes.starts_at`, `corporate_bookings.class_id` — every query in the app filters on these.
- Three of the four `notifications.type` values (`waitlist_promotion`, `class_cancelled`, `membership_expiring`) are **never produced by application code**. They exist in the schema and in the seed, and nothing else creates them. Only `announcement` is reachable, via `notifications.broadcast`.

---

## C. Behavioural quirks that look like bugs

These matter more than anything above, because the brief says behaviour must be preserved exactly, and a
"tidy-up" would change every one of them by accident. **My default is to preserve all of these and document
them.** Items 1 and 2 were verified at runtime against the seeded database; the rest are established by
reading the code and are marked accordingly.

| # | Behaviour | Evidence |
| --- | --- | --- |
| 1 | **A class effectively holds double its capacity.** Personal booking counts only the `bookings` table against `capacity`; corporate booking counts only `corporate_bookings`. A corporate booking does not reduce the `spotsLeft` the schedule advertises. | **Verified.** Class 25 "Power Vinyasa", capacity 18, `spotsLeft` 18 → made a corporate booking → `spotsLeft` still 18. |
| 2 | **One member can hold a personal *and* a corporate booking on the same class**, spending 2 membership credits and 2 company credits for one seat. The "already on the list" check only looks in its own table. | **Verified.** Same member, same class, both bookings created, both `status: booked`. |
| 3 | Waitlist promotion debits credits with `Math.max(0, remaining - cost)`. A promoted member who cannot afford the class is promoted anyway and their balance floors at 0. | Code — `bookings.ts:230` |
| 4 | Rescheduling into a *full* class creates a waitlisted booking that already carries `creditsUsed > 0` (normal waitlist entries carry 0). If that entry is later promoted, promotion sets `creditsUsed` again and debits a **second** time. | Code — `reschedules.ts:178` + `bookings.ts:215` |
| 5 | `classes.cancel` cancels personal bookings, but **leaves corporate bookings confirmed**, refunds **no** credits to anybody, and sends no notification. | Code — `classes.ts:139` |
| 6 | `payments.refund` sets the membership to `cancelled` but does not zero its credits or cancel that member's future bookings. Those bookings stay confirmed. | Code — `payments.ts:96` |
| 7 | `plans.subscribe` always inserts a **new** membership and never expires the previous one, so a member can hold several simultaneously `active` memberships. Booking picks whichever has the latest `endDate`. | Code — `plans.ts:44` |
| 8 | `corporateBookings.markAttended` accepts a `source` input and **ignores it**, always writing the `front_desk` default, with a null `bookingId`. So corporate check-ins are invisible to `bookings.checkinCountFor`. | Code — `corporate-bookings.ts:277` |
| 9 | `NavBar` renders `{unreadCount && unreadCount > 0 && …}`. When a signed-in user has zero unread notifications this evaluates to `0`, and React renders a literal "0" next to the bell. | Code — `NavBar.tsx:82`. Not visually confirmed yet. |
| 10 | `members.updateProfile` passes its input object straight to `.set(input)`. Both fields are optional, so an empty call reaches Drizzle as `.set({})`. | Code — `members.ts:47` |

**Decision needed from you:** preserve all ten silently, preserve them but document them in
`refactoring-decisions.md`, or fix a named subset with tests proving the before/after. My recommendation
is the second for 1–8 and 10, and fixing #9 (a one-character `?? 0` change with a visible cosmetic
benefit and no logic impact) with the change called out explicitly.

---

## D. Proposed target architecture

The organising idea: **a tRPC procedure should read as input schema → service call → return.** Everything
else moves behind it. Policy that is pure (no database) moves further out still, because that is what can
be tested exhaustively and cheaply.

```
src/
  app/                            routes only — thin pages, grouped by audience
    (public)/                     /, login, schedule, plans
    (member)/                     dashboard, waitlist, notifications
    (staff)/                      kiosk, trainer/schedule
    (admin)/                      admin/*
    api/trpc/[trpc]/route.ts
  components/
    ui/                           Alert, Panel, Modal, EmptyState, LoadingState, Button
    layout/                       NavBar, NotificationBell
  features/
    bookings/       components/ + hooks/
    memberships/
    members/
    trainers/
    payments/
    credits/
    waitlist/
    reports/
    companies/
  server/
    trpc.ts                       init + procedures (adds trainerProcedure)
    routers/                      thin, one per domain
    services/                     orchestration: DB + transactions
      booking-service.ts          book / cancel / promoteFromWaitlist
      credit-service.ts           debit + refund, membership pool and company pool
      reschedule-service.ts       ONE evaluator, used by both procedures
      membership-service.ts
      payment-service.ts
      report-service.ts
  domain/                         pure functions, no DB, no tRPC — the test surface
    booking-policy.ts             FREE_CANCELLATION_HOURS, UNLIMITED_CREDITS, isRefundable, isUnlimited
    reschedule-policy.ts
    credit-policy.ts
  db/
    schema/                       split by domain, re-exported from index.ts
    index.ts, seed.ts
  lib/
    datetime.ts                   hoursUntil, today() — the deduplicated helpers
    format.ts, password.ts, trpc.ts
```

Why this shape and not something else:

- **`domain/` separate from `services/`** because the valuable tests are the pure ones. `isRefundable(startsAt, creditsUsed, now)` can be tested in a hundred cases in a millisecond; `bookingService.cancel()` needs a database.
- **`features/` for UI, `server/` for backend** rather than one full-stack folder per feature, because the client/server boundary in App Router is real and load-bearing; blurring it invites accidental `"use client"` cascades.
- **Routers stay one-per-domain.** The existing split is mostly sensible. The one that isn't is `admin.ts`, which mixes operational counters with revenue reporting and attendance analytics — that becomes `reports` (revenue, utilisation, attendance) and stays `admin` (stats, member operations).
- **`(group)` route folders** because the audience of a page is the single most useful thing to know about it, and route groups cost nothing at runtime.

### The corporate-booking question

The honest fix is one `bookings` table with a nullable `company_id` and a credit-source discriminator.
I am **not** proposing that as the default, because it is a schema migration touching every booking query
in the app, and the brief weights "same behaviour" above "nicer model".

Proposed instead: keep both tables, unify the *code* behind one `booking-service` parameterised by a
`CreditSource` strategy — `MembershipCredits` (12h window, unlimited concept) versus
`CompanyPoolCredits` (24h window, no unlimited concept). The two windows stay different because they are
different today; they become named configuration instead of two hardcoded constants in two files.
That removes ~300 lines of duplication with no migration.

If you would rather I do the schema unification, say so and I will write the migration plan first — it is
a phase of its own and it needs its own approval.

---

## E. Risk analysis

Where a careless refactor changes behaviour. Ordered by damage.

| Risk | Why it's dangerous | Mitigation |
| --- | --- | --- |
| **Centralising the two booking flows** | The two flows differ in six specific ways (§B1). Merging them "cleanly" would unify the 12h/24h windows or apply the unlimited-credits concept to company pools. | Characterisation tests for *both* flows written **before** the merge, including the different windows. The strategy object makes the differences explicit rather than incidental. |
| **Collapsing reschedule validation** | The mutation and the query must keep throwing/returning exactly the same eight conditions in the same order — the *order* matters, because it decides which message the user sees when two conditions fail at once. | One evaluator returning a discriminated result; the mutation maps it to `TRPCError`, the query maps it to `{valid, reason}`. Test asserts message-for-message equality against the current implementation, ordering included. |
| **Adding transactions** | Correct, but it *changes behaviour* under concurrency and on partial failure — today a failed credit update leaves a booking behind; wrapped in a transaction it would not. That is an improvement and therefore a change. | Its own phase, its own decision record, explicit approval. Not smuggled in with a tidy-up. |
| **Touching credit arithmetic** | The `>= 999` unlimited rule, the `Math.max(0, …)` floor and the "refund only if `creditsUsed > 0` and ≥ 12h" rule interact. Any tidy-up of one silently changes the others. | Pure `credit-policy` functions with table-driven tests covering 0, 1, 998, 999, 1000 credits and both sides of the window. |
| **`useQuery` → server component conversions** | Changes when data is fetched and what a user sees mid-load. Client-side `"Access denied"` gates would move or disappear. | Convert only pages with no per-user state (`/`, `/plans`, parts of `/schedule`). Leave gated pages client-side. Verify each in the browser. |
| **Reorganising files** | `@/` path aliases mean a bad move breaks the build loudly — low risk. But moving `db/` under `server/` changes the seed's relative imports. | Move in one commit per group, `tsc --noEmit` + `build` after each. |
| **Splitting `schema.ts`** | Drizzle Kit's `push` compares the schema to the live DB. A dropped export becomes a **dropped table**. | Re-export everything from `db/schema/index.ts`, keep `drizzle.config.ts` pointed at it, and diff `db:push` output against a fresh DB before and after. |
| **Date and timezone handling** | Timestamps are ISO text; `.slice(0,10)` for "today" is UTC-based while `formatDate` renders in `en-IN`. Any "cleanup" to a date library would shift day boundaries. | Do not introduce a date library. Move `hoursUntil` verbatim. |

---

## F. Missing tests — what gets written first

There are zero tests. The safety net has to come before the refactor, and it has to characterise the
behaviour that exists, quirks included. `src/db/index.ts` already reads `process.env.DB_FILE`, so each
suite can run against its own throwaway file database — no test harness surgery needed.

Priority order:

1. **Credits (pure).** unlimited threshold at 998/999/1000; debit on book; refund on cancel inside/outside the 12h window; no refund when `creditsUsed === 0`; the `Math.max(0, …)` floor on promotion.
2. **Booking.** no membership → FORBIDDEN; expired membership → FORBIDDEN; insufficient credits → FORBIDDEN; cancelled class → BAD_REQUEST; started class → BAD_REQUEST; duplicate → CONFLICT; full class → `waitlisted` with `creditsUsed: 0`.
3. **Cancel + waitlist promotion.** the longest-waiting entry is promoted; promotion debits credits; cancelling a *waitlisted* booking promotes nobody; refund flag in the response.
4. **Reschedule.** all eight rejection reasons with exact messages, for **both** the mutation and the query; credits carried over, not re-charged; the reschedule row is written.
5. **Corporate.** company pool debit and refund; the 24h window (asserted as *different* from 12h); not linked to a company → FORBIDDEN; inactive company → FORBIDDEN; pool exhausted → FORBIDDEN.
6. **Payments.** refund only from `paid`; `markPaid` blocked from `refunded`; refund cancels the linked membership.
7. **Authorization.** every procedure level rejects the wrong role — including the four hand-rolled trainer checks, which are the ones most likely to be broken by a `trainerProcedure` refactor.
8. **The §C quirks**, asserted explicitly, so that "fixing" one of them by accident fails the suite loudly.

---

## G. Refactoring sequence

Nine phases, each independently verifiable, each its own commit or small group of commits. After **every**
phase: `npx tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build`.

| Phase | Work | Behaviour change |
| --- | --- | --- |
| **0. Safety net** | ESLint config so `pnpm lint` runs; `vitest.config.ts` + isolated test DB; write the §F characterisation tests against the code **as it is**. No `src/` changes. | None |
| **1. Shared primitives** | `lib/datetime.ts` (`hoursUntil` ×3 → 1); `domain/booking-policy.ts` for the constants; delete the dead `activeMembershipFor`, the unused `real` import and the unused imports. | None |
| **2. Extract services** | `booking-service`, `credit-service` behind the *existing* procedures. Routers become input → service → return. | None |
| **3. Collapse reschedule** | One `evaluateReschedule()`, consumed by both the mutation and the query. ~120 lines removed. | None |
| **4. Unify booking flows** | `CreditSource` strategy; `corporate-bookings.ts` shrinks to configuration + its own queries. ~300 lines removed. | None (windows preserved as config) |
| **5. tRPC structure** | Add `trainerProcedure`, replace the four inline checks; split `admin.ts` into `admin` + `reports`. | None (`admin.*` paths kept or aliased) |
| **6. Data layer** *(needs approval)* | `db.transaction()` around book/cancel/promote/subscribe/refund; indexes on the four hot columns; split `schema.ts` by domain. | **Yes** — under concurrency and partial failure. Own decision record. |
| **7. UI** | `components/ui` primitives; remove all six `any`s; replace inline hex with CSS variables; define the missing `btn-sm`/`btn-outline`/`btn-danger`; split the 255-line company detail page; add `loading.tsx`/`error.tsx`; server-render `/` and `/plans`. | Cosmetic only, verified page by page in the browser |
| **8. Performance** | Fix the `waitlisted` N+1 with one grouped query; add `ORDER BY` to `classUtilisation`; hoist the per-card queries in the trainer schedule. | `classUtilisation` ordering **is** a visible change — flagged, needs approval |
| **9. Documentation** | `docs/architecture.md`, `docs/refactoring-decisions.md`, README rewrite, final full verification pass. | None |

Phases 0–5 are pure structure and carry no behavioural risk beyond mistakes, which the tests catch.
Phases 6 and 8 contain the only intentional behaviour changes, and both stop for approval first.

---

## H. What I recommend *not* doing

- **Do not replace any of the stack.** Next.js, tRPC, Drizzle, SQLite and Tailwind all stay. The brief marks understanding, not preference.
- **Do not merge `bookings` and `corporate_bookings` into one table** without a separate decision. The duplication is solvable in code (§D).
- **Do not silently fix the double-capacity bug** (§C1). It is the single most tempting "obvious cleanup" in the repo and it changes what the product does. Document it; fix it only if you ask.
- **Do not convert tRPC calls to Server Actions.** tRPC already provides typed, validated mutations. Adding a second mutation mechanism doubles the surface for nothing.
- **Do not add a service layer to trivial CRUD.** `plans.setActive`, `members.setRole` and `adminCompanies.updateActive` are one-line updates; routing them through a service is ceremony.
- **Do not create `utils/genericService.ts`-shaped abstractions.** Modules get domain names or they do not exist.
- **Do not reformat files wholesale.** A diff nobody can review is a diff nobody can trust; formatting rides along only with files that change for real reasons.
- **Do not implement the three unused notification types.** Wiring up `waitlist_promotion` would be a *feature*, and features are out of scope.
- **Do not change the seed data shape.** The README documents those accounts and reviewers will use them.
- **Do not upgrade dependency versions.** Not this exercise.

---

## I. Open questions before implementation starts

1. **The ten quirks in §C** — preserve silently, preserve + document, or fix a named subset? (Recommendation: preserve + document for 1–8 and 10; fix #9.)
2. **Phase 6 (transactions + indexes)** — in or out? It is the largest genuine correctness improvement available and it is an intentional behaviour change under concurrency.
3. **Schema unification of the two booking tables** — do you want the migration plan written, or is the strategy-object approach the answer?
4. **Node version** — this machine defaults to Node 18.20.8 and the README asks for Node 20. Add an `.nvmrc` and an `engines` field?
5. **The private repository** — you'll need to create the private repo and give me the remote URL; I won't push anywhere until you do.
