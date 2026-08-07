import { WS_URL } from "./constants";

type MessageHandler = (data: any) => void;
type StatusListener = (status: "connected" | "disconnected" | "reconnecting") => void;

interface Subscription {
  channel: string;
  symbol?: string;
  handler: MessageHandler;
}

class EmberWSClient {
  private ws: WebSocket | null = null;
  private subscriptions: Map<string, Subscription[]> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private statusListeners: Set<StatusListener> = new Set();
  private currentStatus: "connected" | "disconnected" | "reconnecting" = "disconnected";
  /** Timestamps of last received message per channel (e.g. "orderbook", "stats", "trades") */
  public lastMessageAt: Record<string, number> = {};
  /** Timestamp of last WS message from any channel */
  public lastAnyMessageAt = 0;

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    // Immediately replay current status so late subscribers get the right state
    listener(this.currentStatus);
    return () => { this.statusListeners.delete(listener); };
  }

  private emitStatus(status: "connected" | "disconnected" | "reconnecting") {
    this.currentStatus = status;
    this.statusListeners.forEach((l) => l(status));
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      console.log("[WS] Connected");
      this.reconnectDelay = 1000;
      this.emitStatus("connected");
      // Re-subscribe all active subscriptions
      this.subscriptions.forEach((subs, key) => {
        if (subs.length > 0) {
          const [channel, ...rest] = key.split(":");
          const value = rest.join(":");
          if (channel === "trader_margin") {
            this.ws?.send(JSON.stringify({
              type: "subscribe",
              channel: "trader_margin",
              authority: value,
            }));
          } else {
            this.sendSubscribe(channel, value === "*" ? undefined : value);
          }
        }
      });
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const now = Date.now();
        this.lastAnyMessageAt = now;
        if (msg.channel) this.lastMessageAt[msg.channel] = now;
        if (msg.channel === "trader_margin") {
          // trader_margin has no symbol — route by authority from the data payload
          const authority = msg.data?.authority;
          if (authority) {
            const key = `trader_margin:${authority}`;
            const subs = this.subscriptions.get(key);
            if (subs) {
              subs.forEach((sub) => sub.handler(msg.data));
            }
          }
        } else {
          const key = `${msg.channel}:${msg.symbol || "*"}`;
          const subs = this.subscriptions.get(key);
          if (subs) {
            subs.forEach((sub) => sub.handler(msg.data));
          }
        }
      } catch (e) {
        console.error("[WS] Parse error:", e);
      }
    };

    this.ws.onclose = () => {
      console.log("[WS] Disconnected, reconnecting...");
      this.emitStatus("reconnecting");
      this.scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.error("[WS] Error:", err);
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
      this.connect();
    }, this.reconnectDelay);
  }

  private sendSubscribe(channel: string, symbol?: string) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: "subscribe",
        channel,
        ...(symbol && { symbol }),
      })
    );
  }

  subscribe(channel: string, symbol: string | undefined, handler: MessageHandler): () => void {
    const key = `${channel}:${symbol || "*"}`;
    const sub: Subscription = { channel, symbol, handler };

    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, []);
      this.sendSubscribe(channel, symbol);
    }
    this.subscriptions.get(key)!.push(sub);

    // Return unsubscribe function
    return () => {
      const subs = this.subscriptions.get(key);
      if (subs) {
        const idx = subs.indexOf(sub);
        if (idx !== -1) subs.splice(idx, 1);
        if (subs.length === 0) {
          this.subscriptions.delete(key);
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(
              JSON.stringify({
                type: "unsubscribe",
                channel,
                ...(symbol && { symbol }),
              })
            );
          }
        }
      }
    };
  }

  /**
   * Subscribe to trader_margin channel using authority pubkey.
   * Backend WS expects { type: "subscribe", channel: "trader_margin", authority: "<pubkey>" }
   */
  subscribeTrader(authority: string, handler: MessageHandler): () => void {
    const key = `trader_margin:${authority}`;
    const sub: Subscription = { channel: "trader_margin", symbol: authority, handler };

    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, []);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: "subscribe",
          channel: "trader_margin",
          authority,
        }));
      }
    }
    this.subscriptions.get(key)!.push(sub);

    return () => {
      const subs = this.subscriptions.get(key);
      if (subs) {
        const idx = subs.indexOf(sub);
        if (idx !== -1) subs.splice(idx, 1);
        if (subs.length === 0) {
          this.subscriptions.delete(key);
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
              type: "unsubscribe",
              channel: "trader_margin",
              authority,
            }));
          }
        }
      }
    };
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}

export const wsClient = new EmberWSClient();
