/** Serve only the static demo build, on loopback and an isolated review port. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wasm": "application/wasm",
};
export async function serveDemo(directory) {
  const root = resolve(directory);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const relative =
        decodeURIComponent(url.pathname).replace(/^\/demo\/?/, "") ||
        "index.html";
      const file = resolve(root, relative);
      if (file !== root && !file.startsWith(root + sep))
        throw new Error("Invalid path");
      const bytes = await readFile(file);
      res.writeHead(200, {
        "content-type": types[extname(file)] || "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(bytes);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  for (let port = 7690; port <= 7699; port++) {
    try {
      await new Promise((resolve, reject) => {
        const failed = (error) => {
          server.off("listening", ready);
          reject(error);
        };
        const ready = () => {
          server.off("error", failed);
          resolve();
        };
        server
          .once("error", failed)
          .once("listening", ready)
          .listen(port, "127.0.0.1");
      });
      return {
        url: `http://127.0.0.1:${port}/demo/`,
        close: () => new Promise((resolve) => server.close(resolve)),
      };
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error("No isolated review port available (7690–7699)");
}
