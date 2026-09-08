export default {
  async fetch(request) {
    const url = new URL(request.url);
    return Response.redirect(`https://agentsquare.a-u.us${url.pathname}${url.search}`, 301);
  },
};
