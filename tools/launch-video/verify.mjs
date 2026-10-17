#!/usr/bin/env node
/** Verify the deliverables, not just the rendering process exit status. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
const assets = fileURLToPath(new URL("../../assets/", import.meta.url));
for (const [name, width] of [
  ["wherdr-launch.mp4", 1080],
  ["wherdr-launch-wide.mp4", 1920],
]) {
  const path = assets + name;
  const info = JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
      { encoding: "utf8" },
    ),
  );
  assert.equal(
    info.streams.length,
    1,
    `${name}: exactly one video stream, no audio`,
  );
  assert.equal(info.format.tags.hyperframes_renderer, "hyperframes");
  const video = info.streams[0];
  assert.equal(video.codec_name, "h264");
  assert.equal(video.pix_fmt, "yuv420p");
  assert.equal(video.width, width);
  assert.equal(video.height, 1080);
  assert.equal(video.r_frame_rate, "30/1");
  assert.equal(Number(video.nb_frames), 450);
  assert.ok(
    Math.abs(Number(info.format.duration) - 15) < 0.05,
    `${name}: 15 seconds`,
  );
  assert.ok(statSync(path).size < 8 * 1024 * 1024, `${name}: below 8 MiB`);
  const bytes = readFileSync(path);
  assert.ok(
    bytes.indexOf("moov") < bytes.indexOf("mdat"),
    `${name}: fast-start metadata`,
  );
  console.log(`${name}: silent H.264, ${width}×1080, 450 frames, fast start`);
}
const webp = readFileSync(assets + "wherdr-launch.webp");
assert.equal(webp.toString("ascii", 0, 4), "RIFF");
assert.equal(webp.toString("ascii", 8, 12), "WEBP");
let frames = 0,
  duration = 0,
  canvas = false,
  loop = false;
for (let offset = 12; offset + 8 <= webp.length;) {
  const tag = webp.toString("ascii", offset, offset + 4);
  const size = webp.readUInt32LE(offset + 4);
  const start = offset + 8;
  if (tag === "VP8X") {
    assert.equal(webp.readUIntLE(start + 4, 3) + 1, 720);
    assert.equal(webp.readUIntLE(start + 7, 3) + 1, 720);
    canvas = true;
  }
  if (tag === "ANIM") {
    assert.equal(webp.readUInt16LE(start + 4), 0);
    loop = true;
  }
  if (tag === "ANMF") {
    frames++;
    duration += webp.readUIntLE(start + 12, 3);
  }
  offset = start + size + (size % 2);
}
assert.ok(canvas && loop, "720 px animated WebP loops forever");
assert.equal(frames, 225, "WebP: 15 fps × 15 seconds");
assert.ok(Math.abs(duration - 15000) < 100, `WebP: duration ${duration} ms`);
assert.ok(webp.length < 5 * 1024 * 1024, "WebP: below 5 MiB");
console.log(
  `wherdr-launch.webp: 720×720, ${frames} frames, ${duration} ms, infinite loop`,
);
