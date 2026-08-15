# FlexFit Studio

Class booking and membership management for a single gym site. Members book
classes, buy memberships and spend class credits. Staff run the front desk,
manage trainers and pull reports. Companies buy credit pools their employees
book against.

Next.js 15 (App Router) · TypeScript · tRPC v11 · Drizzle ORM · SQLite · Tailwind

---

## What this repository is

The upstream app worked, but it had been through five developers in two years.
This is a **restructure of that codebase with its behaviour and interface held
fixed** — not a rewrite, and not a redesign.

| | before | after |
| --- | --- | --- |
| booking routers | 405 + 325 lines, near-copies of each other | 170 + 87, one shared service |
| reschedule router | 381 lines, validation written out twice | 99, plus one shared evaluator |
| admin router | 268 lines, three unrelated concerns | three routers, one per concern |
| `any` annotations | 6 | 0 |
| tests | none | 116 |
| `pnpm lint` | could not run — no config | clean |

Every screen renders the same markup and colours it always did. 116 tests were
written against the **original** code before anything was touched, and they still
pass. Start with [`docs/refactoring-decisions.md`](docs/refactoring-decisions.md)
if you are here to review the work.

---

## Running it

Node 20+ and pnpm. If you don't have pnpm: `npm install -g pnpm`

```bash
pnpm install
pnpm db:push
pnpm db:seed
pnpm dev
```

That gets you a populated studio at http://localhost:3000 with a couple of weeks
of classes either side of today. The database is a SQLite file — nothing to
install, no account to create.

### Signing in

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@flexfit.test` | `admin123` |
| Trainer | `arjun@flexfit.test` | `trainer123` |
| Member | `rahul.k@example.com` | `member123` |

Every seeded member uses `member123`; the other addresses are in `src/db/seed.ts`.

### Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server on port 3000 |
| `pnpm build` | Production build |
| `pnpm test` | Run the test suite once |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm db:push` | Apply the schema in `src/db/schema/` |
| `pnpm db:seed` | Wipe the data and reseed |
| `pnpm db:reset` | Delete the database file, then push and seed again |

### Two things that will waste your time

**Don't run `pnpm build` while `pnpm dev` is running.** The build writes over the
directory the dev server is using and the app starts throwing `MODULE_NOT_FOUND`.
Nothing is actually broken — stop the dev server, delete `.next`, start it again.
To typecheck while the server is up, use `pnpm typecheck`.

**If you change anything under `src/db/schema/`, run `pnpm db:push` afterwards**
or the app and the database will disagree with each other in confusing ways.

---

## How it is laid out

```
src/
  app/            routes only, grouped by audience
    (public)/     /, login, schedule, plans
    (member)/     dashboard, waitlist, notifications
    (staff)/      kiosk, trainer/schedule
    (admin)/      admin/*
  components/     ui/ primitives, layout/ chrome
  features/       feature-specific components
  server/
    routers/      tRPC procedures: input schema → service call → return
    services/     business logic, transactions, database access
    trpc.ts       context and the five procedure levels
  domain/         pure policy — credit rules, cancellation windows
  db/schema/      one module per domain, re-exported from index.ts
  lib/            date, formatting, password, tRPC client, API types
  test/           harness; every test file gets its own database
docs/             architecture and refactoring decisions
documents/        the baseline analysis written before any code changed
```

The organising idea: **a procedure should read as input schema → service call →
return.** Everything else moves behind it. Anything a service decides that does
not need the database lives in `domain/` as a pure function — which is why the
credit and cancellation rules are the cheapest things in the codebase to test.

Route groups are `(parenthesised)`, so they organise the tree without changing a
single URL.

### Two decisions worth knowing about up front

**Both booking tables were kept.** `bookings` and `corporate_bookings` are still
separate. Merging them is the better data model, but it is a migration touching
every booking query for no behavioural gain. Instead the *code* was unified: one
`booking-service`, parameterised by a `CreditSource` (`membershipCredits` vs
`companyPoolCredits`). The six ways the two flows genuinely differ — different
cancellation windows, an unlimited tier on one side only, different promotion
guards — are now named configuration rather than divergent copies.

**Twelve odd behaviours were deliberately preserved.** A class can hold twice its
capacity; a refund leaves future bookings standing; the notification badge renders
a literal `0` when you have none. Each is pinned by a test in
`src/server/quirks.test.ts`, so a later "fix" fails the suite instead of shipping
silently. All twelve are catalogued in
[`docs/refactoring-decisions.md`](docs/refactoring-decisions.md).

---

## Testing

```bash
pnpm test
```

116 tests, no database mocks. The schema is applied once per run to a template
file and each test file copies it, so files stay isolated and run in parallel.

Coverage is concentrated where the money is: credits, booking, waitlist
promotion, reschedule, corporate pools, refunds, and every authorisation level
against every role.

The reschedule tests are worth a look — every rejection is asserted for **both**
the throwing mutation and the reporting query, message for message, because the
order of those checks decides which error a member actually sees.

---

## Documentation

| Document | What's in it |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | old and new structure, request flow, database and authorisation model, and why the layering is shaped this way |
| [`docs/refactoring-decisions.md`](docs/refactoring-decisions.md) | eight decisions with their alternatives, risks and verification, plus the twelve preserved behaviours |
| [`documents/01-baseline-analysis.md`](documents/01-baseline-analysis.md) | the survey written before any code changed: problems found, target architecture, risk analysis, phased plan |

### What actually changed in behaviour

Two things, both deliberate and both documented:

1. **Transactions.** Multi-statement writes now roll back on partial failure
   instead of leaving half-written state. Nothing else about them changed.
2. **Two pre-existing bugs, fixed on request.** `admin.classUtilisation` reported
   a booked count of 1 for nearly every class, and `/schedule` refetched forever
   without ever leaving its loading state. Both were found during the refactor,
   documented, and fixed only after they were approved — see D8.

Nothing else. Same inputs, same outputs, same errors, same edge cases, same
permissions, same screens.
