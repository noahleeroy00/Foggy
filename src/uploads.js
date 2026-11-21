import { getCurrentUser } from "./auth.js";

const PART_SIZE = 10 * 1024 * 1024;
const MAX_AUDIO_SIZE = 5 * 1024 * 1024 * 1024;
const MAX_ARTWORK_SIZE = 20 * 1024 * 1024;
const SESSION_HOURS = 24;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function validOrigin(request) {
  const origin = request.headers.get("Origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

async function artistSession(request, env) {
  const user = await getCurrentUser(request, env);

  if (!user) {
    return { error: json({
      success: false,
      message: "Authentication required."
    }, 401) };
  }

  if (user.role !== "artist" || !user.artist?.id) {
    return { error: json({
      success: false,
      message: "Artist account required."
    }, 403) };
  }

  return { user };
}

async function getOwnedUpload(env, id, artistId) {
  return env.DB.prepare(`
    SELECT *
    FROM upload_sessions
    WHERE id = ? AND artist_id = ?
    LIMIT 1
  `).bind(id, artistId).first();
}

function expectedPartSize(fileSize, partNumber) {
  const totalParts = Math.ceil(fileSize / PART_SIZE);

  if (
    !Number.isInteger(partNumber) ||
    partNumber < 1 ||
    partNumber > totalParts
  ) {
    return null;
  }

  if (partNumber < totalParts) return PART_SIZE;

  return fileSize - PART_SIZE * (totalParts - 1);
}

async function createUpload(request, env, user) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json({ success: false, message: "Invalid request." }, 400);
  }

  const purpose = body.purpose;
  const filename = String(body.filename || "").trim();
  const contentType = String(body.contentType || "").toLowerCase();
  const fileSize = Number(body.fileSize);

  if (!["audio", "artwork"].includes(purpose)) {
    return json({ success: false, message: "Invalid upload purpose." }, 400);
  }

  if (
    !filename ||
    filename.length > 180 ||
    /[/\\\x00-\x1f]/.test(filename) ||
    filename === "." ||
    filename === ".."
  ) {
    return json({ success: false, message: "Invalid filename." }, 400);
  }

  const allowedTypes = purpose === "audio"
    ? ["audio/wav", "audio/x-wav"]
    : ["image/jpeg", "image/png", "image/webp"];

  if (!allowedTypes.includes(contentType)) {
    return json({
      success: false,
      message: purpose === "audio"
        ? "Only WAV audio files are accepted."
        : "Only JPEG, PNG or WebP artwork is accepted."
    }, 400);
  }

  const maxSize = purpose === "audio"
    ? MAX_AUDIO_SIZE
    : MAX_ARTWORK_SIZE;

  if (
    !Number.isSafeInteger(fileSize) ||
    fileSize < 1 ||
    fileSize > maxSize
  ) {
    return json({ success: false, message: "File size is not allowed." }, 400);
  }

  const extension = purpose === "audio"
    ? "wav"
    : contentType === "image/jpeg"
      ? "jpg"
      : contentType === "image/png"
        ? "png"
        : "webp";

  const id = crypto.randomUUID();
  const objectKey = `artists/${user.artist.id}/${purpose}/${id}.${extension}`;
  const expiresAt = new Date(
    Date.now() + SESSION_HOURS * 60 * 60 * 1000
  ).toISOString();

  let multipart;

  try {
    multipart = await env.MUSIC_BUCKET.createMultipartUpload(objectKey, {
      httpMetadata: { contentType },
      customMetadata: {
        artistId: user.artist.id,
        uploadSessionId: id,
        purpose
      }
    });

    await env.DB.prepare(`
      INSERT INTO upload_sessions (
        id, artist_id, purpose, original_filename,
        content_type, file_size_bytes, object_key,
        multipart_upload_id, status, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'initiated', ?)
    `).bind(
      id,
      user.artist.id,
      purpose,
      filename,
      contentType,
      fileSize,
      objectKey,
      multipart.uploadId,
      expiresAt
    ).run();

    return json({
      success: true,
      upload: {
        id,
        partSize: PART_SIZE,
        totalParts: Math.ceil(fileSize / PART_SIZE),
        expiresAt
      }
    }, 201);

  } catch (error) {
    if (multipart) {
      try {
        await multipart.abort();
      } catch {}
    }

    console.error("FOGGY create upload:", error);

    return json({
      success: false,
      message: "Unable to start upload."
    }, 500);
  }
}

