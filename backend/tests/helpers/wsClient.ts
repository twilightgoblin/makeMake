// -----------------------------------------------------------------------------
// Test helper — thin async WebSocket client wrapper
//
// Wraps the raw `ws` client with:
//   connect()          — wait for the socket to open
//   nextMessage()      — await the next incoming message (typed)
//   send()             — send a ClientEnvelope
//   close()            — graceful close
//   waitForClose()     — await the socket to close
// -----------------------------------------------------------------------------

import WebSocket from "ws";
import type { ServerEnvelope, ClientEnvelope, ClientEventType } from "../../src/lib/wsTypes.js";

export class WsTestClient {
  private ws: WebSocket;
  private messageQueue: ServerEnvelope[] = [];
  private waiters: Array<(msg: ServerEnvelope) => void> = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);

    this.ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerEnvelope;
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(msg);
      } else {
        this.messageQueue.push(msg);
      }
    });
  }

  /** Wait for the socket to be fully open. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) { resolve(); return; }
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });
  }

  /** Await the next incoming server message. */
  nextMessage(timeoutMs = 5000): Promise<ServerEnvelope> {
    if (this.messageQueue.length > 0) {
      return Promise.resolve(this.messageQueue.shift()!);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(resolve);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new Error(`nextMessage timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.waiters.push((msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  /** Send a ClientEnvelope. */
  send<T>(type: ClientEventType, payload: T, requestId?: string): void {
    const envelope: ClientEnvelope<T> = { type, payload, requestId };
    this.ws.send(JSON.stringify(envelope));
  }

  /** Close the socket and wait for it to fully close. */
  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) { resolve(); return; }
      this.ws.once("close", resolve);
      this.ws.close();
    });
  }

  get readyState(): number {
    return this.ws.readyState;
  }

  /** Drain any buffered messages (useful for consuming USER_JOINED etc.). */
  drainMessages(): ServerEnvelope[] {
    const all = [...this.messageQueue];
    this.messageQueue = [];
    return all;
  }
}

/** Convenience: open a WS connection and return after ROOM_STATE is received. */
export async function connectAndSync(
  wsUrl: string,
  participantId: string,
  roomId: string,
): Promise<{ client: WsTestClient; roomState: ServerEnvelope }> {
  const client = new WsTestClient(`${wsUrl}/ws?participantId=${participantId}&roomId=${roomId}`);
  await client.connect();
  const roomState = await client.nextMessage();
  return { client, roomState };
}
