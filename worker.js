function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    }
  });
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

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return jsonResponse({
        ok: true,
        message: "CORS preflight accepted."
      });
    }

    // ----------------------------------------
    // D1 TEST
    // ----------------------------------------
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

        return jsonResponse({
          ok: true,
          message: "D1 Database connected successfully 🚀",
          database: true,
          tables: result.results
        });
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            message: "D1 Database query failed ❌",
            error: error.message
          },
          500
        );
      }
    }

    // ----------------------------------------
    // VISITOR SIGNUP
    // Name + Phone
    // ----------------------------------------
    if (url.pathname === "/api/visitor-signup") {
      if (request.method !== "POST") {
        return jsonResponse(
          {
            ok: false,
            message: "Only POST requests are allowed."
          },
          405
        );
      }

      try {
        const body = await request.json();

        const name =
          typeof body.name === "string"
            ? body.name.trim()
            : "";

        const phone =
          typeof body.phone === "string"
            ? body.phone.trim()
            : "";

        // Validate name
        if (name.length < 2 || name.length > 50) {
          return jsonResponse(
            {
              ok: false,
              message: "Name must be between 2 and 50 characters."
            },
            400
          );
        }

        // Validate phone
        if (!/^[0-9+\-\s()]{7,20}$/.test(phone)) {
          return jsonResponse(
            {
              ok: false,
              message: "Please enter a valid phone number."
            },
            400
          );
        }

        // Check duplicate phone
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
            409
          );
        }

        // Insert visitor
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
          201
        );

      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            message: "Visitor registration failed ❌",
            error: error.message
          },
          500
        );
      }
    }

    // ----------------------------------------
    // ADMIN SIGNUP
    // Existing account system
    // ----------------------------------------
    if (url.pathname === "/api/signup") {
      if (request.method !== "POST") {
        return jsonResponse(
          {
            ok: false,
            message: "Only POST requests are allowed."
          },
          405
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

        if (name.length < 2 || name.length > 50) {
          return jsonResponse(
            {
              ok: false,
              message: "Name must be between 2 and 50 characters."
            },
            400
          );
        }

        const emailRegex =
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(email)) {
          return jsonResponse(
            {
              ok: false,
              message: "Please enter a valid email address."
            },
            400
          );
        }

        if (password.length < 8) {
          return jsonResponse(
            {
              ok: false,
              message: "Password must be at least 8 characters."
            },
            400
          );
        }

        if (password.length > 128) {
          return jsonResponse(
            {
              ok: false,
              message: "Password is too long."
            },
            400
          );
        }

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
            409
          );
        }

        const salt = generateSalt();
        const passwordHash = await hashPassword(
          password,
          salt
        );

        const storedPasswordHash =
          `pbkdf2$100000$${salt}$${passwordHash}`;

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
          201
        );

      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            message: "Signup failed ❌",
            error: error.message
          },
          500
        );
      }
    }

    // ----------------------------------------
    // DEFAULT
    // ----------------------------------------
    return jsonResponse({
      ok: true,
      message: "BEHRAD M PLAYER API is online 🚀",
      path: url.pathname,
      database: !!env.DB
    });
  }
};
