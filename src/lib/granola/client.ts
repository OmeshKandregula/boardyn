const API = "https://api.granola.ai";

/**
 * Granola's REST API.
 *
 * Read-only by design on their side: the API lists and reads notes, and cannot
 * write them. Keys are issued from a Granola workspace on their Business plan,
 * so this integration is inert for everyone else and the settings panel says
 * so rather than offering a field that cannot work.
 *
 * Shapes below follow docs.granola.ai. Every field is treated as optional at
 * the boundary regardless of what the schema promises: a note that arrives
 * without a title or a summary should mean one dull row, not a failed sync.
 */

export type GranolaUser = { name?: string | null; email?: string | null };

export type GranolaCalendarEvent = {
  event_title?: string | null;
  calendar_event_id?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  organiser?: GranolaUser | null;
  organizer?: GranolaUser | null;
  invitees?: GranolaUser[] | null;
};

export type GranolaTranscriptLine = {
  speaker?: { name?: string | null } | null;
  text?: string | null;
  start_time?: string | number | null;
};

export type GranolaNoteSummary = {
  id: string;
  title?: string | null;
  owner?: GranolaUser | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type GranolaNote = GranolaNoteSummary & {
  web_url?: string | null;
  attendees?: GranolaUser[] | null;
  calendar_event?: GranolaCalendarEvent | null;
  summary_text?: string | null;
  summary_markdown?: string | null;
  transcript?: GranolaTranscriptLine[] | null;
};

export type ListNotesResponse = {
  notes?: GranolaNoteSummary[];
  hasMore?: boolean;
  cursor?: string | null;
};

export class GranolaApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Seconds to wait, when the server said. */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "GranolaApiError";
  }
}

async function request<T>(
  apiKey: string,
  path: string,
  query: Record<string, string | undefined> = {},
): Promise<T> {
  const url = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after")) || undefined;
    const body = await response.text();
    throw new GranolaApiError(
      response.status,
      body.slice(0, 400) || response.statusText,
      retryAfter,
    );
  }

  return (await response.json()) as T;
}

export function listNotes(
  apiKey: string,
  cursor?: string | null,
): Promise<ListNotesResponse> {
  return request<ListNotesResponse>(apiKey, "/v1/notes", {
    cursor: cursor ?? undefined,
  });
}

/**
 * A single note with its summary. The transcript is asked for inline, and
 * Granola declines with 413 when it is too large; that is not an error worth
 * failing a sync over, so the caller treats it as "no transcript".
 */
export function getNote(apiKey: string, noteId: string): Promise<GranolaNote> {
  return request<GranolaNote>(apiKey, `/v1/notes/${noteId}`, {
    include: "transcript",
  });
}

/**
 * Cheapest possible call that proves a key works, used when someone saves one.
 * Better to reject a typo at the settings page than to leave a poller failing
 * quietly every five minutes.
 */
export async function verifyKey(apiKey: string): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  try {
    await listNotes(apiKey);
    return { ok: true };
  } catch (error) {
    if (error instanceof GranolaApiError) {
      if (error.status === 401 || error.status === 403) {
        return {
          ok: false,
          reason:
            "Granola rejected that key. Check it was copied whole, and that your workspace is on a plan that issues API keys.",
        };
      }
      return { ok: false, reason: `Granola returned ${error.status}.` };
    }
    return { ok: false, reason: "Could not reach Granola." };
  }
}