async function uploadPart(request, env, user, id, partNumber) {
  const session = await getOwnedUpload(env, id, user.artist.id);

  if (!session) {
    return json({ success: false, message: "Upload not found." }, 404);
  }

  if (
    session.status !== "initiated" &&
    session.status !== "uploading"
  ) {
    return json({ success: false, message: "Upload is not active." }, 409);
  }

  if (Date.parse(session.expires_at) <= Date.now()) {
    return json({ success: false, message: "Upload has expired." }, 410);
  }

  const expectedSize = expectedPartSize(
    session.file_size_bytes,
    partNumber
  );

  const declaredSize = Number(request.headers.get("Content-Length"));

  if (
    expectedSize === null ||
    !Number.isSafeInteger(declaredSize) ||
    declaredSize !== expectedSize ||
    !request.body
  ) {
    return json({
      success: false,
      message: "Invalid part number or part size."
    }, 400);
  }

  try {
    const bytes = await request.arrayBuffer();

    if (bytes.byteLength !== expectedSize) {
      return json({ success: false, message: "Part size mismatch." }, 400);
    }

    const multipart = env.MUSIC_BUCKET.resumeMultipartUpload(
      session.object_key,
      session.multipart_upload_id
    );

    const uploaded = await multipart.uploadPart(partNumber, bytes);

    await env.DB.prepare(`
      UPDATE upload_sessions
      SET status = 'uploading'
      WHERE id = ?
        AND artist_id = ?
        AND status IN ('initiated', 'uploading')
    `).bind(id, user.artist.id).run();

    return json({
      success: true,
      partNumber: uploaded.partNumber,
      etag: uploaded.etag
    });

  } catch (error) {
    console.error("FOGGY upload part:", error);

    return json({
      success: false,
      message: "Unable to upload this part. You can retry it."
    }, 500);
  }
}

async function completeUpload(request, env, user, id) {
  const session = await getOwnedUpload(env, id, user.artist.id);

  if (!session) {
    return json({ success: false, message: "Upload not found." }, 404);
  }

  if (session.status !== "uploading") {
    return json({ success: false, message: "Upload is not ready." }, 409);
  }

  if (Date.parse(session.expires_at) <= Date.now()) {
    return json({ success: false, message: "Upload has expired." }, 410);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json({ success: false, message: "Invalid request." }, 400);
  }

  const totalParts = Math.ceil(session.file_size_bytes / PART_SIZE);
  const parts = body.parts;

  if (
    !Array.isArray(parts) ||
    parts.length !== totalParts ||
    parts.length > 10000
  ) {
    return json({ success: false, message: "Invalid parts list." }, 400);
  }

  const uploadedParts = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (
      !part ||
      part.partNumber !== i + 1 ||
      typeof part.etag !== "string" ||
      !part.etag ||
      part.etag.length > 200
    ) {
      return json({ success: false, message: "Invalid parts list." }, 400);
    }

    uploadedParts.push({
      partNumber: part.partNumber,
      etag: part.etag
    });
  }

  try {
    const multipart = env.MUSIC_BUCKET.resumeMultipartUpload(
      session.object_key,
      session.multipart_upload_id
    );

    const completed = await multipart.complete(uploadedParts);

    const stored = await env.MUSIC_BUCKET.head(session.object_key);

    if (!stored || stored.size !== session.file_size_bytes) {
      console.error("FOGGY upload size verification failed:", id);

      return json({
        success: false,
        message: "Uploaded file verification failed. Contact support."
      }, 500);
    }

    await env.DB.prepare(`
      UPDATE upload_sessions
      SET status = 'completed',
          completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND artist_id = ?
        AND status = 'uploading'
    `).bind(id, user.artist.id).run();

    return json({
      success: true,
      upload: {
        id,
        status: "completed",
        size: stored.size,
        etag: completed.etag
      }
    });

  } catch (error) {
    console.error("FOGGY complete upload:", error);

    return json({
      success: false,
      message: "Unable to complete upload. Check the parts and retry."
    }, 500);
  }
}

async function abortUpload(env, user, id) {
  const session = await getOwnedUpload(env, id, user.artist.id);

  if (!session) {
    return json({ success: false, message: "Upload not found." }, 404);
  }

  if (["completed", "attached", "ready"].includes(session.status)) {
    return json({
      success: false,
      message: "Completed uploads cannot be aborted here."
    }, 409);
  }

  try {
    if (session.multipart_upload_id) {
      const multipart = env.MUSIC_BUCKET.resumeMultipartUpload(
        session.object_key,
        session.multipart_upload_id
      );

      await multipart.abort();
    }

    await env.DB.prepare(`
      UPDATE upload_sessions
      SET status = 'aborted'
      WHERE id = ? AND artist_id = ?
    `).bind(id, user.artist.id).run();

    return json({ success: true, status: "aborted" });

  } catch (error) {
    console.error("FOGGY abort upload:", error);

    return json({
      success: false,
      message: "Unable to abort upload."
    }, 500);
  }
}

export async function handleUploads(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (!path.startsWith("/api/uploads/")) return null;

  if (!validOrigin(request)) {
    return json({ success: false, message: "Forbidden origin." }, 403);
  }

  const auth = await artistSession(request, env);

  if (auth.error) return auth.error;

  const user = auth.user;

  if (path === "/api/uploads/create" && request.method === "POST") {
    return createUpload(request, env, user);
  }

  const match = path.match(
    /^\/api\/uploads\/([0-9a-f-]{36})(?:\/parts\/([0-9]+)|\/complete)?$/
  );

  if (!match) {
    return json({ success: false, message: "Invalid upload route." }, 404);
  }

  const id = match[1];
  const partText = match[2];

  if (partText && request.method === "PUT") {
    const partNumber = Number(partText);
    return uploadPart(request, env, user, id, partNumber);
  }

  if (!partText && path.endsWith("/complete") && request.method === "POST") {
    return completeUpload(request, env, user, id);
  }

  if (!partText && !path.endsWith("/complete") && request.method === "DELETE") {
    return abortUpload(env, user, id);
  }

  return json({ success: false, message: "Method not allowed." }, 405);
}
