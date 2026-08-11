export default {
  fetch(request) {
    const target = new URL(request.url);
    target.protocol = "https:";
    target.hostname = "getcaughtup.io";
    target.port = "";

    return Response.redirect(target.toString(), 301);
  },
};
