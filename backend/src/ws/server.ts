// -----------------------------------------------------------------------------
// Makemake — WebSocket server
//
// Attaches a ws.Server to the existing Node http.Server so both HTTP and WS
// share the same port. The WebSocket endpoint is:
//
//   ws://host/ws?participantId=<id>&roomId=<id>
//
// Any upgrade request to a path other than /ws is rejected with 404.
// -----------------------------------------------------------------------------

import { WebSocketServer } from "ws";
import type { Server as HttpServer } from "http";
import { handleConnection } from "./handlers/connection.js";

export function attachWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  // Handle the HTTP → WS upgrade handshake.
  httpServer.on("upgrade", (req, socket, head) => {
    const pathname = req.url?.split("?")[0] ?? "";

    if (pathname !== "/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (socket, req) => {
    // Delegate to the connection handler — all errors are caught inside.
    handleConnection(socket, req).catch((err) => {
      console.error("[ws] unhandled connection error", err);
      socket.close(1011, "Internal server error");
    });
  });

  wss.on("error", (err) => {
    console.error("[ws] WebSocketServer error", err);
  });

  console.log("[ws] WebSocket server attached on /ws");
  return wss;
}
