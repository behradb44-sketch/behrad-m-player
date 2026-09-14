const ALLOWED_ORIGIN = "https://behradb44-sketch.github.io";

const SESSION_DAYS = 30;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

// ==========================================
// CORS
// ==========================================

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

// ==========================================
// JSON RESPONSE
// ==========================================

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

// ==========================================
// TOKEN
// ==========================================

function getToken(request) {
  const authorization =
    request.headers.get("Authorization") || "";

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice(7).trim() || null;
}

function createToken() {
  const bytes = new Uint8Array(32);

  crypto.getRandomValues(bytes);

  return Array.from(bytes)
    .map((byte) =>
      byte.toString(16).padStart(2, "0")
    )
    .join("");
}

// ==========================================
// PASSWORD HASH
// ==========================================

async function hashPassword(password) {
  const data = new TextEncoder().encode(password);

  const hash = await crypto.subtle.digest(
    "SHA-256",
    data
  );

  return Array.from(new Uint8Array(hash))
    .map((byte) =>
      byte.toString(16).padStart(2, "0")
    )
    .join("");
}

// ==========================================
// GET CURRENT USER
// ==========================================

async function getUser(request, env) {
  const token = getToken(request);

  if (!token) {
    return null;
  }

  const now = new Date().toISOString();

  const user = await env.DB
    .prepare(`
      SELECT
        users.id AS user_id,
        users.username,
        users.name
      FROM sessions
      INNER JOIN users
        ON users.id = sessions.user_id
      WHERE sessions.token = ?
        AND sessions.expires_at > ?
      LIMIT 1
    `)
    .bind(token, now)
    .first();

  return user || null;
}

// ==========================================
// CREATE SESSION
// ==========================================

async function createSession(env, userId) {
  const token = createToken();

  const createdAt = new Date();

  const expiresAt = new Date(
    createdAt.getTime() +
      SESSION_DAYS * 24 * 60 * 60 * 1000
  );

  await env.DB
    .prepare(`
      INSERT INTO sessions
      (
        user_id,
        token,
        expires_at
      )
      VALUES (?, ?, ?)
    `)
    .bind(
      userId,
      token,
      expiresAt.toISOString()
    )
    .run();

  return token;
}

