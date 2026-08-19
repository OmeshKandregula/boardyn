import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  granolaAccounts,
  meetingActionItems,
  meetings,
  users,
  workspaceMembers,
  type GranolaAccount,
} from "@/db/schema";
import { ids } from "@/lib/ids";
import { decryptSecret } from "@/lib/secrets";
import { extractActionItems } from "./action-items";
import { GranolaApiError, getNote, listNotes, type GranolaNote } from "./client";
import {
  flattenTranscript,
  meetingSummary,
  meetingTimes,
  meetingTitle,
  normaliseAttendees,
  shouldShareWithWorkspace,
} from "./mapping";

export type GranolaSyncResult = {
  fetched: number;
  imported: number;
  skipped: number;
  actionItems: number;
  notReady: number;
};

/** Enough pages to catch up a stale account without running forever. */
const MAX_PAGES = 20;

/**
 * Pulls one person's Granola notes in.
 *
 * Granola has no webhooks, so this is a poller on the same cron as the
 * calendar sync. Notes are only returned once Granola has generated a summary;
 * anything still processing answers 404, which is expected rather than an
 * error and simply gets picked up on a later run.
 */
export async function syncGranolaAccount(
  account: GranolaAccount,
): Promise<GranolaSyncResult> {
  const result: GranolaSyncResult = {
    fetched: 0,
    imported: 0,
    skipped: 0,
    actionItems: 0,
    notReady: 0,
  };
  if (!account.syncEnabled) return result;

  const apiKey = decryptSecret(account.apiKey);
  const workspaceEmails = await workspaceEmailsFor(account.workspaceId);

  let cursor = account.cursor;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await listNotes(apiKey, cursor);
      const notes = response.notes ?? [];
      result.fetched += notes.length;

      for (const summary of notes) {
        const existing = await db
          .select({
            id: meetings.id,
            granolaUpdatedAt: meetings.granolaUpdatedAt,
          })
          .from(meetings)
          .where(
            and(
              eq(meetings.granolaNoteId, summary.id),
              eq(meetings.ownerId, account.userId),
            ),
          )
          .limit(1);

        // Unchanged since we last saw it. This is what keeps a five-minute
        // poll from re-reading every note the person has ever recorded.
        const seenAt = existing[0]?.granolaUpdatedAt?.getTime();
        const updatedAt = summary.updated_at
          ? new Date(summary.updated_at).getTime()
          : null;
        if (existing.length && seenAt && updatedAt && seenAt >= updatedAt) {
          result.skipped++;
          continue;
        }

        let note: GranolaNote;
        try {
          note = await getNote(apiKey, summary.id);
        } catch (error) {
          if (error instanceof GranolaApiError && error.status === 404) {
            // Still being summarised. It will be there next time.
            result.notReady++;
            continue;
          }
          if (error instanceof GranolaApiError && error.status === 413) {
            // Transcript too large to inline. The summary is the part this
            // app actually uses, so take the note without it.
            note = { ...summary, transcript: null };
          } else {
            throw error;
          }
        }

        const imported = await upsertMeeting(account, note, workspaceEmails);
        result.imported++;
        result.actionItems += imported.actionItems;
      }

      cursor = response.cursor ?? null;
      if (!response.hasMore || !cursor) break;
    }

    await db
      .update(granolaAccounts)
      .set({ cursor, lastSyncedAt: new Date(), lastSyncError: null })
      .where(eq(granolaAccounts.id, account.id));
  } catch (error) {
    const message =
      error instanceof GranolaApiError
        ? `Granola returned ${error.status}: ${error.message}`
        : String(error);

    await db
      .update(granolaAccounts)
      .set({
        lastSyncError: message.slice(0, 500),
        // A rejected key will not start working on its own, and a poller
        // retrying it every five minutes is noise nobody reads.
        syncEnabled:
          error instanceof GranolaApiError &&
          (error.status === 401 || error.status === 403)
            ? false
            : account.syncEnabled,
      })
      .where(eq(granolaAccounts.id, account.id));

    throw error;
  }

  return result;
}

async function upsertMeeting(
  account: GranolaAccount,
  note: GranolaNote,
  workspaceEmails: string[],
): Promise<{ actionItems: number }> {
  const attendees = normaliseAttendees(note);
  const { startedAt, endedAt } = meetingTimes(note);
  const summary = meetingSummary(note);

  const [existing] = await db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.granolaNoteId, note.id),
        eq(meetings.ownerId, account.userId),
      ),
    )
    .limit(1);

  // A person who shared or unshared by hand has overruled the automatic rule,
  // and a later sync must not quietly undo their decision.
  const shared = existing?.shareOverriddenAt
    ? existing.sharedWithWorkspace
    : shouldShareWithWorkspace(attendees, workspaceEmails);

  const values = {
    workspaceId: account.workspaceId,
    ownerId: account.userId,
    granolaNoteId: note.id,
    title: meetingTitle(note),
    startedAt,
    endedAt,
    attendees,
    summary,
    transcript: flattenTranscript(note.transcript),
    webUrl: note.web_url ?? null,
    granolaUpdatedAt: note.updated_at ? new Date(note.updated_at) : null,
    sharedWithWorkspace: shared,
    updatedAt: new Date(),
  };

  const meetingId = existing?.id ?? ids.meeting();
  if (existing) {
    await db.update(meetings).set(values).where(eq(meetings.id, existing.id));
  } else {
    await db.insert(meetings).values({ id: meetingId, ...values });
  }

  // Action items are keyed by a fingerprint of their text, so re-syncing a
  // note leaves accepted and dismissed ones exactly as they were rather than
  // resurrecting things somebody has already dealt with.
  const items = extractActionItems(summary);
  if (items.length === 0) return { actionItems: 0 };

  const inserted = await db
    .insert(meetingActionItems)
    .values(
      items.map((item, index) => ({
        id: ids.actionItem(),
        meetingId,
        text: item.text,
        fingerprint: item.fingerprint,
        ordinal: index,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: meetingActionItems.id });

  return { actionItems: inserted.length };
}

async function workspaceEmailsFor(workspaceId: string): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId));
  return rows.map((row) => row.email);
}

/** Every connected account. Used by the poll endpoint. */
export async function syncAllGranolaAccounts(): Promise<
  Record<string, GranolaSyncResult>
> {
  const accounts = await db
    .select()
    .from(granolaAccounts)
    .where(eq(granolaAccounts.syncEnabled, true));

  const out: Record<string, GranolaSyncResult> = {};
  for (const account of accounts) {
    try {
      out[account.userId] = await syncGranolaAccount(account);
    } catch (error) {
      console.error(`[granola] sync failed for ${account.userId}`, error);
    }
  }
  return out;
}
