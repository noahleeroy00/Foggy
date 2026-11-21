
/* =========================================
   FOGGY — AUTHENTICATION MODULE
   Customers, artists and secure sessions
   ========================================= */

const SESSION_DAYS = 7;
const PASSWORD_ITERATIONS = 310000;
const COOKIE_NAME = "foggy_session";

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

function encodeBase64(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function decodeBase64(value) {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const binary = atob(
    base64 + "=".repeat((4 - base64.length % 4) % 4)
  );

  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function hashPassword(password, salt = randomBytes(16)) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PASSWORD_ITERATIONS,
      hash: "SHA-256"
    },
    key,
    256
  );

  return [
    "pbkdf2",
    PASSWORD_ITERATIONS,
    encodeBase64(salt),
    encodeBase64(new Uint8Array(bits))
  ].join("$");
}

async function verifyPassword(password, storedHash) {
  try {
    const [algorithm, iterations, saltText, hashText] =
      storedHash.split("$");

    if (
      algorithm !== "pbkdf2" ||
      Number(iterations) !== PASSWORD_ITERATIONS ||
      !saltText ||
      !hashText
    ) {
      return false;
    }

    const salt = decodeBase64(saltText);
    const expected = decodeBase64(hashText);

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations: PASSWORD_ITERATIONS,
        hash: "SHA-256"
      },
      key,
      256
    );

    const actual = new Uint8Array(bits);

    if (actual.length !== expected.length) return false;

    let difference = 0;

    for (let i = 0; i < actual.length; i++) {
      difference |= actual[i] ^ expected[i];
    }

    return difference === 0;

  } catch {
    return false;
  }
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );

  return encodeBase64(new Uint8Array(digest));
}

function getCookie(request, name) {
  const cookies = request.headers.get("Cookie") || "";

  for (const item of cookies.split(";")) {
    const separator = item.indexOf("=");

    if (separator === -1) continue;

    const key = item.slice(0, separator).trim();

    if (key === name) {
      return item.slice(separator + 1).trim();
    }
  }

  return null;
}

function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function validOrigin(request) {
  const origin = request.headers.get("Origin");

  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function readBody(request) {
  const length = Number(request.headers.get("Content-Length") || 0);

  if (length > 16000) {
    throw new Error("Request too large.");
  }

  const body = await request.json();

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid request.");
  }

  return body;
}

function validEmail(value) {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function validPassword(value) {
  return (
    typeof value === "string" &&
    value.length >= 12 &&
    value.length <= 128
  );
}

function validPhone(value) {
  if (typeof value !== "string") return false;

  const phone = value.replace(/[\s()-]/g, "");

  return /^\+?[1-9]\d{6,14}$/.test(phone);
}

async function createSession(userId, env) {
  const token = encodeBase64(randomBytes(32));
  const tokenHash = await hashToken(token);

  const expiresAt = new Date(
    Date.now() + SESSION_DAYS * 86400000
  ).toISOString();

  await env.DB
    .prepare(`
      INSERT INTO sessions (
        id,
        user_id,
        token_hash,
        expires_at
      )
      VALUES (?, ?, ?, ?)
    `)
    .bind(
      crypto.randomUUID(),
      userId,
      tokenHash,
      expiresAt
    )
    .run();

  return token;
}

export async function getCurrentUser(request, env) {
  const token = getCookie(request, COOKIE_NAME);

  if (!token || token.length > 200) return null;

  const tokenHash = await hashToken(token);

  const user = await env.DB
    .prepare(`
      SELECT
        users.id,
        users.email,
        users.role,
        users.account_status,
        artists.id AS artist_id,
        artists.artist_name,
        artists.status AS artist_status,
        artists.phone_verified
      FROM sessions
      INNER JOIN users
        ON users.id = sessions.user_id
      LEFT JOIN artists
        ON artists.user_id = users.id
      WHERE sessions.token_hash = ?
        AND sessions.expires_at > ?
      LIMIT 1
    `)
    .bind(tokenHash, new Date().toISOString())
    .first();

  if (!user || user.account_status !== "active") {
    return null;
  }

  if (
    user.role === "artist" &&
    (!user.artist_id || user.artist_status !== "active")
  ) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    artist: user.artist_id
      ? {
          id: user.artist_id,
          name: user.artist_name,
          phoneVerified: Boolean(user.phone_verified)
        }
      : null
  };
}

async function registerCustomer(request, env) {
  let body;

  try {
    body = await readBody(request);
  } catch {
    return json({ success: false, message: "Invalid request." }, 400);
  }

  const email = String(body.email || "").trim().toLowerCase();
  const password = body.password;

  if (!validEmail(email) || !validPassword(password)) {
    return json({
      success: false,
      message: "Enter a valid email and a password of at least 12 characters."
    }, 400);
  }

  const id = crypto.randomUUID();

  try {
    const passwordHash = await hashPassword(password);

    await env.DB
      .prepare(`
        INSERT INTO users (
          id, email, password_hash, role
        )
        VALUES (?, ?, ?, 'customer')
      `)
      .bind(id, email, passwordHash)
      .run();

    const token = await createSession(id, env);

    return json({
      success: true,
      message: "Customer account created.",
      user: {
        id,
        email,
        role: "customer"
      }
    }, 201, {
      "Set-Cookie": sessionCookie(token)
    });

  } catch (error) {
    console.error("FOGGY customer registration:", error);

    return json({
      success: false,
      message: "An account with these details may already exist."
    }, 409);
  }
}

