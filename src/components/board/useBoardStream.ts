"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { BoardEvent } from "@/lib/realtime";

/**
 * Keeps a board tab live. The stream carries only a description of what
 * changed; the tab then re-runs the server component to get the new data. That
 * is a little more work per event than shipping diffs, but it means there is
 * exactly one place where board state is assembled, and no client-side merge
 * logic to drift out of step with it.
 *
 * Events caused by this tab are ignored: it already applied them optimistically.
 */
export function useBoardStream(boardId: string, currentUserId: string): void {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const source = new EventSource(`/api/boards/${boardId}/events`);

    source.addEventListener("change", (message) => {
      let event: BoardEvent;
      try {
        event = JSON.parse((message as MessageEvent<string>).data);
      } catch {
        return;
      }
      if (event.actorId && event.actorId === currentUserId) return;

      // A burst of edits from the other person should cost one refresh.
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 150);
    });

    // EventSource reconnects on its own; nothing to do but stay out of its way.
    source.onerror = () => {};

    return () => {
      if (timer.current) clearTimeout(timer.current);
      source.close();
    };
  }, [boardId, currentUserId, router]);
}
