function jsonResponse(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store"
    }
  });
}

function corsOrigin(request) {
  const origin = request.headers.get("Origin");

  const allowedOrigins = [
    "https://behradb44-sketch.github.io",
    "http://localhost:3000",
    "http://127.0.0.1:5500",
    "http://localhost:5500"
  ];

  if (origin && allowedOrigins.includes(origin)) {
    return origin;
  }

  return "*";
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function generateSalt() {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return bytesToHex(salt);
}

async function hashPassword(password, saltHex) {
  const saltBytes = new Uint8Array(
    saltHex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16))
  );

  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    {
      name: "PBKDF2"
    },
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: 100000,
      hash: "SHA-256"
    },
    passwordKey,
    256
  );

  return bytesToHex(new Uint8Array(derivedBits));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = corsOrigin(request);

    // =========================
    // CORS PREFLIGHT
    // =========================
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    // =========================
    // TEST API
    // =========================
    if (url.pathname === "/api/test-db") {
      try {
        const result = await env.DB
          .prepare(`
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
            ORDER BY name
          `)
          .all();

        return jsonResponse(
          {
            ok: true,
            message: "D1 Database connected successfully 🚀",
            database: true,
            tables: result.results
          },
          200,
          origin
        );

      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            message: "D1 Database query failed ❌",
            error: error.message
          },
          500,
          origin
        );
      }
    }

    // =========================
    // VISITOR SIGNUP
    // =========================
    if (url.pathname === "/api/visitor-signup") {

      if (request.method !== "POST") {
        return jsonResponse(
          {
            ok: false,
            message: "Only POST requests are allowed."
          },
          405,
          origin
        );
      }

      try {
        const contentType =
          request.headers.get("Content-Type") || "";

        if (!contentType.toLowerCase().includes("application/json")) {
          return jsonResponse(
            {
              ok: false,
              message: "Request must use application/json."
            },
            415,
            origin
          );
        }

        const body = await request.json();

        const name =
          typeof body.name === "string"
            ? body.name.trim()
            : "";

        const phone =
          typeof body.phone === "string"
            ? body.phone.trim()
            : "";

        // -------------------------
        // NAME VALIDATION
        // -------------------------
        if (name.length < 2 || name.length > 50) {
          return jsonResponse(
            {
              ok: false,
              message: "Name must be between 2 and 50 characters."
            },
            400,
            origin
          );
        }

        // -------------------------
        // PHONE VALIDATION
        // -------------------------
        if (!/^[0-9+\-\s()]{7,20}$/.test(phone)) {
          return jsonResponse(
            {
              ok: false,
              message: "Please enter a valid phone number."
            },
            400,
            origin
          );
        }

        // -------------------------
        // CHECK DUPLICATE PHONE
        // -------------------------
        const existingVisitor = await env.DB
          .prepare(`
            SELECT id, name, phone
            FROM visitors
            WHERE phone = ?
            LIMIT 1
          `)
          .bind(phone)
          .first();

        if (existingVisitor) {
          return jsonResponse(
            {
              ok: false,
              message: "This phone number is already registered."
            },
            409,
            origin
          );
        }

        // -------------------------
        // INSERT VISITOR
        // -------------------------
        const result = await env.DB
          .prepare(`
            INSERT INTO visitors (
              name,
              phone
            )
            VALUES (?, ?)
          `)
          .bind(name, phone)
          .run();

        return jsonResponse(
          {
            ok: true,
            message: "Registration successful 🎉",
            visitor: {
              id: result.meta.last_row_id,
              name: name,
              phone: phone
            }
          },
          201,
          origin
        );

      } catch (error) {

        console.error(
          "VISITOR SIGNUP ERROR:",
          error
        );

        return jsonResponse(
          {
            ok: false,
            message: "Visitor registration failed ❌",
            error: error.message
          },
          500,
          origin
        );
      }
    }

    // =========================
    // ADMIN SIGNUP
    // =========================
    if (url.pathname === "/api/signup") {

      if (request.method !== "POST") {
        return jsonResponse(
          {
            ok: false,
            message: "Only POST requests are allowed."
          },
          405,
          origin
        );
      }

      try {
        const body = await request.json();

        const name =
          typeof body.name === "string"
            ? body.name.trim()
            : "";

        const email =
          typeof body.email === "string"
            ? body.email.trim().toLowerCase()
            : "";

        const password =
          typeof body.password === "string"
            ? body.password
            : "";

        // -------------------------
        // NAME
        // -------------------------
        if (name.length < 2 || name.length > 50) {
          return jsonResponse(
            {
              ok: false,
              message: "Name must be between 2 and 50 characters."
            },
            400,
            origin
          );
        }

        // -------------------------
        // EMAIL
        // -------------------------
        const emailRegex =
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(email)) {
          return jsonResponse(
            {
              ok: false,
              message: "Please enter a valid email address."
            },
            400,
            origin
          );
        }

        // -------------------------
        // PASSWORD
        // -------------------------
        if (password.length < 8) {
          return jsonResponse(
            {
              ok: false,
              message: "Password must be at least 8 characters."
            },
            400,
            origin
          );
        }

        if (password.length > 128) {
          return jsonResponse(
            {
              ok: false,
              message: "Password is too long."
            },
            400,
            origin
          );
        }

        // -------------------------
        // CHECK EMAIL
        // -------------------------
        const existingUser = await env.DB
          .prepare(`
            SELECT id
            FROM users
            WHERE email = ?
            LIMIT 1
          `)
          .bind(email)
          .first();

        if (existingUser) {
          return jsonResponse(
            {
              ok: false,
              message: "This email is already registered."
            },
            409,
            origin
          );
        }

        // -------------------------
        // PASSWORD HASH
        // -------------------------
        const salt = generateSalt();

        const passwordHash =
          await hashPassword(
            password,
            salt
          );

        const storedPasswordHash =
          `pbkdf2$100000$${salt}$${passwordHash}`;

        // -------------------------
        // INSERT USER
        // -------------------------
        const result = await env.DB
          .prepare(`
            INSERT INTO users (
              email,
              name,
              password_hash,
              verified
            )
            VALUES (?, ?, ?, 0)
          `)
          .bind(
            email,
            name,
            storedPasswordHash
          )
          .run();

        return jsonResponse(
          {
            ok: true,
            message: "Account created successfully 🎉",
            user: {
              id: result.meta.last_row_id,
              name: name,
              email: email,
              verified: false
            }
          },
          201,
          origin
        );

      } catch (error) {

        console.error(
          "SIGNUP ERROR:",
          error
        );

        return jsonResponse(
          {
            ok: false,
            message: "Signup failed ❌",
            error: error.message
          },
          500,
          origin
        );
      }
    }

    // =========================
    // API ROOT
    // =========================
    return jsonResponse(
      {
        ok: true,
        message: "BEHRAD M PLAYER API is online 🚀",
        path: url.pathname,
        database: !!env.DB
      },
      200,
      origin
    );
  }
};
