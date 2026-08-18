import { sql } from "@/db";

export type BoardEvent = {
  boardId: string;
  /** What changed, coarse enough that the client can just refetch the board. */
  kind:
    | "card.created"
    | "card.updated"
    | "card.moved"
    | "card.deleted"
    | "comment.created"
    | "board.updated"
    | "view.updated"
    | "calendar.synced";
  /** Who caused it, so a client can skip echoing its own optimistic update. */
  actorId?: string | null;
  cardId?: string | null;
  at: number;
};

const CHANNEL = "boardyn_events";

type Listener = (event: BoardEvent) => void;

/**
 * Fan-out lives in two layers. Postgres LISTEN/NOTIFY carries events between
 * server processes (so two `next start` instances behind a load balancer stay
 * in sync), and an in-process Set carries them to the open SSE streams. Only
 * one Postgres connection is spent on listening no matter how many tabs are up.
 */
const globalForBus = globalThis as unknown as {
  boardynListeners?: Map<string, Set<Listener>>;
  boardynListening?: Promise<unknown>;
};

const listeners = (globalForBus.boardynListeners ??= new Map());

async function ensureListening(): Promise<void> {
  globalForBus.boardynListening ??= sql.listen(CHANNEL, (payload) => {
    let event: BoardEvent;
    try {
      event = JSON.parse(payload) as BoardEvent;
    } catch {
      return;
    }
    for (const listener of listeners.get(event.boardId) ?? []) {
      try {
        listener(event);
      } catch {
        // A dead stream must not take down delivery for the others.
      }
    }
  });
  await globalForBus.boardynListening;
}

/** Announce a change. Never throws: a failed notify must not fail a mutation. */
export async function publish(event: Omit<BoardEvent, "at">): Promise<void> {
  try {
    await sql.notify(CHANNEL, JSON.stringify({ ...event, at: Date.now() }));
  } catch (error) {
    console.error("[realtime] notify failed", error);
  }
}

/** Subscribe to one board. Returns an unsubscribe function. */
export async function subscribe(
  boardId: string,
  listener: Listener,
): Promise<() => void> {
  await ensureListening();
  const set = listeners.get(boardId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(boardId, set);

  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(boardId);
  };
}
