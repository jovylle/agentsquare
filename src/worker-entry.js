// Redirect workers.dev → agentsquare.a-u.us, then delegate to OpenNext
import ogHandler from "../.open-next/worker.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname.endsWith(".workers.dev")) {
      return Response.redirect(
        `https://agentsquare.a-u.us${url.pathname}${url.search}`,
        301,
      );
    }
    return ogHandler.fetch(request, env, ctx);
  },
};
