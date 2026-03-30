#!/usr/bin/env node
/**
 * generate-manifests.js
 * 
 * Scannt alle Projektordner und erstellt manifest.json Dateien.
 * Einmal ausführen: node generate-manifests.js
 * Danach bei neuen Projekten erneut ausführen.
 */

const fs   = require("fs");
const path = require("path");

const SLOTS      = ["01","02","03","04","05","06","07","08"];
const IMG_EXTS   = [".jpg",".jpeg",".png",".webp"];
const VID_EXTS   = [".mp4",".webm"];
const MEDIA_EXTS = [...IMG_EXTS, ...VID_EXTS];

function findMedia(dir, stem) {
  for (const ext of MEDIA_EXTS) {
    const f = path.join(dir, stem + ext);
    if (fs.existsSync(f)) return stem + ext;
  }
  return null;
}

function fileExists(dir, name) {
  return fs.existsSync(path.join(dir, name));
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
      items.push({ type: "single", src: f });
      continue;
    }
    break;
  }
  return items;
}

function scanCaseDir(caseDir) {
  if (!fs.existsSync(caseDir)) return null;

  const hero        = findMedia(caseDir, "hero");
  const hasIntro    = fileExists(caseDir, "intro.txt");
  const hasCategory = fileExists(caseDir, "category.txt");
  const hasOutro    = fileExists(caseDir, "outro.txt");
  const hasCredit   = fileExists(caseDir, "credit.txt");

  const blocks = [];
  for (let i = 1; i <= 199; i++) {
    const num = pad2(i);
    // Text block
    if (fileExists(caseDir, num + ".txt")) {
      blocks.push({ type: "text", num });
      continue;
    }
    // Row
    const rowItems = [];
    for (const letter of ["a","b","c"]) {
      const f = findMedia(caseDir, num + letter);
      if (!f) break;
      rowItems.push(f);
    }
    if (rowItems.length > 0) {
      blocks.push({ type: "row", items: rowItems });
      continue;
    }
    // Single
    const f = findMedia(caseDir, num);
    if (f) {
      blocks.push({ type: "single", src: f });
      continue;
    }
    break;
  }

  return { hero, hasIntro, hasCategory, hasOutro, hasCredit, blocks };
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
  const caseDir = path.join(projectDir, "case");

  const manifest = {
    home: scanHomeDir(homeDir),
    case: scanCaseDir(caseDir),
  };

  const outPath = path.join(projectDir, "manifest.json");
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  console.log(`  ✓ ${slot}: ${manifest.home.length} home slides, ${manifest.case ? manifest.case.blocks.length : 0} case blocks`);
  generated++;
}

console.log(`\nFertig: ${generated} Manifests erstellt, ${skipped} übersprungen.`);
console.log("Committe die manifest.json Dateien zusammen mit deinen anderen Änderungen.");