# FlexFit Studio

Class booking and membership management for a single gym site. Members book classes, buy memberships and spend class credits. Staff run the front desk, manage trainers and pull reports. Companies buy credit pools their employees book against.

## Requirements

Node 20 or newer, and pnpm. If you don't have pnpm:

```bash
npm install -g pnpm
```

The database is SQLite and lives in a file. There's no server to install and no account to create.

## Getting set up

```bash
pnpm install
pnpm db:push
pnpm db:seed
pnpm dev
```

That gets you a populated studio at http://localhost:3000 with a couple of weeks of classes either side of today.

`db:push` creates `flexfit.db` and applies the schema. `db:seed` fills it with sample members, plans, classes and bookings.

## Signing in

| Role    | Email                  | Password   |
| ------- | ---------------------- | ---------- |
| Admin   | admin@flexfit.test     | admin123   |
| Trainer | arjun@flexfit.test     | trainer123 |
| Member  | rahul.k@example.com    | member123  |

Every seeded member uses `member123`. The other member emails are in `src/db/seed.ts`.

## Commands

| Command           | What it does                                       |
| ----------------- | -------------------------------------------------- |
| `pnpm dev`        | Development server on port 3000                     |
| `pnpm build`      | Production build                                    |
| `pnpm test`       | Run the test suite once                             |
| `pnpm typecheck`  | `tsc --noEmit`                                      |
| `pnpm lint`       | ESLint                                              |
| `pnpm db:push`    | Apply the schema in `src/db/schema/`                |
| `pnpm db:seed`    | Wipe the data and reseed                            |
| `pnpm db:reset`   | Delete the database file, then push and seed again  |

`db:reset` is the one you want when the data gets into a state you don't like. It's destructive and it's meant to be.

## Two things that will waste your time

Don't run `pnpm build` while `pnpm dev` is running. The build writes over the directory the dev server is using and the app starts throwing `MODULE_NOT_FOUND`. Nothing is actually broken. Stop the dev server, delete `.next`, start it again. If you want to typecheck while the server is up, use `npx tsc --noEmit` instead.

If you're changing anything in `src/db/schema.ts`, run `pnpm db:push` afterwards or the app and the database will disagree with each other in confusing ways.

## Layout

```
src/
  app/          routes, grouped by audience: (public) (member) (staff) (admin)
  components/   ui/ primitives and layout/ chrome
  features/     feature-specific components
  server/
    routers/    tRPC procedures — input schema, service call, return
    services/   business logic, transactions, database access
  domain/       pure policy: credit rules, cancellation windows
  db/schema/    one module per domain, re-exported from index.ts
  lib/          date, formatting, password, tRPC client, API types
  test/         harness; each test file gets its own database
docs/           architecture and refactoring decisions
documents/      the baseline analysis written before the refactor
```

A procedure reads as *input schema → service call → return*. Anything a service
decides that does not need the database lives in `domain/` as a pure function,
which is why the credit and cancellation rules are the cheapest things to test.

## Architecture and refactoring

- [`docs/architecture.md`](docs/architecture.md) — how the app is put together, the request
  flow, and why the structure is shaped this way
- [`docs/refactoring-decisions.md`](docs/refactoring-decisions.md) — every significant decision, its
  alternatives and risks, plus the fourteen behaviours that were deliberately
  preserved rather than fixed
- [`documents/01-baseline-analysis.md`](documents/01-baseline-analysis.md) — the pre-refactor survey

The refactor changed structure, not behaviour. 115 tests were written against the
original code before anything was touched and pass unchanged; the UI renders the
same markup and colours it always did. The single intentional behaviour change is
that multi-statement writes now run in a transaction.

Two pre-existing bugs found during the refactor were fixed on request:
`admin.classUtilisation` reported a booked count of 1 for nearly every class, and
`/schedule` refetched forever without ever leaving its loading state. Both are
written up in `docs/refactoring-decisions.md` (D8), along with the twelve other
oddities that were deliberately left alone.

## Testing

```bash
pnpm test
```

No database mocks. The schema is applied once per run to a template file and each
test file copies it, so files stay isolated and run in parallel. Coverage is
concentrated where the money is: credits, booking, waitlist promotion, reschedule,
corporate pools, refunds and every authorisation level.
