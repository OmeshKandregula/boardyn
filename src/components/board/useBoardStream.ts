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
 */
export function useBoardStream(boardId: string): void {
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
      // Events are deliberately not filtered by actor. Filtering on user id
      // looks right until the same person has the board open twice (laptop and
      // phone, or two tabs), at which point their own edits never reach their
      // other window. A refresh the tab did not need is cheap; a tab that
      // silently stops updating is not.
      //
      // A burst of edits should still cost one refresh, hence the debounce.
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 150);
    });

    // EventSource reconnects on its own; nothing to do but stay out of its way.
    source.onerror = () => {};

    return () => {
      if (timer.current) clearTimeout(timer.current);
      source.close();
    };
  }, [boardId, router]);
}
