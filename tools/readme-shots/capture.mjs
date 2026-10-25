#!/usr/bin/env node
/**
 * README screenshots (docs/screenshots/) from the static demo build: the real
 * app with the invented data of app/demo/, nothing personal. Build it first
 * (`npm run build:demo`). The demo strip at the top is hidden; nothing else
 * in the app is changed.
 */
import { chromium, devices } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveDemo } from "../launch-video/serve.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(root, process.argv[2] || "docs/screenshots");
const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const phone = { ...devices["iPhone 13"], deviceScaleFactor: 2 };
const shots = [
  { file: "desktop.png", device: desktop, route: "#/a/w3:p1" },
  { file: "board.png", device: desktop, route: "#/board" },
  { file: "home-phone.png", device: phone, route: "" },
  { file: "chat-phone.png", device: phone, route: "#/a/w3:p1" },
];

await mkdir(out, { recursive: true });
const server = await serveDemo(join(root, ".output-demo/public"));
const origin = new URL(server.url).origin;
const browser = await chromium.launch();
try {
  for (const shot of shots) {
    const context = await browser.newContext({
      ...shot.device,
      locale: "en-US",
      timezoneId: "UTC",
      colorScheme: "dark",
      serviceWorkers: "block",
    });
    // Only the demo build itself: no network, no real API.
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.install({ time: new Date("2026-01-01T09:41:00Z") });
    // Start from the agent list so the demo session is connected, then go.
    await page.goto(server.url);
    await page.locator(".card[data-pane]").first().waitFor();
    if (shot.route) await page.evaluate((h) => { location.hash = h; }, shot.route);
    await page.addStyleTag({
      content: ".demo-banner { display: none !important } :root { --demo-h: 0px !important }",
    });
    await page.evaluate(() => document.fonts.ready);
    await page.clock.runFor(4000);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(out, shot.file), animations: "disabled" });
    if (errors.length) throw new Error(`${shot.file}: ${errors.join("; ")}`);
    console.log(`${shot.file} ← ${shot.route || "home"}`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
