// Static host for the Relay web app: serves the built frontend from the
// "app" storage bucket with proper content types (storage's public endpoint
// sandboxes HTML, so we serve it ourselves). Deploy with --no-verify-jwt.
import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "application/javascript",
  css: "text/css",
  svg: "image/svg+xml",
  webmanifest: "application/manifest+json",
  json: "application/json",
  png: "image/png",
  ico: "image/x-icon",
  wav: "audio/wav",
};

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // pathname arrives as /app or /app/<file>
  if (url.pathname === "/app") {
    return Response.redirect(url.origin + "/functions/v1/app/", 301);
  }
  let path = url.pathname.replace(/^\/app\//, "");
  if (!path || path.endsWith("/")) path = "index.html";

  const { data, error } = await admin.storage.from("app").download(path);
  if (error || !data) {
    // SPA fallback
    const { data: idx } = await admin.storage.from("app").download("index.html");
    if (!idx) return new Response("Not found", { status: 404 });
    return html(idx);
  }

  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "html") return html(data);
  return new Response(data, {
    headers: {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=300",
      ...(ext === "js" ? { "Service-Worker-Allowed": "/functions/v1/app/" } : {}),
    },
  });
});

function html(body: Blob) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
