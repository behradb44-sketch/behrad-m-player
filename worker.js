function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8"
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

    // ==========================================
    // تست اتصال D1
    // ==========================================
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

    // ==========================================
    // ثبت نام
    // ==========================================
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

        // بررسی نام
        if (name.length < 2 || name.length > 50) {
          return jsonResponse(
            {
              ok: false,
              message: "Name must be between 2 and 50 characters."
            },
            400
          );
        }

        // بررسی ایمیل
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

        // بررسی رمز
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

        // بررسی اینکه ایمیل قبلاً ثبت نشده باشد
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

        // ساخت Salt تصادفی
        const salt = generateSalt();

        // هش امن رمز
        const passwordHash = await hashPassword(
          password,
          salt
        );

        // ترکیب salt و hash برای ذخیره در یک فیلد
        const storedPasswordHash =
          `pbkdf2$100000$${salt}$${passwordHash}`;

        // ذخیره کاربر
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

    // ==========================================
    // صفحه / وضعیت اصلی Worker
    // ==========================================
    return jsonResponse({
      ok: true,
      message: "BEHRAD M PLAYER API is online 🚀",
      path: url.pathname,
      database: !!env.DB
    });
  }
};
