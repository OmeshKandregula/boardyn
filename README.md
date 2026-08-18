# Boardyn

A self-hosted project board for small teams. Cards live in one place and can be
read four ways: as a kanban board, a table, a calendar or a gallery. Members'
Google Calendars sync both directions, so a due date is a real block of time and
a moved block is a moved due date.

Built because Trello has no calendar worth the name, Notion is a database that
happens to draw boards, and every hosted option charges per seat for a team of
two. It is the board we run [Bulletyn](https://readbulletyn.com) on, spun out of
that work and open-sourced on its own. MIT licensed. Bring your own Postgres.

```
Board view          Table view         Calendar view       Gallery view
┌────┬────┬────┐    ┌──┬──┬──┬──┐     ┌─┬─┬─┬─┬─┬─┬─┐    ┌────┐┌────┐┌────┐
│ ▢  │ ▢  │    │    ├──┼──┼──┼──┤     ├─┼─┼─┼─┼─┼─┼─┤    │ ▢  ││ ▢  ││ ▢  │
│ ▢  │    │ ▢  │    ├──┼──┼──┼──┤     ├─┼─┼─┼─┼─┼─┼─┤    └────┘└────┘└────┘
└────┴────┴────┘    └──┴──┴──┴──┘     └─┴─┴─┴─┴─┴─┴─┘
```

## What it does

- **Boards, lists, cards.** Drag to reorder or move between columns. Labels,
  due dates, assignees, comments, archive-not-delete.
- **Four views over the same cards.** Columns come from a select property, so
  "Status" and "Priority" are the same kind of thing and either can group the
  board.
- **Custom properties.** Text, number, select, multi-select, date, person,
  checkbox, link. Add one from the board header; no migration involved.
- **Multi-user.** Email and password auth, workspaces, invite links, sessions
  in Postgres.
- **Live updates.** Both people see a drag land within a beat, over
  server-sent events fed by Postgres `LISTEN`/`NOTIFY`.
- **Google Calendar, two ways.** Assigned cards with dates appear on your
  calendar; moving the event moves the card. Everyone's events draw behind the
  calendar view so you can see where there is room.

## Running it

Requires Node 20+ and a Postgres 14+ database.

```bash
git clone <your fork> boardyn && cd boardyn
pnpm install
cp .env.example .env
```

Fill in `.env`:

```bash
DATABASE_URL=postgres://boardyn:boardyn@localhost:5432/boardyn
AUTH_SECRET=<node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
APP_URL=http://localhost:3000
```

Postgres, if you have Docker:

```bash
docker compose up -d
```

Otherwise point `DATABASE_URL` at any Postgres you already have (a local
install, Neon, Supabase, RDS). Then:

```bash
pnpm db:migrate
pnpm dev
```

Open http://localhost:3000, create an account, and you land in your own
workspace. `pnpm db:seed` fills it with a sample board if you want something to
look at first.

To invite your co-founder: Settings, enter their email, send them the link that
appears. It works once, for that address.

## Google Calendar sync

Optional. Without it everything else works; the calendar view just shows cards.

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   create an OAuth client of type **Web application**.
2. Add `http://localhost:3000/api/google/callback` (and your deployed
   equivalent) as an authorised redirect URI.
3. Put the client id and secret in `.env`, restart, and hit **Connect Google
   Calendar** in Settings.

The scope requested is `calendar.events`: enough to read and write events on
calendars you already have, and not enough to create, share or delete a
calendar.

**How it behaves**

| You do this | This happens |
| --- | --- |
| Assign yourself a card with a due date | An event appears on your calendar |
| Change the title, notes or date | The event updates in place |
| Drag the event to Thursday in Google | The card's due date becomes Thursday |
| Unassign yourself | The event leaves your calendar |
| Archive the card | The event is removed |
| Delete the event in Google | The card keeps its date and loses the link |

That last row is deliberate. Deleting a calendar block is a scheduling
decision, not a decision to drop the work.

**Keeping it fresh.** Changes made in Google arrive when something polls. Point
a cron at the sync endpoint every five minutes:

```bash
curl -H "authorization: Bearer $CRON_SECRET" https://your-host/api/cron/sync
```

Set `CRON_SECRET` in `.env` to require the header. Locally, the **Sync now**
button in Settings does the same thing. Each poll sends Google a sync token and
gets back only what changed, so leaving it on is cheap.

## How it is put together

```
src/
  app/
    actions/        server actions: every mutation the UI can make
    api/            OAuth callback, sync endpoints, SSE stream
    b/[boardId]/    the board page
    w/[slug]/       the workspace page
  components/board/ views, card dialog, drag and drop
  db/               Drizzle schema and migrations
  lib/
    google/         OAuth client, push (cards to calendar), pull (calendar in)
    realtime.ts     LISTEN/NOTIFY fan-out
    positions.ts    fractional indexing for drag ordering
```

A few decisions worth knowing about before you change things:

**Cards keep dates in columns, everything else in a bag.** `cards.due_at` is a
real column because the calendar view, the sync and every sorted query read it.
Custom properties live in `card_values` as JSON. The split is why a board can
grow a "Confidence" field without a migration and still sort by due date fast.

**Ordering is fractional.** Dropping a card writes the midpoint between its new
neighbours, so a drag is one `UPDATE` of one row. See `lib/positions.ts` for
the rebalance path when a column has been shuffled past the precision of a
double.

**The client re-renders from the server.** Realtime events say what changed,
not what the new state is; the tab then re-runs the server component. Slightly
more work per event, but there is exactly one place where board state is
assembled and no client-side merge logic to drift out of step with it.

**Nothing has a save button.** Every edit writes through. That is why archive,
not delete, is the destructive path.

## Contributing

Issues and pull requests welcome. `pnpm typecheck` and `pnpm build` should pass.

## Licence

MIT. See [LICENSE](LICENSE).

Focalboard, Trello and Notion were all looked at while working out what this
should feel like. No code was taken from any of them.
