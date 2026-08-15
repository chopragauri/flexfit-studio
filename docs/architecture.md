# Architecture

FlexFit Studio is a gym management app: members book classes and spend credits,
staff run a front desk and pull reports, and companies buy credit pools their
employees book against.

Stack, unchanged by this refactor: Next.js 15 (App Router), TypeScript, tRPC v11,
Drizzle ORM, SQLite via libSQL, Tailwind.

## The old architecture

Everything hung off tRPC procedures. There was no layer between a procedure and
the database, so booking eligibility, credit arithmetic, waitlist promotion and
refund rules all lived inside mutation bodies:

```
client component → trpc hook → procedure handler (validation
                                                  + business logic
                                                  + Drizzle queries) → SQLite
```

The consequences that drove this refactor:

- `bookings.ts` (405 lines) and `corporate-bookings.ts` (325) were near
  line-for-line copies that had already drifted apart in six places.
- `reschedules.ts` (381) contained two hand-maintained copies of the same ten
  validation checks — one throwing, one returning a reason.
- `admin.ts` (268) mixed dashboard counters, revenue reporting and attendance
  analytics.
- `hoursUntil` was defined three times; `activeMembershipFor` twice, one of them
  dead. The unlimited-credit threshold `999` appeared as a bare literal in the UI.
- Authorisation was expressed three ways: middleware, four hand-rolled role
  checks in `trainers.ts`, and client-side gates.
- No transactions anywhere, so a failure between two writes left the data
  inconsistent.
- No tests, and `pnpm lint` could not run — there was no ESLint config.

## The new architecture

```
src/
  app/                      routes only, grouped by audience
    (public)/               /, login, schedule, plans
    (member)/               dashboard, waitlist, notifications
    (staff)/                kiosk, trainer/schedule
    (admin)/                admin/*
    api/trpc/[trpc]/        the single tRPC handler
    error.tsx, not-found.tsx
  components/
    ui/                     Alert, Modal, StatTile, PageState
    layout/                 NavBar, NotificationBell
  features/
    bookings/components/    RescheduleModal
    companies/components/   TopUpForm, MemberSearch, LinkedMemberList,
                            CorporateBookingList
  server/
    trpc.ts                 context + the five procedure levels
    routers/                thin: input schema → service call → return
    services/               orchestration, transactions, DB access
      booking-service.ts    book / cancel / promote / mark attended
      credit-sources.ts     membershipCredits, companyPoolCredits
      reschedule-service.ts evaluateReschedule
  domain/
    booking-policy.ts       pure predicates, no DB, no tRPC
  db/
    schema/                 one module per domain, re-exported from index.ts
    index.ts, seed.ts
  lib/                      datetime, format, password, trpc client, api-types
  test/                     harness + per-file throwaway databases
```

### Request flow

```
client component
  └─ trpc.<router>.<procedure>            typed end to end
      └─ POST/GET /api/trpc               httpBatchLink + superjson
          └─ createContext()              session cookie → sessions ⋈ users
              └─ procedure middleware     public / protected / staff / admin / trainer
                  └─ service              validates, opens a transaction, writes
                      └─ domain policy    pure decisions: affordable? refundable?
                          └─ Drizzle      SQLite
```

### Why this shape

**`domain/` separate from `services/`.** The valuable tests are the pure ones.
`isRefundable(startsAt, creditsUsed, window, now)` can be tested across dozens of
boundary cases in a millisecond; `cancel()` needs a database. Splitting them means
the rules that matter most are the cheapest to prove.

**Services take the database as a parameter.** They accept `DbExecutor`, which is
either the pool or a transaction handle, so the same function works inside and
outside a transaction, and tests hand them a throwaway file database.

**One `BookingFlow` per booking table, one `CreditSource` per account type.**
Personal and corporate bookings run the same sequence but differ in six specific
ways. Those differences are now named objects rather than duplicated code — see
`refactoring-decisions.md` D3.

**Routers stay one-per-domain, and thin.** A procedure should read as input
schema → service call → return. `admin.ts` was the exception and became three
routers matching three concerns and three pages.

**Route groups by audience.** `(public)`, `(member)`, `(staff)`, `(admin)` cost
nothing at runtime and make the most useful fact about a page — who it is for —
visible in the tree. URLs are unchanged.

## Database

Thirteen tables, unchanged in shape. `src/db/schema.ts` became
`src/db/schema/{users,memberships,classes,bookings,companies,payments,
notifications}.ts`, re-exported from `index.ts`, which is what `drizzle.config.ts`
reads. A table that stops being exported is a table Drizzle Kit drops, so the
split was verified by pushing the old and new schemas to fresh databases and
diffing `sqlite_master`: the only difference is the new indexes.

Indexes were added on the columns every query already filtered by:
`(class_id, status)` and `user_id` on both booking tables, `starts_at` and
`trainer_id` on classes, `(user_id, status, end_date)` on memberships, `status`
and `user_id` on payments, plus the company, check-in, reschedule and
notification lookups.

Transactions now wrap every multi-statement write: book, cancel, promotion,
check-in, reschedule, subscribe, refund and class cancellation.

## Authorisation

Five levels, all declared in `server/trpc.ts`:

| Procedure | Who |
| --- | --- |
| `publicProcedure` | anyone, signed in or not |
| `protectedProcedure` | any signed-in user |
| `staffProcedure` | admin or trainer |
| `adminProcedure` | admin |
| `trainerProcedure` | trainer only — "my schedule", "my availability" |

Client-side role checks remain on the staff and admin pages. They are
presentation only; the server is the enforcement point, and
`src/server/authorization.test.ts` asserts every level against every role.

## Testing

115 tests, no mocks of the database. `src/test/global-setup.ts` applies the
schema once per run to a template file; each test file copies it, so files are
isolated and run in parallel.

| File | Covers |
| --- | --- |
| `domain/booking-policy.test.ts` | pure policy boundaries: 998/999/1000 credits, both sides of each window |
| `server/routers/bookings.test.ts` | booking, cancellation, refunds, waitlist promotion |
| `server/routers/reschedules.test.ts` | all ten rejections, asserted for both the mutation and the query |
| `server/routers/corporate-bookings.test.ts` | company pool debit/refund, the 24h window |
| `server/routers/payments.test.ts` | subscribe, refund, markPaid |
| `server/routers/trainers.test.ts` | schedule counts, availability, clash detection |
| `server/authorization.test.ts` | every procedure level against every role |
| `server/quirks.test.ts` | the preserved oddities in `refactoring-decisions.md` |

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | development server on port 3000 |
| `pnpm build` | production build |
| `pnpm test` | vitest, once |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm db:push` | apply the schema |
| `pnpm db:seed` | wipe and reseed |
| `pnpm db:reset` | delete the database file, then push and seed |
