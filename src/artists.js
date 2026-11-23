import { getCurrentUser } from "./auth.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

function validOrigin(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

async function getArtist(request, env) {
  const user = await getCurrentUser(request, env);

  if (!user || user.role !== "artist" || !user.artist?.id) {
    return null;
  }

  return user;
}

async function dashboard(env, artistId) {
  const artist = await env.DB.prepare(`
    SELECT id, artist_name, contact_phone, bio, phone_verified, status
    FROM artists
    WHERE id = ?
  `).bind(artistId).first();

  if (!artist) return json({ error: "Artist account not found." }, 404);

  const releases = await env.DB.prepare(`
    SELECT
      m.id,
      m.title,
      m.type,
      m.album,
      m.genre,
      m.price_cents,
      m.status,
      m.verification_status,
      m.submitted_at,
      m.verified_at,
      m.rejection_reason,
      COUNT(
        CASE WHEN p.payment_status = 'paid' THEN p.id END
      ) AS total_sales,
      COALESCE(
        SUM(
          CASE
            WHEN p.payment_status = 'paid'
            THEN p.artist_amount_cents
            ELSE 0
          END
        ), 0
      ) AS earnings_cents
    FROM music m
    LEFT JOIN purchases p ON p.music_id = m.id
    WHERE m.artist_id = ?
    GROUP BY m.id
    ORDER BY m.created_at DESC
  `).bind(artistId).all();

  const items = releases.results || [];

  const totals = items.reduce((result, release) => {
    result.releases += 1;
    result.sales += Number(release.total_sales || 0);
    result.earningsCents += Number(release.earnings_cents || 0);
    return result;
  }, {
    releases: 0,
    sales: 0,
    earningsCents: 0
  });

  return json({
    artist,
    totals,
    releases: items
  });
}

async function submitRelease(request, env, artist) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const title = String(body.title || "").trim();
  const type = body.type;
  const genre = String(body.genre || "").trim();
  const description = String(body.description || "").trim();
  const priceCents = Number(body.priceCents);
  const artworkUploadId = String(body.artworkUploadId || "").trim();
  const tracks = body.tracks;

  if (title.length < 1 || title.length > 120) {
    return json({ error: "Release title must be between 1 and 120 characters." }, 400);
  }

  if (type !== "single" && type !== "album") {
    return json({ error: "Release type must be single or album." }, 400);
  }

  if (!Number.isSafeInteger(priceCents) || priceCents < 0) {
    return json({ error: "Enter a valid price in cents." }, 400);
  }

  if (genre.length > 80 || description.length > 2000) {
    return json({ error: "Genre or description is too long." }, 400);
  }

  if (!artworkUploadId || !Array.isArray(tracks) || tracks.length === 0) {
    return json({ error: "Artwork and at least one audio track are required." }, 400);
  }

  if (type === "single" && tracks.length !== 1) {
    return json({ error: "A single release must contain exactly one track." }, 400);
  }

  const cleanTracks = tracks.map((track) => ({
    title: String(track.title || "").trim(),
    uploadId: String(track.uploadId || "").trim()
  }));

  if (cleanTracks.some((track) =>
    !track.title || track.title.length > 120 || !track.uploadId
  )) {
    return json({ error: "Every track needs a valid title and completed audio upload." }, 400);
  }

  const uploadIds = [
    artworkUploadId,
    ...cleanTracks.map((track) => track.uploadId)
  ];

  if (new Set(uploadIds).size !== uploadIds.length) {
    return json({ error: "An upload cannot be reused in multiple fields." }, 400);
  }

  const placeholders = uploadIds.map(() => "?").join(",");

  const uploads = await env.DB.prepare(`
    SELECT id, purpose, content_type, object_key, status, expires_at
    FROM upload_sessions
    WHERE artist_id = ?
      AND id IN (${placeholders})
  `).bind(artist.artist.id, ...uploadIds).all();

  const uploadMap = new Map(
    (uploads.results || []).map((upload) => [upload.id, upload])
  );

  if (uploadMap.size !== uploadIds.length) {
    return json({ error: "One or more uploads do not belong to your account." }, 403);
  }

  const artwork = uploadMap.get(artworkUploadId);

  if (
    artwork.purpose !== "artwork" ||
    artwork.status !== "completed" ||
    new Date(artwork.expires_at).getTime() <= Date.now() ||
    !["image/jpeg", "image/png", "image/webp"].includes(artwork.content_type)
  ) {
    return json({ error: "Your artwork upload is invalid or has expired." }, 400);
  }

  for (const track of cleanTracks) {
    const upload = uploadMap.get(track.uploadId);

    if (
      upload.purpose !== "audio" ||
      upload.status !== "completed" ||
      new Date(upload.expires_at).getTime() <= Date.now() ||
      !["audio/wav", "audio/x-wav"].includes(upload.content_type)
    ) {
      return json({
        error: `The audio upload for "${track.title}" is invalid or has expired.`
      }, 400);
    }
  }

  const artistProfile = await env.DB.prepare(`
    SELECT artist_name
    FROM artists
    WHERE id = ? AND status = 'active'
  `).bind(artist.artist.id).first();

  if (!artistProfile) {
    return json({ error: "Your artist account is not active." }, 403);
  }

  const releaseId = crypto.randomUUID();

  const statements = [
    env.DB.prepare(`
      INSERT INTO music (
        id, artist_id, title, artist_name, type, album,
        genre, description, price_cents, artwork_key,
        status, verification_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_verification', 'pending')
    `).bind(
      releaseId,
      artist.artist.id,
      title,
      artistProfile.artist_name,
      type,
      type === "album" ? title : null,
      genre || null,
      description || null,
      priceCents,
      artwork.object_key
    )
  ];

  cleanTracks.forEach((track, index) => {
    const upload = uploadMap.get(track.uploadId);

    statements.push(
      env.DB.prepare(`
        INSERT INTO music_tracks (
          id, music_id, title, track_number, audio_key
        )
        VALUES (?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        releaseId,
        track.title,
        index + 1,
        upload.object_key
      )
    );
  });

  for (const uploadId of uploadIds) {
    statements.push(
      env.DB.prepare(`
        UPDATE upload_sessions
        SET status = 'attached', attached_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND artist_id = ?
          AND status = 'completed'
      `).bind(uploadId, artist.artist.id)
    );
  }

  try {
    await env.DB.batch(statements);
  } catch (error) {
    console.error("Artist release submission failed:", error);
    return json({ error: "Could not submit this release. Please try again." }, 500);
  }

  return json({
    success: true,
    message: "Your release has been submitted for verification.",
    releaseId,
    status: "pending_verification"
  }, 201);
}

export async function handleArtistDashboard(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (!path.startsWith("/api/artist/")) return null;

  if (!validOrigin(request)) {
    return json({ error: "Invalid request origin." }, 403);
  }

  const artist = await getArtist(request, env);

  if (!artist) {
    return json({ error: "Artist sign-in required." }, 401);
  }

  if (path === "/api/artist/dashboard" && request.method === "GET") {
    return dashboard(env, artist.artist.id);
  }

  if (path === "/api/artist/releases" && request.method === "POST") {
    return submitRelease(request, env, artist);
  }

  return json({ error: "Artist endpoint not found." }, 404);
}
