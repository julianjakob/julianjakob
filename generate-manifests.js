#!/usr/bin/env node
/**
 * generate-manifests.js
 *
 * Scans every project folder (projects/NN/home) and writes its manifest.json:
 * the slides in order — 01, 02… single; 02a, 02b… a row — with pixel sizes and
 * resized copies. Run after adding or changing project media:
 *   node generate-manifests.js && node build-projects.js
 */

const fs   = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const SLOTS      = ["01","02","03","04","05","06","07","08"];
const IMG_EXTS   = [".jpg",".jpeg",".png",".webp"];
const VID_EXTS   = [".mp4",".webm"];
const MEDIA_EXTS = [...IMG_EXTS, ...VID_EXTS];

// Smaller copies of every image (home/sizes/<name>-<width>.webp). The site picks
// the one closest to the size it's displayed at — sharper while slides animate
// (browsers shrink huge images coarsely mid-animation) and much lighter to load.
// Needs cwebp (brew install webp); without it the originals are used as before.
const SIZE_WIDTHS = [640, 960, 1280, 1920, 2560];
const WEBP_QUALITY = "82";
let hasCwebp = true;
try { execFileSync("cwebp", ["-version"], { stdio: "ignore" }); }
catch { hasCwebp = false; console.warn("  ! cwebp not found — skipping resized images (brew install webp)"); }

function buildSizes(dir, file, width) {
  if (!hasCwebp || !width) return [];
  const sizesDir = path.join(dir, "sizes");
  const stem = path.basename(file, path.extname(file));
  const srcPath = path.join(dir, file);
  const srcTime = fs.statSync(srcPath).mtimeMs;
  const out = [];
  for (const w of SIZE_WIDTHS) {
    if (w >= width) break;
    const name = `${stem}-${w}.webp`;
    const target = path.join(sizesDir, name);
    if (!fs.existsSync(target) || fs.statSync(target).mtimeMs < srcTime) {
      fs.mkdirSync(sizesDir, { recursive: true });
      execFileSync("cwebp", ["-quiet", "-q", WEBP_QUALITY, "-resize", String(w), "0", "-metadata", "none", srcPath, "-o", target]);
    }
    out.push({ w, src: `sizes/${name}` });
  }
  return out;
}

// Phone cut of every video (home/sizes/<name>-portrait.mp4): the centre portrait slice
// at phone resolution — see make-portrait-video.swift. Needs macOS (swift + AVFoundation);
// elsewhere an existing cut is kept and none is made.
let hasSwift = process.platform === "darwin";
function buildPortrait(dir, file) {
  const stem = path.basename(file, path.extname(file));
  const name = `${stem}-portrait.mp4`, target = path.join(dir, "sizes", name), srcPath = path.join(dir, file);
  const fresh = fs.existsSync(target) && fs.statSync(target).size > 0 && fs.statSync(target).mtimeMs >= fs.statSync(srcPath).mtimeMs;
  if (!fresh && hasSwift) {
    try {
      fs.mkdirSync(path.join(dir, "sizes"), { recursive: true });
      execFileSync("swift", [path.join(__dirname, "make-portrait-video.swift"), srcPath, target], { stdio: "ignore" });
    } catch { hasSwift = false; console.warn("  ! portrait video cut failed — run make-portrait-video.swift by hand"); }
  }
  return fs.existsSync(target) && fs.statSync(target).size > 0 ? `sizes/${name}` : null;
}

// Phone crops of wide images (home/sizes/<name>-portrait-<width>.webp): the centre 4:5
// slice that a portrait slide shows (object-fit: cover) at full sharpness — far lighter
// to load and decode than the whole wide picture at phone pixel density.
const PORTRAIT_ASPECT = 0.8, PORTRAIT_WIDTHS = [640, 960, 1280, 1728];
function buildPortraitImage(dir, file, width, height) {
  if (!hasCwebp || !width || !height || width / height <= 1) return null;
  const cw = 2 * Math.round(PORTRAIT_ASPECT * height / 2), x = Math.round((width - cw) / 2);
  const stem = path.basename(file, path.extname(file));
  const srcPath = path.join(dir, file), srcTime = fs.statSync(srcPath).mtimeMs;
  const sizes = [];
  for (const w of [...PORTRAIT_WIDTHS.filter((w) => w < cw), cw]) {
    const name = `${stem}-portrait-${w}.webp`, target = path.join(dir, "sizes", name);
    if (!fs.existsSync(target) || fs.statSync(target).mtimeMs < srcTime) {
      fs.mkdirSync(path.join(dir, "sizes"), { recursive: true });
      execFileSync("cwebp", ["-quiet", "-q", WEBP_QUALITY, "-crop", String(x), "0", String(cw), String(height), "-resize", String(w), "0", "-metadata", "none", srcPath, "-o", target]);
    }
    sizes.push({ w, src: `sizes/${name}` });
  }
  return { w: cw, h: height, sizes };
}

