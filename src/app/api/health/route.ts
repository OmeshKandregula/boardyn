import { NextResponse } from "next/server";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

/**
 * Liveness plus a database round trip. A container that is up but cannot reach
 * Postgres is not ready for traffic, and reporting it healthy would just move
 * the failure to the first person who tries to sign in.
 */
export async function GET() {
  try {
    await sql`select 1`;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: String(error).slice(0, 200) },
      { status: 503 },
    );
  }
}
