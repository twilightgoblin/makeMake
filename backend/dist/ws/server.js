"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachWebSocketServer = attachWebSocketServer;
exports.closeAllWebSockets = closeAllWebSockets;
const ws_1 = require("ws");
const connection_js_1 = require("./handlers/connection.js");
let wss = null;
function attachWebSocketServer(httpServer) {
    const wssInstance = new ws_1.WebSocketServer({ noServer: true });
    wss = wssInstance;
    // Handle the HTTP → WS upgrade handshake.
    httpServer.on("upgrade", (req, socket, head) => {
        const pathname = req.url?.split("?")[0] ?? "";
        if (pathname !== "/ws") {
            socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
            socket.destroy();
            return;
        }
        wssInstance.handleUpgrade(req, socket, head, (ws) => {
            wssInstance.emit("connection", ws, req);
        });
    });
    wssInstance.on("connection", (socket, req) => {
        // Delegate to the connection handler — all errors are caught inside.
        (0, connection_js_1.handleConnection)(socket, req).catch((err) => {
            console.error("[ws] unhandled connection error", err);
            socket.close(1011, "Internal server error");
        });
    });
    wssInstance.on("error", (err) => {
        console.error("[ws] WebSocketServer error", err);
    });
    console.log("[ws] WebSocket server attached on /ws");
    return wssInstance;
}
function closeAllWebSockets() {
    if (!wss)
        return;
    for (const client of wss.clients) {
        if (client.readyState === client.OPEN) {
            client.close(1012, "Service Restart");
        }
    }
}
//# sourceMappingURL=server.js.map