// Poster: a video's first frame (make-video-poster.swift → PNG → cwebp). macOS only;
// elsewhere an existing poster is kept and none is made.
function buildPoster(dir, file, name, maxW) {
  const target = path.join(dir, "sizes", name), srcPath = path.join(dir, file);
  const fresh = fs.existsSync(target) && fs.statSync(target).size > 0 && fs.statSync(target).mtimeMs >= fs.statSync(srcPath).mtimeMs;
  if (!fresh && hasSwift && hasCwebp) {
    const png = path.join(require("os").tmpdir(), `poster-${process.pid}.png`);
    try {
      fs.mkdirSync(path.join(dir, "sizes"), { recursive: true });
      execFileSync("swift", [path.join(__dirname, "make-video-poster.swift"), srcPath, png, String(maxW)], { stdio: "ignore" });
      execFileSync("cwebp", ["-quiet", "-q", "72", "-metadata", "none", png, "-o", target]);
    } catch { console.warn(`  ! poster for ${file} failed — run make-video-poster.swift by hand`); }
    finally { fs.rmSync(png, { force: true }); }
  }
  return fs.existsSync(target) && fs.statSync(target).size > 0 ? `sizes/${name}` : null;
}

function findMedia(dir, stem) {
  for (const ext of MEDIA_EXTS) {
    const f = path.join(dir, stem + ext);
    if (fs.existsSync(f)) return describeMedia(dir, stem + ext);
  }
  return null;
}

// Build a media entry: file name, pixel size (images) and a WebM alternative (videos).
// Dimensions let the site lay out slides instantly without waiting for downloads.
function describeMedia(dir, file) {
  const entry = { src: file };
  const ext = path.extname(file).toLowerCase();
  if (IMG_EXTS.includes(ext)) {
    const dims = imageSize(path.join(dir, file));
    if (dims) {
      entry.w = dims.w; entry.h = dims.h;
      const sizes = buildSizes(dir, file, dims.w);
      if (sizes.length) entry.sizes = sizes;
      const portrait = buildPortraitImage(dir, file, dims.w, dims.h);
      if (portrait) entry.portrait = portrait;
    }
  } else if (ext === ".mp4") {
    const webm = file.replace(/\.mp4$/i, ".webm");
    if (fs.existsSync(path.join(dir, webm))) entry.webm = webm;
    const portrait = buildPortrait(dir, file);
    if (portrait) entry.portrait = portrait;
    // First frames as stills, shown while the videos load (never a white slide)
    const poster = buildPoster(dir, file, `${path.basename(file, ext)}-poster.webp`, 1920);
    if (poster) entry.poster = poster;
    const portraitPoster = portrait && buildPoster(dir, portrait, `${path.basename(file, ext)}-portrait-poster.webp`, 1296);
    if (portraitPoster) entry.portraitPoster = portraitPoster;
  }
  return entry;
}

// Reads width/height from WebP, PNG and JPEG headers (no dependencies).
function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const chunk = b.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = b.readUInt32LE(21);
      return { w: 1 + (bits & 0x3fff), h: 1 + ((bits >> 14) & 0x3fff) };
    }
  }
  if (b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

function pad2(n) { return String(n).padStart(2, "0"); }

function scanHomeDir(homeDir) {
  if (!fs.existsSync(homeDir)) return [];
  const items = [];
  for (let i = 1; i <= 99; i++) {
    const num = pad2(i);
    // Row: check for a, b, c
    const rowItems = [];
    for (const letter of ["a","b","c"]) {
      const f = findMedia(homeDir, num + letter);
      if (!f) break;
      rowItems.push(f);
    }
    if (rowItems.length > 0) {
      items.push({ type: "row", items: rowItems });
      continue;
    }
    // Single
    const f = findMedia(homeDir, num);
    if (f) {
      items.push({ type: "single", item: f });
      continue;
    }
    break;
  }
  return items;
}

let generated = 0;
let skipped   = 0;

for (const slot of SLOTS) {
  const projectDir = path.join("projects", slot);
  if (!fs.existsSync(projectDir)) { skipped++; continue; }

  const projectJson = path.join(projectDir, "project.json");
  if (!fs.existsSync(projectJson)) { skipped++; continue; }

  let project;
  try { project = JSON.parse(fs.readFileSync(projectJson, "utf8")); }
  catch (e) { console.warn(`  ✗ ${slot}: project.json unreadable`); skipped++; continue; }

  if (!project.enabled) { console.log(`  – ${slot}: disabled, skipping`); skipped++; continue; }

  const homeDir = path.join(projectDir, "home");

  const manifest = {
    home: scanHomeDir(homeDir),
  };

  const outPath = path.join(projectDir, "manifest.json");
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  console.log(`  ✓ ${slot}: ${manifest.home.length} home slides`);
  generated++;
}

console.log(`\nDone: ${generated} manifests written, ${skipped} skipped.`);
console.log("Commit the manifest.json files together with your other changes.");