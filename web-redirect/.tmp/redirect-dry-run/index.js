// src/index.js
var index_default = {
  fetch(request) {
    const target = new URL(request.url);
    target.protocol = "https:";
    target.hostname = "getcaughtup.io";
    target.port = "";
    return Response.redirect(target.toString(), 301);
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
