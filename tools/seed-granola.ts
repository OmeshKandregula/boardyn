import "dotenv/config";
import { asc, eq } from "drizzle-orm";
import { db, sql } from "@/db";
import {
  granolaAccounts,
  meetingActionItems,
  meetings,
  users,
  workspaceMembers,
} from "@/db/schema";
import { extractActionItems } from "@/lib/granola/action-items";
import { ids } from "@/lib/ids";
import { encryptSecret, secretHint } from "@/lib/secrets";

/**
 * Fabricates Granola-shaped meeting notes so the meetings page can be built
 * and reviewed without a Granola Business key, which most contributors will
 * not have. Development only; it writes nothing Granola would ever send and
 * touches no network.
 *
 *   pnpm tsx tools/seed-granola.ts
 */

const SUMMARY_A = `## Summary
Went through pricing and what to do before launch.

## Action items
- Omesh to draft the pricing page copy
- Priya to email the design agency about the launch assets
- Both of us to review the onboarding flow before Friday

## Notes
- Per-seat pricing felt wrong for teams of two
- The demo crashed twice on the calendar view`;

const SUMMARY_B = `## Summary
Reviewed the self-hosting story.

## Next steps
- Write the contributing guide
- [ ] Decide whether to publish images to a registry

## Notes
- docker compose up worked first try on a clean machine`;

const SUMMARY_C = `## Summary
Catch-up with a candidate about the backend role.

## Notes
- Strong on Postgres, less so on frontend
- Wants to hear back by the end of the month`;

async function main() {
  const [owner] = await db.select().from(users).orderBy(asc(users.createdAt)).limit(1);
  if (!owner) throw new Error("Sign up first.");

  const [membership] = await db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, owner.id))
    .limit(1);
  if (!membership) throw new Error("That user has no workspace.");

  const others = await db
    .select({ email: users.email })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, membership.workspaceId));
  const teammate = others.find((row) => row.email !== owner.email)?.email;

  await db
    .insert(granolaAccounts)
    .values({
      id: ids.granola(),
      userId: owner.id,
      workspaceId: membership.workspaceId,
      apiKey: encryptSecret("grn_development_placeholder_key"),
      keyHint: secretHint("grn_development_placeholder_key"),
      lastSyncedAt: new Date(),
    })
    .onConflictDoNothing();

  const samples = [
    {
      title: "Weekly founder sync",
      summary: SUMMARY_A,
      hoursAgo: 26,
      attendees: [
        { name: owner.name, email: owner.email },
        ...(teammate ? [{ name: "Priya Raman", email: teammate }] : []),
      ],
      shared: Boolean(teammate),
    },
    {
      title: "Self-hosting review",
      summary: SUMMARY_B,
      hoursAgo: 50,
      attendees: [
        { name: owner.name, email: owner.email },
        ...(teammate ? [{ name: "Priya Raman", email: teammate }] : []),
      ],
      shared: Boolean(teammate),
    },
    {
      title: "Candidate screen: backend role",
      summary: SUMMARY_C,
      hoursAgo: 74,
      attendees: [
        { name: owner.name, email: owner.email },
        { name: "A candidate", email: "candidate@elsewhere.test" },
      ],
      // One member plus an outsider stays private. This row exists so the rule
      // is visible on screen rather than only in a test.
      shared: false,
    },
  ];

  for (const sample of samples) {
    const meetingId = ids.meeting();
    const startedAt = new Date(Date.now() - sample.hoursAgo * 3600_000);

    await db.insert(meetings).values({
      id: meetingId,
      workspaceId: membership.workspaceId,
      ownerId: owner.id,
      granolaNoteId: `not_dev${Math.random().toString(36).slice(2, 13)}`,
      title: sample.title,
      startedAt,
      endedAt: new Date(startedAt.getTime() + 30 * 60_000),
      attendees: sample.attendees,
      summary: sample.summary,
      transcript: "Omesh: Shall we start\nPriya: Go ahead",
      sharedWithWorkspace: sample.shared,
      granolaUpdatedAt: startedAt,
    });

    const items = extractActionItems(sample.summary);
    if (items.length > 0) {
      await db.insert(meetingActionItems).values(
        items.map((item, index) => ({
          id: ids.actionItem(),
          meetingId,
          text: item.text,
          fingerprint: item.fingerprint,
          ordinal: index,
        })),
      );
    }

    console.log(
      `${sample.title}: ${items.length} action items, shared=${sample.shared}`,
    );
  }

  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
