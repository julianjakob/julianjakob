// Browser checks for julianjakob.at — run from this folder:  npm test   (or  npm run quick)
// Each check prints ✓ / ✗ lines; the run ends with a summary and exits 1 if anything failed.
// Run `node build-pages.js` in the site folder first: /about etc. are the built pages.
import { webkit, chromium, devices } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, "..");
const QUICK = process.argv.includes("--quick");
const ONLY = process.argv.filter((a) => !a.startsWith("--")).slice(2); // e.g. npm test -- names fades
const PORT = 8790, SLOW = 8791, VERY_SLOW = 8792; // normal, 1 Mbit/s, 0.3 Mbit/s
const PHONE = devices["iPhone 15"], SMALL = { ...devices["iPhone SE"] }, DESK = { viewport: { width: 1440, height: 900 } };
const PAGES = ["about", "process", "expertise", "contact", "cv", "legal"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Servers ─────────────────────────────────────────────────────
const servers = [[PORT, 0], [SLOW, 1], [VERY_SLOW, 0.3]].map(([port, mbit]) =>
  spawn(process.execPath, [path.join(here, "server.cjs"), SITE, String(port), String(mbit)], { stdio: "ignore", env: { ...process.env, QUIET: "1" } }));
process.on("exit", () => servers.forEach((s) => s.kill()));
await sleep(600);
const url = (p = "", port = PORT) => `http://localhost:${port}/${p}`;

// ── Reporting ───────────────────────────────────────────────────
let failed = 0, passed = 0;
const ok = (cond, name, info = "") => { cond ? passed++ : failed++; console.log(`  ${cond ? "✓" : "✗"} ${name}${info && !cond ? "  " + info : ""}`); return cond; };

// One browser per engine, a fresh context per scenario
const engines = { webkit: await webkit.launch(), chromium: await chromium.launch() };
async function page(opts = PHONE, { engine = "webkit", lang } = {}) {
  const ctx = await engines[engine].newContext(opts);
  if (lang) await ctx.addInitScript((l) => localStorage.setItem("jj_lang", l), lang);
  const p = await ctx.newPage();
  p.errors = []; p.on("pageerror", (e) => p.errors.push(e.message));
  p.done = () => ctx.close();
  return p;
}
const introGone = (p, timeout = 60000) => p.waitForFunction(() => { const b = document.getElementById("intro-banner"); return !b || b.classList.contains("hidden"); }, null, { timeout });

// Screen pixels: rows of a solid colour at the right screen edge (where no text is)
async function colourRows(p, rgbTest) {
  const b64 = (await p.screenshot()).toString("base64"), vh = await p.evaluate(() => innerHeight);
  return p.evaluate(async ({ b64, vh, test }) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d"); x.drawImage(img, 0, 0);
    const d = x.getImageData(img.width - 4, 0, 1, img.height).data, k = img.height / vh, fn = new Function("r", "g", "b", "return " + test), rows = [];
    for (let y = 0; y < img.height; y++) if (fn(d[y * 4], d[y * 4 + 1], d[y * 4 + 2])) rows.push(y / k);
    return rows.length ? [Math.round(Math.min(...rows)), Math.round(Math.max(...rows) + 1 / k)] : null;
  }, { b64, vh, test: rgbTest });
}
async function brightness(p, clip) {
  const b64 = (await p.screenshot({ clip })).toString("base64");
  return p.evaluate(async (b64) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d"); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, img.width, img.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return Math.round(s / (d.length / 4));
  }, b64);
}