// ==========================================
// MAIN WORKER
// ==========================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ========================================
    // CORS PREFLIGHT
    // ========================================

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    try {
      // ======================================
      // HOME
      // ======================================

      if (
        request.method === "GET" &&
        path === "/"
      ) {
        return json({
          ok: true,
          service: "BEHRAD M PLAYER API",
          status: "online",
        });
      }

      // ======================================
      // HEALTH
      // ======================================

      if (
        request.method === "GET" &&
        path === "/api/health"
      ) {
        await env.DB
          .prepare("SELECT 1")
          .first();

        return json({
          ok: true,
          status: "online",
          database: true,
        });
      }

      // ======================================
      // REGISTER
      // ======================================

      if (
        request.method === "POST" &&
        path === "/api/register"
      ) {
        const body = await request.json();

        const username = String(
          body.username || ""
        )
          .trim()
          .toLowerCase();

        const name = String(
          body.name || ""
        ).trim();

        const password = String(
          body.password || ""
        );

        // ------------------------------
        // VALIDATION
        // ------------------------------

        if (!username || !name || !password) {
          return json(
            {
              ok: false,
              error:
                "نام کاربری، اسم و رمز عبور الزامی هستند.",
            },
            400
          );
        }

        if (
          username.length < 3 ||
          username.length > 30
        ) {
          return json(
            {
              ok: false,
              error:
                "نام کاربری باید بین ۳ تا ۳۰ کاراکتر باشد.",
            },
            400
          );
        }

        if (
          !/^[a-zA-Z0-9_.-]+$/.test(username)
        ) {
          return json(
            {
              ok: false,
              error:
                "نام کاربری فقط می‌تواند شامل حروف انگلیسی، عدد، نقطه، خط تیره و زیرخط باشد.",
            },
            400
          );
        }

        if (
          name.length < 2 ||
          name.length > 50
        ) {
          return json(
            {
              ok: false,
              error:
                "اسم باید بین ۲ تا ۵۰ کاراکتر باشد.",
            },
            400
          );
        }

        if (password.length < 6) {
          return json(
            {
              ok: false,
              error:
                "رمز عبور باید حداقل ۶ کاراکتر باشد.",
            },
            400
          );
        }

        // ------------------------------
        // CHECK USERNAME
        // ------------------------------

        const existingUser =
          await env.DB
            .prepare(`
              SELECT id
              FROM users
              WHERE username = ?
              LIMIT 1
            `)
            .bind(username)
            .first();

        if (existingUser) {
          return json(
            {
              ok: false,
              error:
                "این نام کاربری قبلاً ثبت شده است.",
            },
            409
          );
        }

        // ------------------------------
        // PASSWORD HASH
        // ------------------------------

        const passwordHash =
          await hashPassword(password);

        // ------------------------------
        // CREATE USER
        // ------------------------------

        const now =
          new Date().toISOString();

        const result =
          await env.DB
            .prepare(`
              INSERT INTO users
              (
                email,
                username,
                name,
                password_hash,
                verified,
                created_at
              )
              VALUES (?, ?, ?, ?, ?, ?)
            `)
            .bind(
              `${username}@local.user`,
              username,
              name,
              passwordHash,
              1,
              now
            )
            .run();

        const userId =
          result.meta.last_row_id;

        // ------------------------------
        // CREATE SESSION
        // ------------------------------

        const token =
          await createSession(
            env,
            userId
          );

        return json({
          ok: true,

          user: {
            id: userId,
            username,
            name,
          },

          token,
        });
      }

      // ======================================
      // LOGIN
      // ======================================

      if (
        request.method === "POST" &&
        path === "/api/login"
      ) {
        const body = await request.json();

        const username = String(
          body.username || ""
        )
          .trim()
          .toLowerCase();

        const password = String(
          body.password || ""
        );

        if (!username || !password) {
          return json(
            {
              ok: false,
              error:
                "نام کاربری و رمز عبور را وارد کنید.",
            },
            400
          );
        }

        const passwordHash =
          await hashPassword(password);

        const user =
          await env.DB
            .prepare(`
              SELECT
                id,
                username,
                name
              FROM users
              WHERE username = ?
                AND password_hash = ?
              LIMIT 1
            `)
            .bind(
              username,
              passwordHash
            )
            .first();

        if (!user) {
          return json(
            {
              ok: false,
              error:
                "نام کاربری یا رمز عبور اشتباه است.",
            },
            401
          );
        }

        const token =
          await createSession(
            env,
            user.id
          );

        return json({
          ok: true,

          user: {
            id: user.id,
            username: user.username,
            name: user.name,
          },

          token,
        });
      }

      // ======================================
      // ME
      // ======================================

      if (
        request.method === "GET" &&
        path === "/api/me"
      ) {
        const user =
          await getUser(
            request,
            env
          );

        if (!user) {
          return json(
            {
              ok: false,
              loggedIn: false,
            },
            401
          );
        }

        return json({
          ok: true,
          loggedIn: true,

          user: {
            id: user.user_id,
            username: user.username,
            name: user.name,
          },
        });
      }

      // ======================================
      // GET MESSAGES
      // ======================================

      if (
        request.method === "GET" &&
        path === "/api/messages"
      ) {
        const result =
          await env.DB
            .prepare(`
              SELECT
                messages.id,
                messages.user_id,
                messages.message AS text,
                messages.reply_to,
                messages.created_at,
                users.username,
                users.name
              FROM messages
              INNER JOIN users
                ON users.id = messages.user_id
              ORDER BY messages.id ASC
              LIMIT 200
            `)
            .all();

        return json({
          ok: true,
          messages:
            result.results || [],
        });
      }

      // ======================================
      // SEND MESSAGE
      // ======================================

      if (
        request.method === "POST" &&
        path === "/api/messages"
      ) {
        const user =
          await getUser(
            request,
            env
          );

        if (!user) {
          return json(
            {
              ok: false,
              error:
                "ابتدا وارد حساب شوید.",
            },
            401
          );
        }

        const body =
          await request.json();

        const text = String(
          body.text || ""
        ).trim();

        let replyTo =
          body.reply_to ?? null;

        if (replyTo !== null) {
          replyTo = Number(replyTo);

          if (
            !Number.isInteger(replyTo)
          ) {
            replyTo = null;
          }
        }

        if (!text) {
          return json(
            {
              ok: false,
              error:
                "پیام نمی‌تواند خالی باشد.",
            },
            400
          );
        }

        if (text.length > 2000) {
          return json(
            {
              ok: false,
              error:
                "پیام بیش از حد طولانی است.",
            },
            400
          );
        }

        const now =
          new Date().toISOString();

        const result =
          await env.DB
            .prepare(`
              INSERT INTO messages
              (
                user_id,
                message,
                reply_to,
                created_at
              )
              VALUES (?, ?, ?, ?)
            `)
            .bind(
              user.user_id,
              text,
              replyTo,
              now
            )
            .run();

        return json({
          ok: true,

          message: {
            id:
              result.meta
                .last_row_id,

            user_id:
              user.user_id,

            text,

            reply_to:
              replyTo,

            created_at:
              now,

            username:
              user.username,

            name:
              user.name,
          },
        });
      }

      // ======================================
      // LOGOUT
      // ======================================

      if (
        request.method === "POST" &&
        path === "/api/logout"
      ) {
        const token =
          getToken(request);

        if (token) {
          await env.DB
            .prepare(`
              DELETE FROM sessions
              WHERE token = ?
            `)
            .bind(token)
            .run();
        }

        return json({
          ok: true,
        });
      }

      // ======================================
      // 404
      // ======================================

      return json(
        {
          ok: false,
          error: "NOT_FOUND",
        },
        404
      );

    } catch (error) {
      console.error(
        "WORKER ERROR:",
        error
      );

      return json(
        {
          ok: false,
          error:
            "خطای داخلی سرور.",
          details:
            String(
              error?.message ||
              error
            ),
        },
        500
      );
    }
  },
};
