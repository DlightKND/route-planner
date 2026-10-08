// Serve the production build to a local test browser. No remote API or auth.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { build } from "esbuild";
const root = resolve("dist"),
  vendor = resolve("node_modules");
const turf = await build({
  stdin: { contents: "export * from '@turf/turf'", resolveDir: process.cwd() },
  bundle: true,
  format: "iife",
  globalName: "turf",
  write: false,
});
const fontCSS = ["sans", "mono"]
  .flatMap((face) =>
    [400, 500, 600, 700].flatMap((weight) =>
      ["latin", "cyrillic", "cyrillic-ext"].map(
        (subset) =>
          `@font-face{font-family:'IBM Plex ${face === "sans" ? "Sans" : "Mono"}';font-style:normal;font-weight:${weight};src:url('/qa-vendor/@fontsource/ibm-plex-${face}/files/ibm-plex-${face}-${subset}-${weight}-normal.woff2') format('woff2');font-display:block;${subset === "latin" ? "unicode-range:U+0000-00FF;" : subset === "cyrillic" ? "unicode-range:U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116;" : "unicode-range:U+0460-052F,U+2DE0-2DFF,U+A640-A69F;"}}`,
      ),
    ),
  )
  .join("\n");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (path === "/qa-turf.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(turf.outputFiles[0].text);
      return;
    }
    if (path === "/qa-fonts.css") {
      res.setHeader("Content-Type", "text/css");
      res.end(fontCSS);
      return;
    }
    const base = path.startsWith("/qa-vendor/") ? vendor : root;
    const rel =
      base === vendor
        ? path.slice("/qa-vendor/".length)
        : path.slice(1) || "index.html";
    if (
      base === vendor &&
      !/^(leaflet\/dist\/|@fontsource\/ibm-plex-(sans|mono)\/files\/)/.test(rel)
    )
      throw Error("Vendor denied");
    const file = resolve(base, rel);
    if (!file.startsWith(base + sep)) throw Error("Path denied");
    let bytes = await readFile(file);
    if (file.endsWith("index.html")) {
      let html = bytes.toString();
      html = html.replace(
        /<script[^>]+src="https:\/\/unpkg\.com\/@supabase[^>]+><\/script>/g,
        "",
      );
      html = html.replace(
        /<script[^>]+src="https:\/\/unpkg\.com\/leaflet[^>]+><\/script>/g,
        '<script src="/qa-vendor/leaflet/dist/leaflet.js"></script><script src="/qa-turf.js"></script>',
      );
      // Keep Leaflet at its production position, before the application's
      // overrides. Appending it to </head> changes popup colors and elevation.
      html = html.replace(
        /<link[^>]+href="https:\/\/unpkg\.com\/leaflet[^>]+>/g,
        '<link rel="stylesheet" href="/qa-vendor/leaflet/dist/leaflet.css">',
      );
      html = html.replace(/<link[^>]+href="https:\/\/fonts\.googleapis\.com[^>]+>/g, "");
      html = html.replace(
        "</head>",
        '<link rel="stylesheet" href="/qa-fonts.css"></head>',
      );
      bytes = html;
    }
    res.setHeader(
      "Content-Type",
      types[file.slice(file.lastIndexOf("."))] || "application/octet-stream",
    );
    res.end(bytes);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
});
server.listen(4173, "127.0.0.1", () =>
  console.log("Visual QA build server: http://127.0.0.1:4173"),
);
