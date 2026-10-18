#!/usr/bin/env node
/** Build main's real app, capture it, then compose the recordings without redrawing UI. */
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile, copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const generated = join(here, ".generated");
const assets = join(root, "assets");
const env = { ...process.env, NODE_OPTIONS: "--max-old-space-size=1024" };
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} exited ${result.status}`);
}
await mkdir(generated, { recursive: true });
await mkdir(assets, { recursive: true });
if (!process.argv.includes("--reuse-captures")) {
  run("git", [
    "diff",
    "--exit-code",
    "origin/main",
    "--",
    "app",
    "nuxt.config.ts",
  ]);
  if (!process.argv.includes("--skip-build")) run("npm", ["run", "build:demo"]);
  run(process.execPath, [join(here, "capture.mjs")]);
}
const evidence = JSON.parse(
  await readFile(join(generated, "capture.json"), "utf8"),
);
for (const frame of evidence.frames) {
  const bytes = await readFile(join(generated, frame.file));
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    frame.sha256,
    `Captured source changed: ${frame.file}`,
  );
}
const titles = {
  desktop: "Start on your computer.",
  mobile: "Same agent. On your phone.",
  board: "Your workspace. Everywhere.",
};
const encode = [
  "-an",
  "-r",
  "30",
  "-c:v",
  "libx264",
  "-preset",
  "fast",
  "-crf",
  "22",
  "-pix_fmt",
  "yuv420p",
  "-threads",
  "2",
];
for (const [width, name] of [
  [1080, "wherdr-launch.mp4"],
  [1920, "wherdr-launch-wide.mp4"],
]) {
  const parts = [];
  for (const [segment, count] of [
    ["desktop", 36],
    ["mobile", 144],
    ["board", 45],
  ]) {
    const output = join(generated, `${width}-${segment}.mp4`);
    const input = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-framerate",
      "15",
      "-i",
      join(generated, segment, "%03d.png"),
    ];
    let filter;
    if (segment === "mobile" && width === 1920) {
      // Both panels are actual screenshots. The left is the last PC frame before handoff.
      input.push("-loop", "1", "-i", join(generated, "desktop", "035.png"));
      filter = `[0:v]scale=-2:900,pad=1920:1080:1390:100:color=0x12151b[phone];[1:v]scale=1056:660[pc];[phone][pc]overlay=64:218:shortest=1`;
    } else {
      filter = `[0:v]scale=${width}:900:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:1080:(ow-iw)/2:(oh-ih)/2+20:color=0x12151b`;
    }
    filter += `,drawtext=text='${titles[segment]}':fontcolor=0xe6eaf2:fontsize=32:x=(w-tw)/2:y=38${segment === "mobile" ? ":enable='lt(t,7.6)'" : ""}`;
    if (segment === "mobile")
      filter +=
        ",drawtext=text='Keep projects moving.':fontcolor=0xe6eaf2:fontsize=32:x=(w-tw)/2:y=38:enable='gte(t,7.6)'";
    filter +=
      ",drawtext=text=wherdr.dev:fontcolor=0x9da5b4:fontsize=20:x=(w-tw)/2:y=1040,setsar=1[v]";
    run("ffmpeg", [
      ...input,
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-frames:v",
      String(count * 2),
      ...encode,
      output,
    ]);
    parts.push(output);
  }
  const concat = join(generated, `${width}-concat.txt`);
  await writeFile(
    concat,
    parts.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n"),
  );
  run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concat,
    "-c",
    "copy",
    "-movflags",
    "+faststart+use_metadata_tags",
    "-metadata",
    "wherdr_capture=playwright-real-app",
    "-metadata",
    `wherdr_app_tree=${evidence.appTree}`,
    join(assets, name),
  ]);
}
run("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-i",
  join(assets, "wherdr-launch.mp4"),
  "-an",
  "-vf",
  "fps=15,scale=720:720:flags=lanczos",
  "-c:v",
  "libwebp_anim",
  "-quality",
  "72",
  "-compression_level",
  "4",
  "-loop",
  "0",
  "-threads",
  "2",
  join(assets, "wherdr-launch.webp"),
]);
await copyFile(join(generated, "capture.json"), join(here, "capture.json"));
run(process.execPath, [join(here, "verify.mjs")]);
for (const name of [
  "wherdr-launch.mp4",
  "wherdr-launch-wide.mp4",
  "wherdr-launch.webp",
])
  console.log(
    `${name}: ${((await stat(join(assets, name))).size / 1024 / 1024).toFixed(2)} MiB`,
  );