// ── Checks ──────────────────────────────────────────────────────
const checks = {
  // Every page opens straight from its URL (and an unknown one falls back home), nothing
  // half-animated, invisible or sideways-scrolling, no script errors
  async pages() {
    for (const [label, opts] of [["phone", PHONE], ["desktop", DESK]]) {
      const p = await page(opts);
      for (const r of ["", ...PAGES, "no-such-page"]) {
        await p.goto(url(r)); await introGone(p); await sleep(2500);
        const s = await p.evaluate(() => {
          const page = document.querySelector(".page-container.visible");
          const shown = (el) => !el.closest(".service-row:not(.expanded) .service-body, .reveal-panel:not(.open)");
          const faint = page ? [...page.querySelectorAll("p, h1, h2, a, span")].filter((e) => shown(e) && e.getBoundingClientRect().height && e.getBoundingClientRect().top < innerHeight && e.getBoundingClientRect().bottom > 80)
            .filter((e) => { let o = 1, n = e; while (n && n !== document.body) { o *= +getComputedStyle(n).opacity; n = n.parentElement; } return o < 0.25; }).length : -1;
          return { id: page && page.id, faint, leftovers: page ? page.querySelectorAll(".typewriter-char, .text-out, .lock-line").length : -1, sideways: page ? page.scrollWidth > page.clientWidth + 1 : true, path: location.pathname };
        });
        const want = "page-" + (r && r !== "no-such-page" ? r : "home");
        ok(s.id === want && !s.faint && !s.leftovers && !s.sideways, `${label} /${r}`, JSON.stringify(s));
      }
      ok(!p.errors.length, `${label}: no script errors`, p.errors.join(" | "));
      await p.done();
    }
  },

  // The intro on a slow connection cycles several lines: never any markup on screen
  async intro() {
    for (const [r, lang] of [["", "en"], ["cv", "de"], ["", "de"]]) {
      const p = await page(PHONE, { lang });
      await p.goto(url(r, SLOW), { waitUntil: "commit" });
      const s = await p.evaluate(() => new Promise((done) => {
        const seen = new Set(); let bad = ""; const t0 = performance.now();
        const f = () => {
          const el = document.querySelector("#intro-banner .banner-text"), bn = document.getElementById("intro-banner");
          if (el) { const t = el.textContent.replace(/\s+/g, " ").trim(); if (/[<>]|class=|span|&[a-z]+;/.test(t)) bad = t.slice(0, 60); if (t) seen.add(t); }
          if ((bn && bn.classList.contains("hidden")) || performance.now() - t0 > 50000) done({ bad, lines: seen.size }); else setTimeout(f, 40);
        };
        document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", f) : f();
      }));
      ok(!s.bad, `intro at 1 Mbit/s, /${r} (${lang}): ${s.lines} lines shown, no markup`, s.bad);
      await p.done();
    }
  },

  // Every intro line fits in two rows on common phones (320 px is reported, not failed)
  async introLines() {
    const p = await page(PHONE);
    await p.goto(url());
    const res = await p.evaluate(async () => {
      const src = [...document.scripts].map((s) => s.textContent).find((t) => t.includes("INTRO_LINES"));
      const pairs = [...src.matchAll(/L\("((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"\)/g)].map((m) => [JSON.parse(`"${m[1]}"`), JSON.parse(`"${m[2]}"`)]);
      const names = [["About", "»Über mich«", "zu »Über mich«"], ["Expertise", "»Expertise«", "zu »Expertise«"], ["the CV", "der Lebenslauf", "zum Lebenslauf"], ["Legal", "»Impressum«", "zum »Impressum«"]];
      const lines = [];
      pairs.forEach(([en, de]) => en.includes("{P}") ? names.forEach(([pe, pd, z]) => lines.push(en.replace("{P}", pe), de.replace("{P}", pd).replace("{Z}", z))) : lines.push(en, de));
      return lines;
    });
    for (const [label, width] of [["iPhone 15", 393], ["iPhone mini / SE", 375], ["Android", 360], ["old SE", 320]]) {
      await p.setViewportSize({ width, height: 700 }); await sleep(300);
      const long = await p.evaluate((lines) => {
        const el = document.querySelector("#intro-banner .banner-text"); const bad = [];
        for (const t of lines) {
          el.innerHTML = t; const r = document.createRange(); r.selectNodeContents(el);
          if (new Set([...r.getClientRects()].filter((q) => q.width > 1).map((q) => Math.round(q.top))).size > 2) bad.push(t.replace("<br>", " / "));
        }
        return bad;
      }, res);
      if (width === 320) console.log(`  · ${label} (${width}px): ${long.length} lines need three rows${long.length ? " — " + long.slice(0, 3).join("; ") : ""}`);
      else ok(!long.length, `intro lines fit two rows at ${width}px (${label})`, long.join("; "));
    }
    await p.done();
  },

  // With Details open, the project name always stays one line and clear of the Details text
  async names() {
    for (const [label, opts, lang] of [["phone", PHONE], ["small phone", SMALL], ["desktop", DESK], ["phone, German", PHONE, "de"]]) {
      const p = await page(opts, { lang });
      await p.goto(url()); await introGone(p); await sleep(1500);
      await p.click("#details-btn"); await sleep(1500);
      const n = await p.evaluate(() => document.querySelectorAll(".slide-section").length), bad = [];
      for (let k = 0; k < (QUICK ? Math.min(n, 4) : n); k++) {
        const r = await p.evaluate(() => {
          const t = document.getElementById("footer-title"), range = document.createRange(); range.selectNodeContents(t);
          const rows = new Set([...range.getClientRects()].filter((q) => q.width > 1).map((q) => Math.round(q.top))).size, tr = t.getBoundingClientRect();
          const overlap = [...document.querySelectorAll(".project-details p, .project-details button")].some((e) => { const q = e.getBoundingClientRect(); return q.right > tr.left - 2 && q.bottom > tr.top && q.top < tr.bottom; });
          return { title: t.textContent, rows, overlap, off: tr.left < 0 || tr.right > innerWidth + 0.5 };
        });
        if (r.rows > 1 || r.overlap || r.off) bad.push(JSON.stringify(r));
        await p.keyboard.press("ArrowDown"); await sleep(2600);
      }
      ok(!bad.length, `${label}: project names stay one line with Details open`, bad.join(" "));
      await p.done();
    }
  },

  // Process steps and awards: one open at a time, signs right, rapid clicks settle cleanly
  async accordions() {
    const p = await page(PHONE);
    for (const [r, sel, open, signSel] of [["process", ".service-row", ".service-row.expanded", ".service-toggle"], ["about", ".reveal-toggle", ".reveal-panel.open", ".details-hint"]]) {
      await p.goto(url(r)); await introGone(p); await sleep(2500);
      const items = await p.$$(sel);
      await items[0].scrollIntoViewIfNeeded(); await items[0].click(); await sleep(1500);
      await items[2].click(); await sleep(1700);
      ok(await p.evaluate(([open, sel, signSel]) => document.querySelectorAll(open).length === 1 && document.querySelectorAll(sel)[2].querySelector(signSel).textContent === "–", [open, sel, signSel]), `${r}: one open at a time, its sign "–"`);
      for (let k = 0; k < 10; k++) { await items[k % items.length].click(); await sleep(60); }
      await sleep(2600);
      const s = await p.evaluate((open) => ({ open: document.querySelectorAll(open).length, spans: document.querySelectorAll(".page-container.visible .typewriter-char, .page-container.visible .text-out, .page-container.visible .lock-line").length }), open);
      ok(s.open <= 1 && !s.spans, `${r}: rapid clicks settle cleanly`, JSON.stringify(s));
    }
    await p.goto(url("contact")); await introGone(p); await sleep(2500);
    await p.click(".copy-row"); await sleep(900);
    ok(await p.evaluate(() => document.querySelector(".copy-row .type-contact-item").textContent.includes("Copied")), "contact: copy says Copied");
    ok(!p.errors.length, "no script errors", p.errors.join(" | "));
    await p.done();
  },

  // The white scroll fades sit at the screen's top 70 px and bottom 60 px — at rest, scrolled,
  // and while the page folds away (the fixed copies take over then)
  async fades() {
    for (const [label, opts, engine] of [["phone", PHONE, "webkit"], ["desktop", DESK, "chromium"]]) {
      const p = await page(opts, { engine }), bad = [];
      for (const r of QUICK ? ["about", "cv"] : PAGES) {
        await p.goto(url(r)); await introGone(p); await sleep(2000);
        await p.addStyleTag({ content: ":is(.contact-container,.cv-container)::before,.screen-fade-top{background:rgb(255,0,0)!important}:is(.contact-container,.cv-container)::after,.screen-fade-bottom{background:rgb(0,0,255)!important}" });
        const vh = await p.evaluate(() => innerHeight);
        for (const [state, scroll] of [["rest", 0], ["rest", 400], ["rest", 1e5], ["folding", 400]]) {
          await p.evaluate(({ state, scroll }) => { const pg = document.querySelector(".page-container.visible"); pg.style.transition = "none"; pg.style.transform = state === "folding" ? "scaleY(0.98)" : ""; pg.scrollTop = scroll; }, { state, scroll });
          if (state === "folding") await p.evaluate(() => document.documentElement.classList.add("fades-held"));
          await sleep(250);
          const top = await colourRows(p, "r>200&&g<60&&b<60"), bottom = await colourRows(p, "b>200&&r<60&&g<60");
          if (state === "folding") await p.evaluate(() => document.documentElement.classList.remove("fades-held"));
          const good = top && top[0] === 0 && Math.abs(top[1] - 70) <= 1 && bottom && Math.abs(bottom[0] - (vh - 60)) <= 1 && Math.abs(bottom[1] - vh) <= 1;
          if (!good) bad.push(`${r} ${state}@${scroll}: top ${top} bottom ${bottom}`);
        }
        await p.evaluate(() => { const pg = document.querySelector(".page-container.visible"); pg.style.transform = ""; });
      }
      ok(!bad.length, `${label}: fades at the screen edges`, bad.join("; "));
      await p.done();
    }
  },

  // Which cut each device loads, the first frame painted behind every video, and a video
  // slide reached before its video has loaded shows that frame — never a white slide
  async media() {
    for (const [label, opts, engine, wantVideo, wantImage] of [
      ["iPhone", PHONE, "webkit", /-portrait\.mp4$/, /-portrait-\d+\.webp$/],
      ["Android", devices["Pixel 7"], "chromium", /-portrait\.mp4$/, /-portrait-\d+\.webp$/],
      ["Mac Safari", DESK, "webkit", /-1080\.mp4$/, /-\d+\.webp$|\/01\.webp$/],
      ["Chrome desktop", DESK, "chromium", /-1080\.mp4$|\.webm$/, /-\d+\.webp$|\/01\.webp$/],
    ]) {
      const p = await page(opts, { engine });
      await p.goto(url()); await introGone(p); await sleep(1500);
      const s = await p.evaluate(() => ({
        videos: [...document.querySelectorAll(".slide-section video:not([data-loop-standby])")].map((v) => ({ src: v.getAttribute("src"), poster: /url\(/.test(v.style.background) })),
        images: [...document.querySelectorAll(".slide-section.is-full-bleed img")].map((i) => i.currentSrc || i.getAttribute("src") || ""),
      }));
      ok(s.videos.length && s.videos.every((v) => wantVideo.test(v.src) && v.poster), `${label}: video cuts + first frames`, JSON.stringify(s.videos));
      ok(s.images.every((src) => !src || wantImage.test(src)), `${label}: image cuts`, s.images.join(", "));
      await p.done();
    }
    const p = await page(PHONE);
    await p.goto(url("", VERY_SLOW)); await introGone(p, 120000);
    let lum = null;
    for (let k = 0; k < 10 && lum === null; k++) {
      if (await p.evaluate(() => !!document.querySelector(".slide-section.active video"))) { await sleep(400); lum = await brightness(p, { x: 80, y: 200, width: 230, height: 250 }); }
      else { await p.keyboard.press("ArrowDown"); await sleep(1000); }
    }
    ok(lum !== null && lum < 230, "video slide at 0.3 Mbit/s shows its first frame, not white", `brightness ${lum}`);
    await p.done();
  },

  // The CV prints on exactly one A4 page in both languages
  async print() {
    const p = await page({ viewport: { width: 794, height: 1123 } }, { engine: "chromium" });
    for (const lang of ["en", "de"]) {
      await p.goto(url("cv")); await p.evaluate((l) => localStorage.setItem("jj_lang", l), lang); await p.reload(); await introGone(p); await sleep(2500);
      await p.emulateMedia({ media: "print" });
      const pdf = await p.pdf({ preferCSSPageSize: true, printBackground: true });
      const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
      ok(pages === 1, `CV prints on one page (${lang})`, `${pages} pages`);
      await p.emulateMedia({ media: "screen" });
    }
    await p.done();
  },

  // Random sequences of every interaction, then: nothing stuck, invisible, out of sync
  async chaos() {
    const rounds = QUICK ? 2 : 4, steps = 24;
    for (const [which, seed0] of QUICK ? [["phone", 5], ["desk", 9]] : [["phone", 5], ["phone", 13], ["phone", 77], ["desk", 9], ["desk", 31]]) {
      let seed = seed0; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647), pick = (a) => a[Math.floor(rnd() * a.length)];
      const p = await page(which === "phone" ? PHONE : DESK);
      const home = async () => { await p.goto(url()); await introGone(p); await sleep(1500); };
      await home();
      const swipe = (dir) => p.evaluate(async (dir) => {
        const home = document.getElementById("page-home"), ev = (type, y) => home.dispatchEvent(new PointerEvent(type, { pointerId: 5, pointerType: "touch", isPrimary: true, clientX: 200, clientY: y, buttons: type === "pointerup" ? 0 : 1, bubbles: true }));
        const y0 = dir > 0 ? 560 : 140, y1 = dir > 0 ? 140 : 560; ev("pointerdown", y0);
        for (let k = 1; k <= 12; k++) { await new Promise((r) => requestAnimationFrame(r)); ev("pointermove", y0 + (y1 - y0) * k / 12); }
        ev("pointerup", y1);
      }, dir);
      const actions = {
        swipeUp: () => swipe(1), swipeDown: () => swipe(-1), wheel: () => p.mouse.wheel(0, rnd() < 0.5 ? 120 : -120),
        key: () => p.keyboard.press(rnd() < 0.5 ? "ArrowDown" : "ArrowUp"),
        menu: () => p.click("#menu-btn", { timeout: 2000 }).catch(() => {}),
        nav: () => p.evaluate((d) => { const l = document.querySelector(`#menu-overlay .nav-link[data-dest="${d}"]`); if (l && document.getElementById("menu-overlay").classList.contains("open")) l.click(); }, pick(PAGES)),
        logo: () => p.evaluate(() => document.querySelector("#main-header .brand").click()),
        lang: () => p.click("#lang-toggle", { timeout: 2000 }).catch(() => {}),
        details: () => p.evaluate(() => { const b = document.getElementById("details-btn"); if (b.getBoundingClientRect().height) b.click(); }),
        award: () => p.evaluate(() => { const t = [...document.querySelectorAll(".page-container.visible .reveal-toggle")]; if (t.length) t[Math.floor(Math.random() * t.length)].click(); }),
        step: () => p.evaluate(() => { const r = [...document.querySelectorAll(".page-container.visible .service-row")]; if (r.length) r[Math.floor(Math.random() * r.length)].click(); }),
        back: async () => { if (await p.evaluate(() => history.length) > 2) await p.goBack({ timeout: 3000 }).catch(() => {}); if (!p.url().startsWith(url())) await home(); },
        forward: async () => { await p.goForward({ timeout: 3000 }).catch(() => {}); if (!p.url().startsWith(url())) await home(); },
        rotate: async () => { const v = p.viewportSize(); await p.setViewportSize({ width: v.height, height: v.width }); },
        scroll: () => p.evaluate(() => { const pg = document.querySelector(".page-container.visible"); if (pg) pg.scrollTop += 300; }),
      };
      const names = Object.keys(actions).filter((n) => which === "phone" ? n !== "wheel" : !n.startsWith("swipe"));
      for (let r = 0; r < rounds; r++) {
        const seq = [];
        for (let k = 0; k < steps; k++) { const a = pick(names); seq.push(a); await actions[a](); await sleep(Math.floor(rnd() * 600)); }
        if ((p.viewportSize().width > p.viewportSize().height) === (which === "phone")) await actions.rotate();
        await sleep(4000);
        const issues = await p.evaluate(() => {
          const issues = [], menuOpen = document.getElementById("menu-overlay").classList.contains("open");
          const vis = [...document.querySelectorAll(".page-container.visible")], page = vis[0];
          if (vis.length !== (menuOpen ? 0 : 1)) issues.push(`visible pages: ${vis.length}`);
          if (page) {
            const path = location.pathname.replace(/^\//, "") || "home"; if (page.id !== "page-" + path) issues.push(`url /${path} shows ${page.id}`);
            if (page.classList.contains("parked")) issues.push("visible page parked");
          }
          const shown = (el) => !el.closest(".service-row:not(.expanded) .service-body, .reveal-panel:not(.open), .parked, .details-panel:not(.open), #menu-overlay.off, #intro-banner, [hidden]");
          const left = [...document.querySelectorAll(".typewriter-char, .text-out, .lock-line, .icon-in, .icon-out")].filter(shown);
          if (left.length) issues.push(`animation leftovers: ${left.length}`);
          if (page && page.id === "page-home") {
            const s = document.querySelector(".slide-section.active"), t = document.getElementById("footer-title");
            if (document.querySelectorAll(".slide-section.active").length !== 1) issues.push("active slides ≠ 1");
            if (s && t.textContent !== s.getAttribute("data-title")) issues.push(`title "${t.textContent}" ≠ "${s.getAttribute("data-title")}"`);
            const vids = s ? [...s.querySelectorAll("video")] : [];
            if (vids.length && !vids.some((v) => !v.paused)) issues.push("video not playing");
          }
          return issues;
        });
        ok(!issues.length, `${which} seed ${seed0} round ${r + 1}`, issues.join("; ") + "  sequence: " + seq.join(" "));
        if (issues.length) await home();
      }
      ok(!p.errors.length, `${which} seed ${seed0}: no script errors`, [...new Set(p.errors)].join(" | "));
      await p.done();
    }
  },
};

// ── Run ─────────────────────────────────────────────────────────
const t0 = Date.now();
for (const [name, check] of Object.entries(checks)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  console.log(`\n${name}`);
  try { await check(); } catch (e) { ok(false, `${name} crashed`, e.message.split("\n")[0]); }
}
await Promise.all(Object.values(engines).map((b) => b.close()));
console.log(`\n${failed ? "✗" : "✓"} ${passed} passed, ${failed} failed — ${Math.round((Date.now() - t0) / 1000)} s`);
process.exit(failed ? 1 : 0);
