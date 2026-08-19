# Boardyn

A self-hosted project board for small teams. Cards live in one place and can be
read four ways: as a kanban board, a table, a calendar or a gallery. Members'
Google Calendars sync both directions, so a due date is a real block of time and
a moved block is a moved due date.

Built because Trello has no calendar worth the name, Notion is a database that
happens to draw boards, and every hosted option charges per seat for a team of
two. It is the board we run [Bulletyn](https://readbulletyn.com) on, spun out of
that work and open-sourced on its own. MIT licensed. Bring your own Postgres.

![The board view: cards in Backlog, In progress, In review and Done columns](docs/screenshots/board.png)

## The same cards, four ways

Every view reads the same cards. Columns come from a select property, so
changing what the board groups by is a dropdown rather than a data migration.

<table>
  <tr>
    <td width="50%">
      <a href="docs/screenshots/table.png">
        <img src="docs/screenshots/table.png" alt="Table view: one row per card, editable in place" />
      </a>
      <p><strong>Table.</strong> Every cell edits in place. Sorting is saved on
      the view, so it is something you set once and both of you see.</p>
    </td>
    <td width="50%">
      <a href="docs/screenshots/calendar.png">
        <img src="docs/screenshots/calendar.png" alt="Calendar view: a month grid with cards on their due dates" />
      </a>
      <p><strong>Calendar.</strong> Drag a card to another day to change its due
      date. Connected Google Calendars draw behind the cards, so you can see
      where there is actually room.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <a href="docs/screenshots/gallery.png">
        <img src="docs/screenshots/gallery.png" alt="Gallery view: cards in a grid, sectioned by status, with notes" />
      </a>
      <p><strong>Gallery.</strong> Notes visible without opening anything. The
      view for boards where the writing matters more than the order.</p>
    </td>
    <td width="50%">
      <a href="docs/screenshots/board.png">
        <img src="docs/screenshots/board.png" alt="Board view: kanban columns" />
      </a>
      <p><strong>Board.</strong> Drag to reorder or move between columns. One
      row is updated per drag, whatever the column size.</p>
    </td>
  </tr>
</table>

## What it does

- **Boards, lists, cards.** Drag to reorder or move between columns. Labels,
  due dates, assignees, comments, archive-not-delete.
- **Four views over the same cards.** Columns come from a select property, so
  "Status" and "Priority" are the same kind of thing and either can group the
  board.
- **Custom properties.** Text, number, select, multi-select, date, person,
  checkbox, link. Add one from the board header; no migration involved.
- **Filters and sorting per view.** Saved on the view, so a filter you set is
  one your co-founder sees. Anyone wanting a private slice adds their own view.
- **Archive, with a way back.** Nothing is deleted outright. The Archive button
  lists what has been put away and restores it with properties, dates and
  comments intact.
- **Multi-user.** Email and password auth, workspaces, invite links, sessions
  in Postgres.
- **Live updates.** Both people see a drag land within a beat, over
  server-sent events fed by Postgres `LISTEN`/`NOTIFY`.
- **Usable without a mouse.** Tab to a card, space to pick it up, arrows to
  move it, space to drop, escape to cancel, enter to open. Screen readers are
  told which column the card is over.
- **Google Calendar, two ways.** Assigned cards with dates appear on your
  calendar; moving the event moves the card. Everyone's events draw behind the
  calendar view so you can see where there is room.

## Running it

With Docker, the whole thing is one command:

```bash
git clone <your fork> boardyn && cd boardyn
docker compose up
```

That starts Postgres, waits for it to be healthy, applies migrations, and
serves the app on http://localhost:3000. Create an account and you land in
your own workspace.

Set `AUTH_SECRET` in a `.env` file before you start anything you intend to
keep. Without one the container generates a fresh secret per boot, which signs
everyone out on every restart:

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Without Docker

Requires Node 22+ and a Postgres 14+ database. Point `DATABASE_URL` at any
Postgres you have (a local install, Neon, Supabase, RDS), or run just the
database from compose with `docker compose up db`.

```bash
pnpm install
cp .env.example .env      # fill in DATABASE_URL and AUTH_SECRET
pnpm db:migrate
pnpm dev
```

`pnpm db:seed` fills your workspace with a sample board if you want something
to look at first.

### Deploying it

The image is self-contained and runs migrations on boot, so a deploy is a
matter of pointing it at a Postgres and setting three variables:

```bash
docker build -t boardyn .
docker run -p 3000:3000 \
  -e DATABASE_URL=postgres://user:pass@host:5432/boardyn \
  -e AUTH_SECRET=your-long-random-string \
  -e APP_URL=https://boards.yourdomain.com \
  boardyn
```

`/api/health` returns 200 only when the app can reach the database, which is
what the container healthcheck and most load balancers want.

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

## Running it publicly

Sign-in and signup are rate limited, counted in Postgres so a restart does not
reset anyone's budget and several containers share one limit. Ten sign-in
attempts per email and thirty per address in fifteen minutes; five signups per
address per hour. A successful sign-in clears the counter for that email, so a
few typos do not lock you out of your own account, but it does not clear the
one for the address: cracking one account should not refund the budget for
guessing at the rest.

Addresses come from `x-forwarded-for`. Behind a proxy that is the real client;
without one it is attacker-controlled and can be varied freely. The per-email
limit is the one that does not depend on it, which is why both exist.

Two things still worth doing before exposing an instance to the open internet:
put it behind TLS, and put it behind a proxy you trust to set that header.

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

Issues and pull requests welcome. `pnpm typecheck`, `pnpm test` and `pnpm build`
should pass. CI also builds the Docker image, so changes that break the
container are caught before merge.

## Licence

MIT. See [LICENSE](LICENSE).

Focalboard, Trello and Notion were all looked at while working out what this
should feel like. No code was taken from any of them.
