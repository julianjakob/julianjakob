#!/usr/bin/env node
/**
 * build-projects.js
 *
 * Kombiniert alle project.json + manifest.json in eine einzige
 * projects-data.json — nur 1 HTTP-Request beim Laden statt 14+.
 *
 * Ausführen: node build-projects.js
 * (nach jedem Projekt-Update ausführen, dann committen)
 */

const fs   = require("fs");
const path = require("path");

const SLOTS = ["01","02","03","04","05","06","07","08"];
const output = [];

for (const slot of SLOTS) {
  const projectDir  = path.join("projects", slot);
  const projectJson = path.join(projectDir, "project.json");
  const manifestJson = path.join(projectDir, "manifest.json");

  if (!fs.existsSync(projectJson)) continue;

  let project;
  try { project = JSON.parse(fs.readFileSync(projectJson, "utf8")); }
  catch (e) { console.warn(`✗ ${slot}: project.json unreadable`); continue; }

  if (!project.enabled) { console.log(`– ${slot}: disabled`); continue; }

  let manifest = null;
  if (fs.existsSync(manifestJson)) {
    try { manifest = JSON.parse(fs.readFileSync(manifestJson, "utf8")); }
    catch (e) { console.warn(`✗ ${slot}: manifest.json unreadable`); }
  }

  output.push({
    slot,
    title:    (project.title  || `Project ${slot}`).trim(),
    title_de: project.title_de ? project.title_de.trim() : null,
    slug:     (project.slug   || `project-${slot}`).trim(),
    manifest,
  });

  console.log(`✓ ${slot}: ${project.title}`);
}

fs.writeFileSync("projects-data.json", JSON.stringify(output, null, 2));
console.log(`\nFertig: projects-data.json mit ${output.length} Projekten erstellt.`);