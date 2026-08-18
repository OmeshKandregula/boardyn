import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill it in.",
  );
}

// Next dev reloads modules on every edit; without the global the pool would
// grow one connection per reload until Postgres refuses new ones.
const globalForDb = globalThis as unknown as {
  boardynSql?: ReturnType<typeof postgres>;
};

export const sql =
  globalForDb.boardynSql ??
  postgres(url, {
    max: 10,
    // Timestamps come back as Date; JSON columns as parsed objects.
    transform: { undefined: null },
  });

if (process.env.NODE_ENV !== "production") globalForDb.boardynSql = sql;

export const db = drizzle(sql, { schema });
export { schema };
