export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/test-db") {
      return new Response(
        JSON.stringify({
          ok: true,
          db_binding_exists: !!env.DB,
          message: env.DB
            ? "DB binding is available ✅"
            : "DB binding is NOT available ❌"
        }),
        {
          headers: {
            "Content-Type": "application/json; charset=UTF-8"
          }
        }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        message: "BEHRAD M PLAYER API is online 🚀",
        path: url.pathname,
        database: !!env.DB
      }),
      {
        headers: {
          "Content-Type": "application/json; charset=UTF-8"
        }
      }
    );
  }
};
