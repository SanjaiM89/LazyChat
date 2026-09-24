import { DefaultChatTransport, type ChatTransport, type UIMessage } from "ai";

/* ------------------------------------------------------------------ */
/*  BackgroundChatTransport                                            */
/*                                                                     */
/*  Talks to the server-side run engine instead of owning the stream:  */
/*   • sendMessages  → POST /api/chat, which starts a background run    */
/*                     and streams it. The run id comes back in the     */
/*                     `x-chat-run-id` response header so the client    */
/*                     can re-attach later.                             */
/*   • reconnectToStream → GET /api/chat/runs/:id/events (SSE) — used    */
/*                     by useChat's resumeStream() to pick a live run    */
/*                     back up after a reload / in another tab.         */
/* ------------------------------------------------------------------ */

export interface AttachTarget {
  runId: string;
}

export interface BackgroundTransportOptions {
  /** The run this client is attached to, or null when it is not watching one. */
  getAttachTarget: () => AttachTarget | null;
  /** Called with the run id the server assigned to a newly sent message. */
  onRunStarted?: (runId: string) => void;
}

export class BackgroundChatTransport extends DefaultChatTransport<UIMessage> {
  private readonly getTarget: () => AttachTarget | null;

  constructor(opts: BackgroundTransportOptions) {
    const onRunStarted = opts.onRunStarted;
    super({
      api: "/api/chat",
      fetch: async (input, init) => {
        const res = await fetch(input, init);
        const runId = res.headers.get("x-chat-run-id");
        if (runId && onRunStarted) onRunStarted(runId);
        return res;
      },
      // resumeStream() calls this right before fetching, so returning the
      // attached run's SSE endpoint is enough.
      prepareReconnectToStreamRequest: () => {
        const target = opts.getAttachTarget();
        return {
          api: target
            ? `/api/chat/runs/${target.runId}/events`
            : "/api/chat/runs/none/events",
        };
      },
    });
    this.getTarget = opts.getAttachTarget;
  }

  /** Nothing attached → tell useChat there is no stream to resume. */
  override async reconnectToStream(
    options: Parameters<ChatTransport<UIMessage>["reconnectToStream"]>[0],
  ) {
    if (!this.getTarget()) return null;
    return super.reconnectToStream(options);
  }
}
