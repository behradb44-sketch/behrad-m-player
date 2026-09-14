export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
