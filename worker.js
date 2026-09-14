const ALLOWED_ORIGIN = "https://behradb44-sketch.github.io";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400"
  };
}

function json(data, status = 200, origin = ALLOWED_ORIGIN) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin)
    }
  });
}

function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateId() {
  return crypto.randomUUID();
}

async function getUser(request, env) {
  const auth = request.headers.get("Authorization");

  if (!auth || !auth.startsWith("Bearer ")) {
    return null;
  }

  const token = auth.slice(7).trim();

  if (!token) {
    return null;
  }

  const result = await env.DB.prepare(`
    SELECT
      users.id,
      users.username,
      users.name
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ?
      AND sessions.expires_at > ?
    LIMIT 1
  `)
    .bind(token, Date.now())
    .first();

  return result || null;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin)
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Home
      if (path === "/" && request.method === "GET") {
        return new Response("BEHRAD M PLAYER API is online 🚀", {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            ...corsHeaders(origin)
          }
        });
      }

      // Health check
      if (path === "/api/health" && request.method === "GET") {
        return json({
          ok: true,
          status: "online",
          service: "BEHRAD M PLAYER API"
        }, 200, origin);
      }

      // Register
      if (path === "/api/register" && request.method === "POST") {
        const body = await request.json();

        const username = String(body.username || "").trim();
        const name = String(body.name || "").trim();

        if (!username || !name) {
          return json({
            ok: false,
            error: "نام کاربری و نام الزامی هستند."
          }, 400, origin);
        }

        if (username.length < 3 || username.length > 24) {
          return json({
            ok: false,
            error: "نام کاربری باید بین ۳ تا ۲۴ کاراکتر باشد."
          }, 400, origin);
        }

        if (name.length < 1 || name.length > 40) {
          return json({
            ok: false,
            error: "نام باید بین ۱ تا ۴۰ کاراکتر باشد."
          }, 400, origin);
        }

        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
          return json({
            ok: false,
            error: "نام کاربری فقط می‌تواند شامل حروف انگلیسی، عدد و _ باشد."
          }, 400, origin);
        }

        const existingUser = await env.DB.prepare(`
          SELECT id
          FROM users
          WHERE username = ?
          LIMIT 1
        `)
          .bind(username)
          .first();

        if (existingUser) {
          return json({
            ok: false,
            error: "این نام کاربری قبلاً استفاده شده است."
          }, 409, origin);
        }

        const userId = generateId();
        const token = generateToken();

        const now = Date.now();
        const expiresAt = now + (30 * 24 * 60 * 60 * 1000);

        await env.DB.prepare(`
          INSERT INTO users (
            id,
            username,
            name,
            created_at
          )
          VALUES (?, ?, ?, ?)
        `)
          .bind(userId, username, name, now)
          .run();

        await env.DB.prepare(`
          INSERT INTO sessions (
            token,
            user_id,
            created_at,
            expires_at
          )
          VALUES (?, ?, ?, ?)
        `)
          .bind(token, userId, now, expiresAt)
          .run();

        return json({
          ok: true,
          token,
          user: {
            id: userId,
            username,
            name
          }
        }, 201, origin);
      }

      // Current user
      if (path === "/api/me" && request.method === "GET") {
        const user = await getUser(request, env);

        if (!user) {
          return json({
            ok: false,
            error: "نشست معتبر نیست."
          }, 401, origin);
        }

        return json({
          ok: true,
          user
        }, 200, origin);
      }

      // Get messages
      if (path === "/api/messages" && request.method === "GET") {
        const result = await env.DB.prepare(`
          SELECT
            messages.id,
            messages.text,
            messages.reply_to,
            messages.created_at,
            users.id AS user_id,
            users.username,
            users.name
          FROM messages
          JOIN users ON users.id = messages.user_id
          ORDER BY messages.created_at ASC
          LIMIT 200
        `).all();

        return json({
          ok: true,
          messages: result.results || []
        }, 200, origin);
      }

      // Send message
      if (path === "/api/messages" && request.method === "POST") {
        const user = await getUser(request, env);

        if (!user) {
          return json({
            ok: false,
            error: "برای ارسال پیام باید وارد حساب باشید."
          }, 401, origin);
        }

        const body = await request.json();

        const text = String(body.text || "").trim();

        let replyTo = null;

        if (
          body.replyTo !== undefined &&
          body.replyTo !== null &&
          body.replyTo !== ""
        ) {
          const parsedReply = Number(body.replyTo);

          if (!Number.isInteger(parsedReply)) {
            return json({
              ok: false,
              error: "replyTo نامعتبر است."
            }, 400, origin);
          }

          replyTo = parsedReply;
        }

        if (!text) {
          return json({
            ok: false,
            error: "پیام نمی‌تواند خالی باشد."
          }, 400, origin);
        }

        if (text.length > 2000) {
          return json({
            ok: false,
            error: "پیام نمی‌تواند بیشتر از ۲۰۰۰ کاراکتر باشد."
          }, 400, origin);
        }

        const now = Date.now();

        const result = await env.DB.prepare(`
          INSERT INTO messages (
            user_id,
            text,
            reply_to,
            created_at
          )
          VALUES (?, ?, ?, ?)
        `)
          .bind(user.id, text, replyTo, now)
          .run();

        return json({
          ok: true,
          message: {
            id: result.meta.last_row_id,
            user_id: user.id,
            username: user.username,
            name: user.name,
            text,
            reply_to: replyTo,
            created_at: now
          }
        }, 201, origin);
      }

      // Logout
      if (path === "/api/logout" && request.method === "POST") {
        const auth = request.headers.get("Authorization");

        if (auth && auth.startsWith("Bearer ")) {
          const token = auth.slice(7).trim();

          if (token) {
            await env.DB.prepare(`
              DELETE FROM sessions
              WHERE token = ?
            `)
              .bind(token)
              .run();
          }
        }

        return json({
          ok: true
        }, 200, origin);
      }

      // Old visitor signup endpoint
      if (path === "/api/visitor-signup" && request.method === "POST") {
        const body = await request.json();

        const name = String(body.name || "").trim();

        if (!name) {
          return json({
            ok: false,
            error: "نام الزامی است."
          }, 400, origin);
        }

        return json({
          ok: true,
          message: "ثبت شد."
        }, 200, origin);
      }

      // Not found
      return json({
        ok: false,
        error: "Endpoint not found."
      }, 404, origin);

    } catch (error) {
      console.error(error);

      return json({
        ok: false,
        error: "خطای داخلی سرور.",
        details: error?.message || "Unknown error"
      }, 500, origin);
    }
  }
};
