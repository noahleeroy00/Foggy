
import { DurableObject } from "cloudflare:workers";

export class FoggyRealtime extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Only the Worker can reach this internal broadcast route.
    if (url.pathname === "/broadcast" && request.method === "POST") {
      let event;

      try {
        event = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      if (
        !event ||
        typeof event.type !== "string" ||
        !event.type.startsWith("music.")
      ) {
        return new Response("Invalid event", { status: 400 });
      }

      const message = JSON.stringify(event);
      let delivered = 0;

      for (const socket of this.ctx.getWebSockets()) {
        if (socket.readyState !== WebSocket.OPEN) continue;

        try {
          socket.send(message);
          delivered++;
        } catch (error) {
          console.error("FOGGY broadcast error:", error);
        }
      }

      return Response.json({
        success: true,
        delivered
      });
    }

    // Accept public catalogue WebSocket connections.
    if (
      request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
    ) {
      return new Response("WebSocket upgrade required", {
        status: 426
      });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    server.serializeAttachment({
      channel: "public-catalogue",
      connectedAt: new Date().toISOString()
    });

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  // Public clients may receive events but cannot publish them.
  async webSocketMessage(socket, message) {
    try {
      socket.close(1008, "FOGGY connections are receive-only");
    } catch (error) {
      console.error("FOGGY socket close error:", error);
    }
  }

  async webSocketClose(socket, code, reason) {
    // Complete the WebSocket closing handshake.
    try {
      if (
        code >= 1000 &&
        code < 5000 &&
        ![1004, 1005, 1006, 1015].includes(code)
      ) {
        socket.close(code, reason);
      } else {
        socket.close();
      }
    } catch {
      // Connection is already closed.
    }
  }

  async webSocketError(socket, error) {
    console.error("FOGGY WebSocket error:", error);

    try {
      socket.close(1011, "Connection error");
    } catch {
      // Connection is already closed.
    }
  }
}
