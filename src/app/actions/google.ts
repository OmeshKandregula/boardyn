"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { calendarLinks, externalEvents, googleAccounts } from "@/db/schema";
import { requireUser } from "@/lib/session";

/**
 * Disconnecting drops the mirrored events and the card links but leaves the
 * events already on Google alone. Silently wiping someone's calendar because
 * they unplugged an integration is not a recovery anyone wants to attempt.
 */
export async function disconnectGoogle(): Promise<void> {
  const user = await requireUser();
  const [account] = await db
    .select()
    .from(googleAccounts)
    .where(eq(googleAccounts.userId, user.id))
    .limit(1);
  if (!account) return;

  await db.transaction(async (tx) => {
    await tx
      .delete(externalEvents)
      .where(eq(externalEvents.googleAccountId, account.id));
    await tx
      .delete(calendarLinks)
      .where(eq(calendarLinks.googleAccountId, account.id));
    await tx.delete(googleAccounts).where(eq(googleAccounts.id, account.id));
  });

  revalidatePath("/settings");
}

export async function updateSyncPreferences(patch: {
  syncEnabled?: boolean;
  pushCards?: boolean;
  calendarId?: string;
}): Promise<void> {
  const user = await requireUser();
  const [account] = await db
    .select()
    .from(googleAccounts)
    .where(eq(googleAccounts.userId, user.id))
    .limit(1);
  if (!account) return;

  const calendarChanged =
    patch.calendarId !== undefined && patch.calendarId !== account.calendarId;

  await db
    .update(googleAccounts)
    .set({
      syncEnabled: patch.syncEnabled ?? account.syncEnabled,
      pushCards: patch.pushCards ?? account.pushCards,
      calendarId: patch.calendarId ?? account.calendarId,
      // A different calendar means a different event stream; the old cursor
      // would return changes for events we no longer track.
      syncToken: calendarChanged ? null : account.syncToken,
    })
    .where(eq(googleAccounts.id, account.id));

  revalidatePath("/settings");
}
