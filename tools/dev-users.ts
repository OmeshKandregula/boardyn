import "dotenv/config";
import { db, sql } from "@/db";
import { users, workspaceMembers, workspaces } from "@/db/schema";
import { colorFor } from "@/lib/constants";
import { ids, slugify } from "@/lib/ids";
import { hashPassword } from "@/lib/password";

/**
 * Creates a couple of accounts in a development database, so the seeds and the
 * screenshot tooling have something to attach to without anybody signing up by
 * hand. Development only.
 */
const PEOPLE = [
  { name: "Alex Rivera", email: "alex@example.test" },
  { name: "Sam Okafor", email: "sam@example.test" },
];

async function main() {
  const password = await hashPassword("development-password");
  const workspaceId = ids.workspace();
  let first = true;

  for (const person of PEOPLE) {
    const userId = ids.user();
    await db.insert(users).values({
      id: userId,
      email: person.email,
      name: person.name,
      passwordHash: password,
      avatarColor: colorFor(person.email),
    });

    if (first) {
      await db.insert(workspaces).values({
        id: workspaceId,
        name: "Acme workspace",
        slug: slugify("acme-workspace"),
        createdBy: userId,
      });
    }

    await db.insert(workspaceMembers).values({
      workspaceId,
      userId,
      role: first ? "owner" : "member",
    });
    first = false;
    console.log(`${person.name} <${person.email}>`);
  }

  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