async function registerArtist(request, env) {
  let body;

  try {
    body = await readBody(request);
  } catch {
    return json({ success: false, message: "Invalid request." }, 400);
  }

  const email = String(body.email || "").trim().toLowerCase();
  const artistName = String(body.artistName || "").trim();
  const phone = String(body.phone || "").replace(/[\s()-]/g, "");
  const bio = typeof body.bio === "string"
    ? body.bio.trim()
    : "";

  const password = body.password;

  if (
    !validEmail(email) ||
    !validPassword(password) ||
    artistName.length < 2 ||
    artistName.length > 40 ||
    !validPhone(phone) ||
    bio.length > 500
  ) {
    return json({
      success: false,
      message: "Check your email, password, artist name, phone number and bio."
    }, 400);
  }

  const userId = crypto.randomUUID();
  const artistId = crypto.randomUUID();

  try {
    const passwordHash = await hashPassword(password);

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (
          id, email, password_hash, role
        )
        VALUES (?, ?, ?, 'artist')
      `).bind(userId, email, passwordHash),

      env.DB.prepare(`
        INSERT INTO artists (
          id, user_id, artist_name, contact_phone
        )
        VALUES (?, ?, ?, ?)
      `).bind(artistId, userId, artistName, phone)
    ]);

    const token = await createSession(userId, env);

    return json({
      success: true,
      message: "Artist account created.",
      user: {
        id: userId,
        email,
        role: "artist",
        artist: {
          id: artistId,
          name: artistName,
          phoneVerified: false
        }
      }
    }, 201, {
      "Set-Cookie": sessionCookie(token)
    });

  } catch (error) {
    console.error("FOGGY artist registration:", error);

    return json({
      success: false,
      message: "That email address or artist name may already be registered."
    }, 409);
  }
}

async function login(request, env, expectedRole) {
  let body;

  try {
    body = await readBody(request);
  } catch {
    return json({ success: false, message: "Invalid request." }, 400);
  }

  const email = String(body.email || "").trim().toLowerCase();
  const password = body.password;

  if (
    !validEmail(email) ||
    typeof password !== "string" ||
    password.length > 128
  ) {
    return json({
      success: false,
      message: "Invalid email or password."
    }, 401);
  }

  try {
    const user = await env.DB
      .prepare(`
        SELECT
          users.id,
          users.email,
          users.password_hash,
          users.role,
          users.account_status,
          artists.id AS artist_id,
          artists.artist_name,
          artists.status AS artist_status,
          artists.phone_verified
        FROM users
        LEFT JOIN artists
          ON artists.user_id = users.id
        WHERE users.email = ?
        LIMIT 1
      `)
      .bind(email)
      .first();

    if (
      !user ||
      user.role !== expectedRole ||
      user.account_status !== "active" ||
      !(await verifyPassword(password, user.password_hash)) ||
      (
        expectedRole === "artist" &&
        (!user.artist_id || user.artist_status !== "active")
      )
    ) {
      return json({
        success: false,
        message: "Invalid email or password."
      }, 401);
    }

    const token = await createSession(user.id, env);

    return json({
      success: true,
      message: "Login successful.",
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        artist: user.artist_id
          ? {
              id: user.artist_id,
              name: user.artist_name,
              phoneVerified: Boolean(user.phone_verified)
            }
          : null
      }
    }, 200, {
      "Set-Cookie": sessionCookie(token)
    });

  } catch (error) {
    console.error("FOGGY login:", error);

    return json({
      success: false,
      message: "Unable to log in right now."
    }, 500);
  }
}

async function logout(request, env) {
  const token = getCookie(request, COOKIE_NAME);

  if (token) {
    const tokenHash = await hashToken(token);

    await env.DB
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .run();
  }

  return json({
    success: true,
    message: "Logged out."
  }, 200, {
    "Set-Cookie": clearSessionCookie()
  });
}

export async function handleAuth(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (!path.startsWith("/api/auth/")) return null;

  if (method !== "GET" && !validOrigin(request)) {
    return json({
      success: false,
      message: "Invalid request origin."
    }, 403);
  }

  try {
    if (
      path === "/api/auth/customer/register" &&
      method === "POST"
    ) {
      return await registerCustomer(request, env);
    }

    if (
      path === "/api/auth/artist/register" &&
      method === "POST"
    ) {
      return await registerArtist(request, env);
    }

    if (
      path === "/api/auth/customer/login" &&
      method === "POST"
    ) {
      return await login(request, env, "customer");
    }

    if (
      path === "/api/auth/artist/login" &&
      method === "POST"
    ) {
      return await login(request, env, "artist");
    }

    if (
      path === "/api/auth/logout" &&
      method === "POST"
    ) {
      return await logout(request, env);
    }

    if (
      path === "/api/auth/me" &&
      method === "GET"
    ) {
      const user = await getCurrentUser(request, env);

      return user
        ? json({ success: true, user })
        : json({
            success: false,
            message: "Not authenticated."
          }, 401);
    }

    return json({
      success: false,
      message: "Authentication endpoint not found."
    }, 404);

  } catch (error) {
    console.error("FOGGY authentication error:", error);

    return json({
      success: false,
      message: "Authentication service error."
    }, 500);
  }
}
