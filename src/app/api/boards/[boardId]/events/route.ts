import { requireBoardAccess } from "@/lib/access";
import { subscribe, type BoardEvent } from "@/lib/realtime";

export const dynamic = "force-dynamic";
// Streaming needs a long-lived request, which the edge runtime will not hold.
export const runtime = "nodejs";

/**
 * Server-sent events rather than WebSockets. Board updates only ever travel
 * server to client (mutations go over Server Actions), SSE reconnects on its
 * own, and it survives every proxy that speaks plain HTTP. One long-lived
 * request per open tab, fed from a shared Postgres LISTEN connection.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const { boardId } = await params;

  try {
    await requireBoardAccess(boardId);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Client vanished mid-write; cleanup happens on abort.
        }
      };

      send("ready", { boardId });

      const unsubscribe = await subscribe(boardId, (event: BoardEvent) => {
        send("change", event);
      });

      // Proxies and load balancers drop idle connections; a comment every
      // 25 seconds is cheaper than the reconnect storm that follows a timeout.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);

      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx buffers by default, which would hold every event until the
      // buffer fills. This turns the stream back into a stream.
      "x-accel-buffering": "no",
    },
  });
}
