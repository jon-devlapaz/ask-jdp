// Kept self-contained because Sites copies this file directly to dist/server/index.js.
const unknownRouteDocument = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page not found — Ask JDP</title>
<style>:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#07080a;color:#f9f9f9}body{margin:0;padding:40px;min-height:80vh}header{font-size:18px;font-weight:600}main{max-width:560px;margin:22vh auto 0}h1{font-size:28px;font-weight:500;letter-spacing:-.03em}p{color:#cecece;line-height:1.6}a{color:#cecece;text-underline-offset:5px}a:hover{color:#f9f9f9}a:focus-visible{outline:2px solid #976b68;outline-offset:6px}</style></head>
<body><header>JDP.</header><main><h1>Page not found</h1><p>This address isn’t a page on Ask JDP.</p><a href="/">Return to Ask JDP</a></main></body></html>`;

export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    const url = new URL(request.url);

    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)
      || url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return response;
    }

    if (url.pathname !== "/") {
      return new Response(request.method === "HEAD" ? null : unknownRouteDocument, {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    url.pathname = "/index.html";
    url.search = "";
    return env.ASSETS.fetch(new Request(url, request));
  },
};
