export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // تست اتصال به D1
    if (url.pathname === "/api/test-db") {
      try {
        const result = await env.DB
          .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
          .all();

        return new Response(
          JSON.stringify({
            ok: true,
            message: "D1 Database connected successfully 🚀",
            database: true,
            tables: result.results
          }),
          {
            headers: {
              "Content-Type": "application/json; charset=UTF-8"
            }
          }
        );
      } catch (error) {
        return new Response(
          JSON.stringify({
            ok: false,
            message: "D1 Database connection failed ❌",
            error: error.message
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json; charset=UTF-8"
            }
          }
        );
      }
    }

    // صفحه اصلی / وضعیت Worker
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
