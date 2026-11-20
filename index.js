
/* =========================================
   FOGGY — CLOUDFLARE WORKER BACKEND
   Database, static assets and real-time routing
   ========================================= */

export { FoggyRealtime } from "./realtime.js";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function handleHealth(env) {
  try {
    const result = await env.DB
      .prepare("SELECT 1 AS connected")
      .first();

    return jsonResponse({
      success: true,
      application: "FOGGY",
      database: result?.connected === 1 ? "connected" : "error",
      storage: env.MUSIC_BUCKET ? "connected" : "missing",
      realtime: env.FOGGY_REALTIME ? "connected" : "missing"
    });

  } catch (error) {
    console.error("FOGGY health check:", error);

    return jsonResponse({
      success: false,
      message: "Database connection failed."
    }, 500);
  }
}

async function getMusic(env) {
  try {
    const result = await env.DB
      .prepare(`
        SELECT
          music.id,
          music.title,
          music.artist_name AS artist,
          music.type,
          music.album,
          music.genre,
          music.price_cents,
          music.artwork_key
        FROM music
        INNER JOIN artists
          ON artists.id = music.artist_id
        WHERE music.status = 'published'
          AND artists.status = 'active'
        ORDER BY music.created_at DESC
      `)
      .all();

    const items = (result.results || []).map(item => ({
      id: item.id,
      title: item.title,
      artist: item.artist,
      type: item.type,
      album: item.album,
      genre: item.genre,
      price: item.price_cents / 100,
      artworkUrl: item.artwork_key
        ? `/api/artwork/${encodeURIComponent(item.id)}`
        : ""
    }));

    return jsonResponse(items);

  } catch (error) {
    console.error("FOGGY music catalogue:", error);

    return jsonResponse({
      success: false,
      message: "Unable to load the music catalogue."
    }, 500);
  }
}

// Route browser WebSocket connections to one shared Durable Object.
async function handleRealtime(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");

  // Only accept connections originating from this same website.
  if (!origin || origin !== url.origin) {
    return new Response("Forbidden origin", { status: 403 });
  }

  if (
    request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
  ) {
    return new Response("WebSocket upgrade required", {
      status: 426
    });
  }

  const id = env.FOGGY_REALTIME.idFromName("public-catalogue");
  const realtime = env.FOGGY_REALTIME.get(id);

  return realtime.fetch(request);
}

// Internal helper for future catalogue-changing API routes.
// Call this after a successful database change.
async function broadcastMusicEvent(env, event) {
  const id = env.FOGGY_REALTIME.idFromName("public-catalogue");
  const realtime = env.FOGGY_REALTIME.get(id);

  return realtime.fetch(
    "https://foggy.internal/broadcast",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(event)
    }
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/health" && request.method === "GET") {
      return handleHealth(env);
    }

    if (path === "/api/music" && request.method === "GET") {
      return getMusic(env);
    }

    if (path === "/ws" && request.method === "GET") {
      return handleRealtime(request, env);
    }

    if (path.startsWith("/api/")) {
      return jsonResponse({
        success: false,
        message: "API endpoint not implemented yet."
      }, 404);
    }

    // Serve the existing FOGGY frontend.
    return env.ASSETS.fetch(request);
  }
};
