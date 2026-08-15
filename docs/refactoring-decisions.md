# Refactoring decisions

Every significant change, why it was made, what else was considered, what could
have broken, and how that was checked.

The constraint throughout: **the app must behave and look exactly as it did.**
115 tests were written against the original code before anything was touched, and
run after every phase.

---

## D1 — Write the tests first, against the unrefactored code

**Decision.** Phase 0 changed no application code. It added an ESLint config, a
vitest harness, and 81 tests (now 115) pinning current behaviour — including the
behaviour that looks wrong.

**Reason.** There were no tests, and `pnpm lint` could not run at all: the repo
had no ESLint config, so `next lint` dropped into an interactive setup prompt and
exited 1. Refactoring credit arithmetic without a safety net is guesswork.

**Alternatives.** Refactor first and test after — which proves the new code
self-consistent, not equivalent. Rejected.

**Risk.** Tests that encode a misreading would lock in the wrong behaviour. They
were written by reading each procedure and asserting the exact error strings.

**Verification.** All tests passed against the original code before any change.

---

## D2 — One evaluator for reschedule, consumed by both procedures

**Decision.** `reschedule` (throws) and `validateReschedule` (returns a reason)
now share `evaluateReschedule`, which returns a discriminated result. The mutation
maps a rejection to `TRPCError`; the query maps it to `{ valid, reason }`.
`reschedules.ts` went from 381 lines to 99.

**Reason.** The same ten checks existed twice in one file, in two copies that
could silently disagree the moment either was edited.

**Alternatives.** Have the mutation call the query and rethrow — this couples the
transport layer to itself and re-runs the queries. Rejected.

**Risk.** The **order** of the checks is part of the contract: it decides which
message a member sees when two conditions fail at once.

**Verification.** Every rejection is asserted for both forms, message for message,
in `reschedules.test.ts`.

---

## D3 — Keep both booking tables; unify the code behind a CreditSource

**Decision.** `bookings` and `corporate_bookings` both stay. The shared sequence
moved into `booking-service.ts`, parameterised by a `BookingFlow` (which table,
which account column, how a check-in is recorded) and a `CreditSource`
(`membershipCredits` or `companyPoolCredits`). The routers went from 405 + 325
lines to 170 + 87.

**Reason.** The two flows were near-copies that had already drifted in six ways:

| | personal | corporate |
| --- | --- | --- |
| free-cancellation window | 12h | 24h |
| credit source | membership balance | company pool |
| unlimited tier | yes, at 999 credits | no |
| promotion when short of credits | charges anyway, floors at 0 | skips the debit |
| check-in row | links the booking, honours `source` | no link, ignores `source` |
| refund guard | skips unlimited memberships | any live company |

Those differences are now named configuration instead of two divergent
implementations.

**Alternatives.** One `bookings` table with a nullable `company_id` and a source
discriminator. It is the better data model, but it is a migration touching every
booking query for no behavioural gain, and the brief weights identical behaviour
above a nicer schema. Not done — and it stays a defensible option if the product
ever needs one queue per class.

**Risk.** Merging "cleanly" would have unified the two windows or applied the
unlimited concept to company pools.

**Verification.** Both flows have their own test files, including a case asserting
that 13 hours before a class is refundable for a member and *not* for a corporate
booking.

---

## D4 — Transactions on every multi-statement write *(intentional behaviour change)*

**Decision.** `book`, `cancel`, waitlist promotion, `markAttended`, `reschedule`,
`plans.subscribe`, `payments.refund` and `classes.cancel` each run in a
transaction. Approved explicitly before implementation.

**Reason.** `book` was: count seats → insert booking → update credits, as separate
statements. A failure in between left a booking nobody paid for.

**Risk.** This is the one deliberate behaviour change in the refactor. Under
concurrency and partial failure the app now rolls back where it previously left
half-written state. The capacity check is still read-then-write, so the
time-of-check/time-of-use gap on overselling remains — closing it needs either a
unique constraint or `SELECT ... FOR UPDATE` semantics SQLite does not offer, and
that is a behaviour change nobody asked for.

**Verification.** All 115 tests pass unchanged; no test asserted partial-failure
state, because none of it was reachable deliberately.

---

## D5 — Split the schema by domain

**Decision.** `src/db/schema.ts` became seven modules re-exported from
`schema/index.ts`, which `drizzle.config.ts` now points at.

