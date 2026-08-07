export interface WsMessage {
  channel: string;
  symbol?: string;
  data: any;
}

export interface WsSubscribeMessage {
  type: "subscribe";
  channel: string;
  symbol?: string;
  authority?: string;
  timeframe?: string;
}

export interface WsUnsubscribeMessage {
  type: "unsubscribe";
  channel: string;
  symbol?: string;
}
