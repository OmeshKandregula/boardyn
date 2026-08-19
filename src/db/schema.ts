import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Design notes
 *
 * Cards carry a small set of first-class columns (title, description, dates)
 * and an open bag of user-defined properties in `cardValues`. The split is
 * deliberate: dates and titles are read by the calendar view, the Google sync
 * and every list query, so they live in columns that can be indexed. Everything
 * else a board wants to track is a row in `boardProperties`, which is what lets
 * two boards look nothing alike without a migration.
 *
 * Ordering uses fractional positions (a double). Moving a card writes the
 * midpoint between its new neighbours, so a drag is one UPDATE of one row
 * instead of renumbering a column.
 */

const id = () => text("id").primaryKey();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/* ---------------------------------------------------------------- identity */

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    // Deterministic avatar tint so members are recognisable without uploads.
    avatarColor: text("avatar_color").notNull().default("indigo"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    // SHA-256 of the cookie value; the raw token is never stored.
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/* -------------------------------------------------------------- workspaces */

export const workspaces = pgTable(
  "workspaces",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("workspaces_slug_idx").on(t.slug)],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // owner | member
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index("workspace_members_user_idx").on(t.userId),
  ],
);

export const workspaceInvites = pgTable(
  "workspace_invites",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull().default("member"),
    token: text("token").notNull(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => users.id),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("workspace_invites_token_idx").on(t.token)],
);

/* ------------------------------------------------------------------ boards */

export const boards = pgTable(
  "boards",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    icon: text("icon").notNull().default("clipboard"),
    description: text("description"),
    position: doublePrecision("position").notNull().default(1000),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("boards_workspace_idx").on(t.workspaceId)],
);

export type PropertyOption = { id: string; name: string; color: string };

/**
 * A board's schema. `type` drives both the editor widget and how filters and
 * grouping interpret the stored value. select and multiSelect keep their
 * choices in `options`.
 */
export const boardProperties = pgTable(
  "board_properties",
  {
    id: id(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(), // text|number|select|multiSelect|date|person|checkbox|url
    options: jsonb("options").$type<PropertyOption[]>().notNull().default([]),
    position: doublePrecision("position").notNull().default(1000),
    createdAt: createdAt(),
  },
  (t) => [index("board_properties_board_idx").on(t.boardId)],
);

export type ViewFilter = {
  // A property id, or one of the pseudo-ids "title" | "dueAt" | "assignee".
  propertyId: string;
  op: "is" | "isNot" | "contains" | "isEmpty" | "isNotEmpty" | "before" | "after";
  value?: string | null;
};

export type ViewSort = {
  propertyId: string; // or "title" | "createdAt" | "dueAt" | "position"
  direction: "asc" | "desc";
};

/**
 * A saved rendering of the same cards. `groupByPropertyId` turns a select
 * property's options into kanban columns; the board view is meaningless
 * without one, the other view types ignore it.
 */
export const views = pgTable(
  "views",
  {
    id: id(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(), // board | table | calendar | gallery
    groupByPropertyId: text("group_by_property_id"),
    filters: jsonb("filters").$type<ViewFilter[]>().notNull().default([]),
    sort: jsonb("sort").$type<ViewSort | null>(),
    visibleProperties: jsonb("visible_properties")
      .$type<string[]>()
      .notNull()
      .default([]),
    // Calendar view only: overlay members' Google calendars behind the cards.
    showExternalEvents: boolean("show_external_events").notNull().default(true),
    position: doublePrecision("position").notNull().default(1000),
    createdAt: createdAt(),
  },
  (t) => [index("views_board_idx").on(t.boardId)],
);

/* ------------------------------------------------------------------- cards */

export const cards = pgTable(
  "cards",
  {
    id: id(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    // Fractional index, ordered within whichever group the view is showing.
    position: doublePrecision("position").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    // A date with no time component renders as an all-day calendar block.
    allDay: boolean("all_day").notNull().default(true),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("cards_board_idx").on(t.boardId),
    index("cards_due_idx").on(t.boardId, t.dueAt),
  ],
);

export const cardValues = pgTable(
  "card_values",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    propertyId: text("property_id")
      .notNull()
      .references(() => boardProperties.id, { onDelete: "cascade" }),
    // Shape depends on the property type: string, number, boolean, or string[].
    value: jsonb("value"),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.propertyId] }),
    index("card_values_property_idx").on(t.propertyId),
  ],
);

export const cardAssignees = pgTable(
  "card_assignees",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.userId] }),
    index("card_assignees_user_idx").on(t.userId),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: id(),
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("comments_card_idx").on(t.cardId)],
);

export const activity = pgTable(
  "activity",
  {
    id: id(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    cardId: text("card_id").references(() => cards.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("activity_board_idx").on(t.boardId, t.createdAt),
    index("activity_card_idx").on(t.cardId),
  ],
);

/* -------------------------------------------------------- google calendar  */

export const googleAccounts = pgTable(
  "google_accounts",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    googleUserId: text("google_user_id").notNull(),
    email: text("email").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Which calendar cards are pushed into. "primary" unless changed.
    calendarId: text("calendar_id").notNull().default("primary"),
    // Opaque cursor from Google; lets each poll fetch only what changed.
    syncToken: text("sync_token"),
    syncEnabled: boolean("sync_enabled").notNull().default(true),
    pushCards: boolean("push_cards").notNull().default(true),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastSyncError: text("last_sync_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("google_accounts_user_idx").on(t.userId)],
);

/** One card to one Google event, so edits update rather than duplicate. */
export const calendarLinks = pgTable(
  "calendar_links",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    googleAccountId: text("google_account_id")
      .notNull()
      .references(() => googleAccounts.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    // Hash of the last payload we pushed. Skips no-op writes to the API.
    pushedHash: text("pushed_hash"),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.googleAccountId] }),
    index("calendar_links_event_idx").on(t.eventId),
  ],
);

/**
 * Events pulled from members' calendars. Read-only shadows used to draw when
 * someone is actually free behind the card layer; never edited from here.
 */
export const externalEvents = pgTable(
  "external_events",
  {
    id: id(),
    googleAccountId: text("google_account_id")
      .notNull()
      .references(() => googleAccounts.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    title: text("title").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    htmlLink: text("html_link"),
    status: text("status").notNull().default("confirmed"),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("external_events_unique_idx").on(t.googleAccountId, t.eventId),
    index("external_events_range_idx").on(t.googleAccountId, t.startAt),
  ],
);

/**
 * Fixed-window counters for the auth endpoints. In Postgres rather than memory
 * so a restart does not hand an attacker a fresh budget, and so several app
 * containers share one limit instead of one each.
 */
export const rateLimitHits = pgTable(
  "rate_limit_hits",
  {
    // Scope plus subject, e.g. "login:email:someone@example.com".
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.windowStart] }),
    index("rate_limit_hits_window_idx").on(t.windowStart),
  ],
);

export type User = typeof users.$inferSelect;
export type Board = typeof boards.$inferSelect;
export type BoardProperty = typeof boardProperties.$inferSelect;
export type View = typeof views.$inferSelect;
export type Card = typeof cards.$inferSelect;
export type CardValue = typeof cardValues.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type GoogleAccount = typeof googleAccounts.$inferSelect;
export type ExternalEvent = typeof externalEvents.$inferSelect;