**Risk.** The highest-stakes mechanical change in the refactor: Drizzle Kit
compares the exported schema to the live database, so a table that stops being
exported is a table it **drops**.

**Verification.** The old and new schemas were pushed to two fresh databases and
`sqlite_master` diffed. The only difference is the fifteen new indexes — no table
and no column changed.

---

## D6 — `trainerProcedure`, and three routers out of `admin.ts`

**Decision.** The four hand-written `if (ctx.user.role !== "trainer") throw`
checks became one middleware. `admin.ts` split into `admin` (dashboard),
`reports` (revenue) and `attendance` (check-ins).

**Risk.** The tRPC paths of the moved procedures changed
(`admin.revenueByMonth` → `reports.revenueByMonth`). Both call sites were updated;
there are no external consumers of this API.

**Verification.** `authorization.test.ts` asserts every level against every role,
including that `checkAvailability` is staff-wide while the "my schedule" views are
trainer-only.

---

## D7 — UI: extract structure, change nothing visible

**Decision.** Shared `components/ui` primitives, feature components, route groups,
`RouterOutputs`-derived props, and all six `any` annotations removed. The 255-line
company detail page became a page plus four components.

An earlier pass also tidied the presentation — banners gained borders, the four
CSS classes the app referenced but never defined got real styles, labels were
recased. **That was reverted.** The evaluation brief asks for identical UI/UX, and
restyling is not refactoring.

**Verification.** `globals.css` differs from the original by two variables holding
the exact hex values the code already used inline. `error.tsx` and `not-found.tsx`
are the only additions, and they render only where the app previously showed a
blank screen.

---

## Preserved behaviour

The following all look like bugs. Every one is **deliberately preserved**, and
each is pinned by a test in `src/server/quirks.test.ts` so that "fixing" one by
accident fails the suite.

| # | Behaviour | Verified |
| --- | --- | --- |
| 1 | Personal and corporate seats are counted against capacity separately, so a class holds twice its capacity and a corporate booking does not reduce advertised `spotsLeft`. | runtime + test |
| 2 | One member can hold a personal *and* a corporate seat on the same class, spending both membership credits and company credits. | runtime + test |
| 3 | Waitlist promotion charges a member who can no longer afford it; the balance floors at 0. | test |
| 4 | Rescheduling into a full class produces a waitlisted booking carrying `creditsUsed > 0`; if later promoted, credits are debited a second time. | test |
| 5 | `classes.cancel` cancels personal bookings, leaves corporate bookings confirmed, refunds nobody and sends no notification. | test |
| 6 | `payments.refund` cancels the membership but leaves its credits and future bookings intact. | test |
| 7 | `plans.subscribe` never expires the previous membership, so a member can hold several active at once; booking spends the one ending latest. | test |
| 8 | `corporateBookings.markAttended` ignores the requested `source` and writes no booking link, so corporate check-ins are invisible to `checkinCountFor`. Three of the four notification types are never produced at runtime. | test |
| 9 | With zero unread notifications, `{unreadCount && unreadCount > 0 && …}` evaluates to `0` and React renders a literal "0" beside the bell. | code |
| 10 | `members.updateProfile` with no fields reaches Drizzle as `.set({})`. | code |
| 11 | `admin.classUtilisation` applies `.limit()` with no `ORDER BY`, so "top N" is whatever SQLite returns first. | code |
| 12 | `admin.classUtilisation` reports a booked count of 1 for nearly every class. Its correlated subquery renders without table prefixes in a single-table select, so `class_id = id` compares two columns of `bookings`. `classes.list` escapes this only because its `leftJoin` makes Drizzle qualify the columns. | runtime + test |
| 13 | `btn-sm`, `btn-outline`, `btn-danger`, `--fg` and `--bg-secondary` are referenced by the kiosk, company and trainer pages but defined nowhere, so those elements render unstyled. | code |
| 14 | `/schedule` and the reschedule modal call `classes.list` with `from: new Date().toISOString()`, computed on every render. The query key changes each render, so the page refetches forever and never leaves its loading state. | runtime A/B |

**#12 and #14 are the two worth raising.** Both make a visible feature not work:
the admin dashboard's utilisation panel is meaningless, and the schedule page
never renders. #14 was confirmed by dropping the original, unmodified page back
into the refactored tree — it hangs identically, so it is pre-existing, not a
regression. Both are one-line fixes (qualify the subquery; hoist the timestamp
into `useState`/`useMemo`) and both are held pending a decision, because fixing
them changes what the app does.
