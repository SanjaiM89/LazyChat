import { DefaultChatTransport, type ChatTransport, type UIMessage } from "ai";
import { markInjected } from "@/lib/subchat-context";


export interface AttachTarget {
  runId: string;
}

export interface BackgroundTransportOptions {
  getAttachTarget: () => AttachTarget | null;
  onRunStarted?: (runId: string) => void;
  getExtraContext?: () => UIMessage[];
  mapOutgoingMessages?: (messages: UIMessage[]) => UIMessage[];
}

export class BackgroundChatTransport extends DefaultChatTransport<UIMessage> {
  private readonly getTarget: () => AttachTarget | null;
  private readonly getExtraContext?: () => UIMessage[];
  private readonly mapOutgoingMessages?: (messages: UIMessage[]) => UIMessage[];

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
    this.getExtraContext = opts.getExtraContext;
    this.mapOutgoingMessages = opts.mapOutgoingMessages;
  }

  override async sendMessages(
    options: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0],
  ) {
    let messages = options.messages;
    if (this.mapOutgoingMessages) {
      messages = this.mapOutgoingMessages(messages);
    }
    const extra = this.getExtraContext?.() ?? [];
    if (extra.length && messages.length) {
      const seen = new Set(messages.map((m) => m.id));
      const fresh = extra.filter((m) => m?.id && !seen.has(m.id));
      if (fresh.length) {
        markInjected(fresh);
        messages = [...messages.slice(0, -1), ...fresh, ...messages.slice(-1)];
      }
    }
    if (messages !== options.messages) {
      return super.sendMessages({ ...options, messages });
    }
    return super.sendMessages(options);
  }

  override async reconnectToStream(
    options: Parameters<ChatTransport<UIMessage>["reconnectToStream"]>[0],
  ) {
    if (!this.getTarget()) return null;
    return super.reconnectToStream(options);
  }
}
