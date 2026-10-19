#!/usr/bin/env node
/** Photograph the unmodified demo UI. Actions use its real controls and API. */
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveDemo } from "./serve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const generated = join(here, ".generated");
const fps = 15;
const git = (args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
git(["diff", "--exit-code", "origin/main", "--", "app", "nuxt.config.ts"]);
const provenance = {
  source: "Unmodified wherdr app, static app/demo build",
  mainCommit: git(["rev-parse", "origin/main"]),
  appTree: git(["rev-parse", "HEAD:app"]),
  uiChanges: false,
  overlaysInsideApp: false,
  fps,
  duration: 15,
  actions: [],
  frames: [],
};
await mkdir(generated, { recursive: true });
const server = await serveDemo(join(root, ".output-demo/public"));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "dark",
    reducedMotion: "reduce",
    hasTouch: false,
    serviceWorkers: "block",
  });
  const failures = [];
  const origin = new URL(server.url).origin;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && !/^\/(api|ws)\//.test(url.pathname))
      return route.continue();
    failures.push(url.pathname);
    await route.abort();
  });
  const page = await context.newPage();
  const device = await context.newCDPSession(page);
  page.on("pageerror", (error) => failures.push(error.message));
  await page.clock.install({ time: new Date("2026-01-01T09:41:00Z") });
  await page.goto(server.url);
  await page.getByRole("button", { name: "New", exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.locator("#newPrompt").fill("Run the test suite.");
  await page
    .getByRole("button", { name: "acme-api", exact: true })
    .last()
    .click();
  await page.locator("#newName").fill("Test suite");
  await page.locator("#newName").press("Tab");
  await page.clock.pauseAt(
    new Date((await page.evaluate(() => Date.now())) + 1000),
  );
  const start = await page.evaluate(() => Date.now());
  const tick = async (ms = 34) => {
    await page.clock.runFor(ms);
  };
  const until = async (check, label) => {
    for (let tries = 0; tries < 40; tries++) {
      if (await check()) return;
      await tick(50);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await page.screenshot({ path: join(generated, "failure.png") });
    throw new Error(`The real UI did not reach: ${label}`);
  };
  let conversation;
  async function action(frame, name, fn) {
    await fn();
    provenance.actions.push({
      at: frame / fps,
      action: name,
      route: new URL(page.url()).hash,
    });
  }
  for (let frame = 0; frame < 225; frame++) {
    const now = await page.evaluate(() => Date.now());
    await page.clock.runFor(
      Math.max(0, start + Math.round((frame * 1000) / fps) - now),
    );
    if (frame === 18)
      await action(
        frame,
        "Click Launch in the real New agent sheet",
        async () => {
          await page
            .getByRole("button", { name: "Launch", exact: true })
            .click({ force: true });
          await tick();
          await until(
            () => /#\/a\/w5:p1$/.test(page.url()),
            "new agent conversation",
          );
          conversation = page.url();
        },
      );
    if (frame === 36)
      await action(
        frame,
        "Resize the same live page to a phone; no reload or new session",
        async () => {
          await device.send("Emulation.setTouchEmulationEnabled", {
            enabled: true,
            maxTouchPoints: 1,
          });
          await page.setViewportSize({ width: 390, height: 844 });
          await tick();
          assert.equal(page.url(), conversation);
          assert.ok(
            (await page.locator("body").innerText()).includes(
              "Run the test suite.",
            ),
          );
        },
      );
    if (frame === 66) {
      assert.ok(
        (await page.locator(".choices").innerText()).includes(
          "Do you want to proceed?",
        ),
      );
    }
    if (frame === 72)
      await action(
        frame,
        "Approve once with the actual first Yes button",
        async () => {
          const yes = page.locator(".choices-list > button").first();
          assert.equal((await yes.locator(".l").innerText()).trim(), "Yes");
          await yes.click({ force: true });
          await tick();
          await until(
            async () => (await page.locator(".choices-list").count()) === 0,
            "approval accepted",
          );
        },
      );
    if (frame === 130) {
      await until(
        async () => /162\s+tests/.test(await page.locator("body").innerText()),
        "real demo test result",
      );
    }
    if (frame === 150)
      await action(
        frame,
        "Open the actual coordinator and its Project panel",
        async () => {
          await page
            .getByRole("button", { name: "Back", exact: true })
            .click({ force: true });
          await tick();
          await until(
            () => page.locator('.card[data-pane="w1:p1"]').isVisible(),
            "agent list",
          );
          await page.locator('.card[data-pane="w1:p1"]').click({ force: true });
          await tick();
          await until(
            () =>
              page
                .getByRole("button", { name: "Project", exact: true })
                .isVisible(),
            "Project control",
          );
          await page
            .getByRole("button", { name: "Project", exact: true })
            .click({ force: true });
          await tick();
          await until(
            async () =>
              (await page.locator(".project-panel").count()) > 0 &&
              (await page.locator(".project-panel").innerText())
                .toLowerCase()
                .includes("tasks"),
            "project tasks",
          );
        },
      );
    if (frame === 180)
      await action(
        frame,
        "Return to desktop and open the real Board",
        async () => {
          await device.send("Emulation.setTouchEmulationEnabled", {
            enabled: false,
          });
          await page.setViewportSize({ width: 1440, height: 900 });
          await tick();
          await page
            .locator('[aria-label="Board"]')
            .first()
            .click({ force: true });
          await tick();
          await until(
            async () => (await page.locator(".board-col").count()) === 4,
            "four board columns",
          );
        },
      );
    const segment = frame < 36 ? "desktop" : frame < 180 ? "mobile" : "board";
    const number = frame < 36 ? frame : frame < 180 ? frame - 36 : frame - 180;
    const directory = join(generated, segment);
    await mkdir(directory, { recursive: true });
    const filename = `${String(number).padStart(3, "0")}.png`;
    const bytes = await page.screenshot({
      path: join(directory, filename),
      type: "png",
      animations: "allow",
    });
    provenance.frames.push({
      at: frame / fps,
      file: `${segment}/${filename}`,
      viewport: page.viewportSize(),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    if (frame % 30 === 0)
      console.log(`Captured real app frame ${frame + 1}/225 (${segment})`);
  }
  assert.deepEqual(
    failures,
    [],
    "No external requests, real API calls or browser errors",
  );
  await writeFile(
    join(generated, "capture.json"),
    JSON.stringify(provenance, null, 2) + "\n",
  );
  await context.close();
} finally {
  if (browser) await browser.close();
  await server.close();
}
