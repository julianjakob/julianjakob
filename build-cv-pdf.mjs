/**
 * build-cv-pdf.mjs
 *
 * Renders the CV page (/cv) to one A4 PDF per language with Chrome's print engine:
 * assets/cv/Julian-Jakob-CV-EN.pdf and -DE.pdf — what the "PDF" button opens.
 * Run after changing the CV in index.html (and after node build-pages.js), with the site
 * served locally on port 8768 and Playwright installed (npx playwright install chromium):
 *   node build-cv-pdf.mjs assets/cv
 */
import { chromium } from "playwright";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = process.argv[2];
const b = await chromium.launch();
for (const lang of ["en", "de"]) {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  await p.goto("http://localhost:8768/cv"); await p.evaluate((l) => localStorage.setItem("jj_lang", l), lang); await p.reload();
  await p.waitForFunction(() => document.querySelector("#page-cv.visible") && getComputedStyle(document.getElementById("intro-banner")).display === "none", null, { timeout: 30000 });
  await sleep(1500);
  await p.evaluate(async () => { const img = document.querySelector("#page-cv .cv-photo"); img.loading = "eager"; await img.decode().catch(() => {}); await document.fonts.ready; });
  await sleep(500);
  await p.emulateMedia({ media: "print" });
  const file = `${out}/Julian-Jakob-CV-${lang.toUpperCase()}.pdf`;
  await p.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
  console.log("wrote", file);
}
await b.close();
