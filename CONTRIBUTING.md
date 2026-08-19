# Contributing

Thanks for looking. This is a small project run by two people, so the most
useful thing you can do is open an issue before writing much code: it is a
short conversation and it beats finding out a patch does not fit after you
have written it.

## Getting it running

```bash
pnpm install
cp .env.example .env      # DATABASE_URL and AUTH_SECRET are the two that matter
docker compose up db      # or point DATABASE_URL at any Postgres you have
pnpm db:migrate
pnpm db:seed              # a board with realistic content to poke at
pnpm dev
```

Before pushing:

```bash
pnpm typecheck
pnpm test
pnpm build
```

CI runs those, runs the tests a second time under `TZ=Pacific/Auckland`, and
builds the Docker image. All of it has to pass.

## What the code expects of you

**Put logic where it can be tested.** The pattern used throughout is a pure
module beside the one that touches the world: `rate-limit-policy.ts` next to
`rate-limit.ts`, `calendar-mapping.ts` next to `push.ts` and `pull.ts`. If a
rule is worth getting right, it belongs somewhere a test can reach without a
database.

**Dates are two different things.** A due date is a *calendar day* and means
the same day to everyone; a meeting time is an *instant*. `lib/dates.ts` holds
the distinction and the reasoning. Never build a date-only value with
`new Date("2026-08-25T09:00:00")`; east of UTC it lands on the previous day.

**Ordering is fractional.** Dropping a card writes the midpoint between its
neighbours, so a move is one `UPDATE` of one row. See `lib/positions.ts`.

**Realtime carries what changed, not the new state.** The tab re-runs the
server component to get data. That keeps one place where board state is
assembled, and no client-side merge logic to drift out of step with it.

**Nothing has a save button.** Every edit writes through, which is why archive,
not delete, is the destructive path. Keep it that way: a card is often the only
record of why a decision was made.

**Both hands of a feature ship together.** Two features in this repo once
existed with no way to reach them, and they read as abandonment. If you add a
capability, add the way in.

## Tests

Vitest, and only for things that can be tested without a database. Aim at the
places where being quietly wrong costs the most: ordering, filtering, date
handling, rate limit arithmetic. A test that restates the implementation is
worse than no test, because it will pass while the behaviour is broken.

There is no integration or browser suite yet. Changes to the UI are verified by
hand against a real database. If you want to add a proper harness for that, say
so in an issue first, because it is a decision about the project rather than a
patch.

## Style

- TypeScript, no `any` where a real type will do.
- Comments explain *why*. The code already says what.
- British or American spelling, whichever you type. Nobody is normalising it.
- Commit messages: a short subject, then prose about the reasoning. If a change
  fixes something subtle, the message is where the next person learns why.

## What is likely to be accepted

Bug fixes, accessibility work, anything that makes the thing easier to
self-host, and tests for the modules above. Filters, views and property types
are the natural places to extend.

Large architectural changes and new dependencies need a conversation first. The
dependency list is short on purpose: no UI kit, no ORM beyond Drizzle, no
component library, and password hashing that needs no native build step so a
clone runs anywhere.
