export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // CORS
    // =========================
    const origin = request.headers.get("Origin");

    const allowedOrigins = [
      "https://behradb44-sketch.github.io",
      "http://localhost:3000",
      "http://127.0.0.1:5500",
      "http://localhost:5500"
    ];

    const corsOrigin =
      origin && allowedOrigins.includes(origin)
        ? origin
        : "*";

    const corsHeaders = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400"
    };

    // =========================
    // OPTIONS / CORS
    // =========================
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // =========================
    // Helper: JSON response
    // =========================
    function json(data, status = 200) {
      return new Response(
        JSON.stringify(data),
        {
          status,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json; charset=UTF-8"
          }
        }
      );
    }

    // =========================
    // ROOT
    // =========================
    if (url.pathname === "/" && request.method === "GET") {
      return json({
        ok: true,
        message: "BEHRAD M PLAYER API is running 🚀"
      });
    }

    // =========================
    // TEST DATABASE
    // =========================
    if (
      url.pathname === "/api/test-db" &&
      request.method === "GET"
    ) {
      try {
        const tables = await env.DB
          .prepare(`
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
            ORDER BY name
          `)
          .all();

        return json({
          ok: true,
          message: "D1 Database connected successfully 🚀",
          database: true,
          tables: tables.results || []
        });

      } catch (error) {
        return json({
          ok: false,
          message: "Database connection failed ❌",
          error: error.message
        }, 500);
      }
    }

    // =========================================================
    // USER REGISTRATION
    // NAME + USERNAME
    // =========================================================
    if (
      url.pathname === "/api/visitor-signup" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        const name =
          typeof body.name === "string"
            ? body.name.trim()
            : "";

        const username =
          typeof body.username === "string"
            ? body.username.trim()
            : "";

        // -------------------------
        // Validate name
        // -------------------------
        if (!name) {
          return json({
            ok: false,
            message: "لطفاً اسم خودت را وارد کن."
          }, 400);
        }

        if (name.length < 2 || name.length > 50) {
          return json({
            ok: false,
            message: "اسم باید بین ۲ تا ۵۰ کاراکتر باشد."
          }, 400);
        }

        // -------------------------
        // Validate username
        // -------------------------
        if (!username) {
          return json({
            ok: false,
            message: "لطفاً نام کاربری را وارد کن."
          }, 400);
        }

        if (username.length < 3 || username.length > 30) {
          return json({
            ok: false,
            message: "نام کاربری باید بین ۳ تا ۳۰ کاراکتر باشد."
          }, 400);
        }

        // فقط:
        // حروف انگلیسی
        // عدد
        // _
        // -
        const usernameRegex = /^[a-zA-Z0-9_-]+$/;

        if (!usernameRegex.test(username)) {
          return json({
            ok: false,
            message:
              "نام کاربری فقط می‌تواند شامل حروف انگلیسی، عدد، _ و - باشد."
          }, 400);
        }

        // =====================================================
        // Normalize username
        // برای جلوگیری از:
        //
        // Behrad
        // BEHRAD
        // behrad
        //
        // به عنوان سه کاربر متفاوت
        // =====================================================
        const usernameNormalized =
          username.toLowerCase();

        // =====================================================
        // CHECK DUPLICATE USERNAME
        // =====================================================
        const existingUser = await env.DB
          .prepare(`
            SELECT id, name, username
            FROM visitors
            WHERE username_normalized = ?
            LIMIT 1
          `)
          .bind(usernameNormalized)
          .first();

        if (existingUser) {
          return json({
            ok: false,
            message: "این نام کاربری قبلاً انتخاب شده است."
          }, 409);
        }

        // =====================================================
        // INSERT NEW USER
        // =====================================================
        try {
          const result = await env.DB
            .prepare(`
              INSERT INTO visitors
              (
                name,
                username,
                username_normalized
              )
              VALUES (?, ?, ?)
            `)
            .bind(
              name,
              username,
              usernameNormalized
            )
            .run();

          return json({
            ok: true,
            message: "ثبت نام با موفقیت انجام شد! 🎉",
            user: {
              id: result.meta?.last_row_id || null,
              name: name,
              username: username
            }
          }, 201);

        } catch (insertError) {

          // ===================================================
          // اگر همزمان دو نفر یک username را ثبت کنند،
          // UNIQUE INDEX جلوی ثبت دومی را می‌گیرد.
          // ===================================================
          const errorText =
            String(insertError.message || "").toLowerCase();

          if (
            errorText.includes("unique") ||
            errorText.includes("constraint")
          ) {
            return json({
              ok: false,
              message: "این نام کاربری قبلاً انتخاب شده است."
            }, 409);
          }

          throw insertError;
        }

      } catch (error) {

        console.error(
          "Visitor signup error:",
          error
        );

        return json({
          ok: false,
          message: "خطایی در ثبت نام رخ داد.",
          error: error.message
        }, 500);
      }
    }

    // =========================================================
    // ADMIN SIGNUP
    // این بخش برای ثبت‌نام مدیر سایت است و دست نمی‌زنیم.
    // =========================================================
    if (
      url.pathname === "/api/signup" &&
      request.method === "POST"
    ) {
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

        if (!name || !email || !password) {
          return json({
            ok: false,
            message: "Name, email and password are required."
          }, 400);
        }

        if (name.length < 2 || name.length > 100) {
          return json({
            ok: false,
            message: "Invalid name."
          }, 400);
        }

        if (
          !email.includes("@") ||
          email.length < 5 ||
          email.length > 150
        ) {
          return json({
            ok: false,
            message: "Invalid email."
          }, 400);
        }

        if (password.length < 6) {
          return json({
            ok: false,
            message:
              "Password must be at least 6 characters."
          }, 400);
        }

        // ==========================================
        // Check existing email
        // ==========================================
        const existing = await env.DB
          .prepare(`
            SELECT id
            FROM users
            WHERE email = ?
            LIMIT 1
          `)
          .bind(email)
          .first();

        if (existing) {
          return json({
            ok: false,
            message: "This email is already registered."
          }, 409);
        }

        // ==========================================
        // PBKDF2 password hashing
        // ==========================================
        const encoder =
          new TextEncoder();

        const saltBytes =
          crypto.getRandomValues(
            new Uint8Array(16)
          );

        const passwordKey =
          await crypto.subtle.importKey(
            "raw",
            encoder.encode(password),
            {
              name: "PBKDF2"
            },
            false,
            ["deriveBits"]
          );

        const hashBuffer =
          await crypto.subtle.deriveBits(
            {
              name: "PBKDF2",
              salt: saltBytes,
              iterations: 100000,
              hash: "SHA-256"
            },
            passwordKey,
            256
          );

        const hashArray =
          Array.from(
            new Uint8Array(hashBuffer)
          );

        const salt =
          Array.from(saltBytes);

        const hashHex =
          hashArray
            .map(
              b =>
                b.toString(16).padStart(2, "0")
            )
            .join("");

        const saltHex =
          salt
            .map(
              b =>
                b.toString(16).padStart(2, "0")
            )
            .join("");

        const passwordHash =
          `${saltHex}:${hashHex}`;

        // ==========================================
        // Create account
        // ==========================================
        const result =
          await env.DB
            .prepare(`
              INSERT INTO users
              (
                name,
                email,
                password_hash,
                verified
              )
              VALUES (?, ?, ?, 0)
            `)
            .bind(
              name,
              email,
              passwordHash
            )
            .run();

        return json({
          ok: true,
          message: "Account created successfully 🎉",
          user: {
            id:
              result.meta?.last_row_id || null,
            name,
            email,
            verified: false
          }
        }, 201);

      } catch (error) {

        console.error(
          "Admin signup error:",
          error
        );

        return json({
          ok: false,
          message: "Account creation failed.",
          error: error.message
        }, 500);
      }
    }

    // =========================================================
    // 404
    // =========================================================
    return json({
      ok: false,
      message: "API endpoint not found."
    }, 404);
  }
};
