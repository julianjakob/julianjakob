document.addEventListener("DOMContentLoaded", () => {
  init().catch((e) => console.error("Init error:", e));
});

async function init() {
  const pageHome = document.getElementById("page-home");
  if (!pageHome) return;

  const pageContact = document.getElementById("page-contact");
  const pageAbout = document.getElementById("page-about");
  const pageProcess = document.getElementById("page-process");
  const pagePricing = document.getElementById("page-pricing");
  const pageLegal = document.getElementById("page-legal");
  const pageCv    = document.getElementById("page-cv");

  const banner = document.getElementById("intro-banner");
  const footerTitle = document.getElementById("footer-title");
  const menuBtn = document.getElementById("menu-btn");
  const menuOverlay = document.getElementById("menu-overlay");

  const pages = {
    home: pageHome,
    contact: pageContact,
    about: pageAbout,
    process: pageProcess,
    pricing: pagePricing,
    legal: pageLegal,
    cv:    pageCv,
  };
  let currentPage = "home",
    currentIndex = 0,
    isAnimating = false, // managed by tLock — do not set directly
    hasSeenBanner = false,
    isMenuOpen = false,
    menuTimeout = 0,
    pendingAfterBanner = null;

  // Each slide on its own GPU layer: the fold then only stretches an already-drawn
  // layer instead of repainting the whole feed every frame (which made Chrome show
  // blurry low-res placeholders mid-swipe). Not in Safari — see .feed-layers in CSS.
  if (!IS_SAFARI) pageHome.classList.add("feed-layers");

  // Intro: started inline in index.html right after the banner (see createIntro there)
  const intro = window.jjIntro || { finish: (until) => Promise.resolve(until).then(() => new Promise((r) => setTimeout(r, 2000))), done() {} };

  const projects = await loadEnabledProjects();
  const homeSlides = await renderHomeSlides(pageHome, projects);

  
  fitImageSources(homeSlides);
  window.addEventListener("resize", () => fitImageSources(homeSlides));
  if (homeSlides.length > 0) updateFooter(homeSlides[0]);
  syncSlideMedia(0);

  // Load + play videos only on the visible slide and buffer its neighbours.
  // Everything else stays unloaded — otherwise every video downloads on first visit.
  function syncSlideMedia(index, { playOnly = false } = {}) {
    const n = homeSlides.length;
    const homeVisible = currentPage === "home";
    homeSlides.forEach((slide, i) => {
      if (!playOnly) slide._videosPlaying = i === index && homeVisible;
      const isCurrent = i === index && homeVisible;
      const isNear    = i === index || i === (index + 1) % n || i === (index - 1 + n) % n;
      // Decode neighbour images ahead of time — no decoding work mid-swipe
      if (isNear) slide.querySelectorAll("img").forEach((img) => {
        if (img.dataset.decoded || !img.src) return;
        img.dataset.decoded = "1";
        img.decode().catch(() => { delete img.dataset.decoded; });
      });
      slide.querySelectorAll("video:not([data-loop-standby])").forEach((v) => {
        if (isNear && v.preload !== "auto") {
          v.preload = "auto";
          if (v.readyState === 0 && v.networkState !== HTMLMediaElement.NETWORK_LOADING) v.load();
        }
        if (isCurrent) v.play().catch(() => {});
        else if (!playOnly) rewindVideo(v);
      });
    });
  }

  if (banner && homeSlides.length > 0) {
    homeSlides[0].classList.remove("active");
    intro.finish(mediaReady(homeSlides[0])).then(() => {
      banner.classList.add("hidden");
      intro.done();
      hasSeenBanner = true; // the feed takes input as soon as the intro starts folding away

      if (pendingAfterBanner) {
        pendingAfterBanner();
        pendingAfterBanner = null;
      } else {
        homeSlides[0].style.transformOrigin = "bottom center";
        homeSlides[0].classList.add("active");
      }

      setTimeout(() => {
        banner.style.display = "none";
        syncUiMode();
        if (currentPage === "home" && shouldShowPeek()) { // not when the visit starts on another page
          let peekTimer = null;
          const removePeekListeners = () => {
            window.removeEventListener("wheel",      cancelEarly);
            window.removeEventListener("pointerdown", cancelEarly);
            window.removeEventListener("keydown",    cancelEarly);
          };
          const cancelEarly = () => { clearTimeout(peekTimer); removePeekListeners(); };
          window.addEventListener("wheel",      cancelEarly, { once: true, passive: true });
          window.addEventListener("pointerdown", cancelEarly, { once: true, passive: true });
          window.addEventListener("keydown",    cancelEarly, { once: true });
          peekTimer = setTimeout(() => {
            removePeekListeners();
            markPeekShown(); // only once it really plays — cancelled early, it comes back next visit
            runScrollIndicator();
          }, 800);
        }
      }, 1000);
    });
  } else { hasSeenBanner = true; intro.done(); setTimeout(syncUiMode, 0); }

  // ── Universal transition lock ────────────────────────────────
  // tLock.acquire(ms)  — sets isAnimating, auto-releases after ms
  // tLock.release()    — cancels pending timer, releases immediately
  // tLock.bump(ms)     — cancel + re-acquire (interrupt into new anim)
  // CSS handles visual reversal automatically when classes change
  // mid-transition — the lock just keeps JS state honest.
  const tLock = {
    _t: null,
    acquire(ms) {
      if (this._t) { clearTimeout(this._t); this._t = null; }
      isAnimating = true;
      this._t = setTimeout(() => { this._t = null; isAnimating = false; }, ms);
    },
    release() {
      if (this._t) { clearTimeout(this._t); this._t = null; }
      isAnimating = false;
    },
    bump(ms) { this.release(); this.acquire(ms); }
  };


  if (menuBtn) menuBtn.addEventListener("click", () => {
    toggleMenu();
  });

  // The menu button's label (Menu / Close / page name) changes like all other text:
  // the old word dissolves letter by letter, the new one types in. A change requested
  // while the old word is still dissolving just updates what types in next.
  const menuLabel = (key) => {
    const de = window.getCurrentLang && window.getCurrentLang() === "de";
    return { menu: de ? "Menü" : "Menu", close: de ? "Schließen" : "Close" }[key];
  };
  function setMenuLabel(text) { swapLabel(menuBtn, text); }

  function toggleMenu(skipFadeToMenu = false) {
    finishFeed();
    isMenuOpen = !isMenuOpen;
    const activePage = pages[currentPage];
    if (isMenuOpen) {
      menuOverlay.classList.add("open");
      menuOverlay.inert = false;
      menuBtn.setAttribute("aria-expanded", "true");
      clearTimeout(menuTimeout);
      setMenuLabel(menuLabel("close"));
      if (activePage) {
        activePage.style.transformOrigin = "bottom center";
        activePage.classList.remove("visible");
        activePage.classList.add("hidden");
        activePage.setAttribute("aria-hidden", "true");
        activePage.inert = true;
      }
    } else {
      menuOverlay.classList.remove("open");
      menuOverlay.inert = true;
      menuBtn.setAttribute("aria-expanded", "false");
      // Not when a page name is about to show there instead
      if (!skipFadeToMenu) setMenuLabel(menuLabel("menu"));
      if (activePage) {
        activePage.style.transformOrigin = "bottom center";
        if (currentPage === "home") {
          const activeSlide = homeSlides[currentIndex];
          if (activeSlide) {
            homeSlides.forEach((s) => s.classList.remove("active", "exit"));
            activeSlide.style.transition = "none";
            activeSlide.style.transform = "scaleY(1)";
            activeSlide.style.opacity = "1";
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                activeSlide.style.transition = "";
                activeSlide.style.transform = "";
                activeSlide.style.opacity = "";
                activeSlide.classList.add("active");
              });
            });
          }
        }
        // Re-adding .visible mid-hide: CSS transitions back from current scaleY automatically
        activePage.classList.remove("hidden");
        activePage.classList.add("visible");
        activePage.setAttribute("aria-hidden", "false");
        activePage.inert = false;
      }
    }
    syncUiMode(); // menu open: difference blend on black; closed on home: adaptive colours
    tLock.bump(950); // bump = cancel any in-flight timer + re-acquire
  }

  // After navigating: the page name shows in the menu button for a moment
  function flashMenuText(pageName) {
    clearTimeout(menuTimeout);
    const lang = (window.getCurrentLang && window.getCurrentLang()) || "en";
    const navLink = document.querySelector(`.nav-link[data-dest="${pageName}"]`);
    setMenuLabel(navLink ? navLink.getAttribute(`data-${lang}`) || navLink.getAttribute("data-en") : pageName);
    menuTimeout = setTimeout(() => { if (!isMenuOpen) setMenuLabel(menuLabel("menu")); }, 2400);
  }

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const dest = link.getAttribute("data-dest");
      if (dest === currentPage) {
        if (isMenuOpen) toggleMenu();
        return;
      }
      navigateTo(dest, "next"); // push = true (default) — adds a real history entry
    });
  });

  function updateMenuLinks(dest) {
    document.querySelectorAll("#menu-overlay .nav-link").forEach((item) => {
      item.classList.remove("active-page");
      if (item.getAttribute("data-dest") === dest) item.classList.add("active-page");
    });
  }

  // ── Page title + OG meta updater ──────────────────────────────
  window.updatePageTitle = function(page) { updatePageTitle(page); };
  function updatePageTitle(page) {
    const lang = (window.getCurrentLang && window.getCurrentLang()) || "en";
    // Titles live on each <main> (data-title-en/-de) — shared with build-pages.js
    const pageEl = pages[page] || pages.home;
    const title = pageEl.getAttribute(`data-title-${lang}`) || pageEl.getAttribute("data-title-en");

    document.title = title;

    const setMeta = (sel, attr, val) => {
      const el = document.querySelector(sel);
      if (el) el.setAttribute(attr, val);
    };
    setMeta('meta[property="og:title"]',    "content", title);
    setMeta('meta[name="twitter:title"]',   "content", title);
    const canonicalBase = "https://julianjakob.at";
    const ogUrl = `${canonicalBase}${page === "home" || !pages[page] ? "/" : "/" + page}`;
    setMeta('meta[property="og:url"]', "content", ogUrl);
    const canonicalEl = document.querySelector('link[rel="canonical"]');
    if (canonicalEl) canonicalEl.setAttribute("href", ogUrl);
  }

  function navigateTo(dest, direction = "next", push = true) {
    // From the menu a link works at once, even while the menu is still unfolding
    if (!pages[dest] || (isAnimating && !isMenuOpen)) return;
    finishFeed();
    const oldPage = pages[currentPage],
      newPage = pages[dest];

    if (isMenuOpen) {
      if (oldPage) {
        oldPage.classList.remove("visible");
        oldPage.classList.add("hidden");
      }
      if (newPage) {
        newPage.scrollTop = 0;
        newPage.classList.remove("visible");
        newPage.classList.add("hidden");
      }
      updateMenuLinks(dest);
      currentPage = dest;
      syncSlideMedia(currentIndex);
      setHash(dest === "home" ? "" : dest, push); // push real history entry
      updatePageTitle(dest);
      fixColumnBreaks(newPage || document);
      syncUiMode();
      toggleMenu(dest !== "home"); // skip "Menu" label when navigating to a page
      if (dest !== "home") flashMenuText(dest); // "Close" turns into the page name
      return;
    }

    if (oldPage) {
      const oldOrigin = dest === "home" ? "bottom center"
                      : direction === "next" ? "top center" : "bottom center";
      oldPage.style.transformOrigin = oldOrigin;
      oldPage.classList.remove("visible");
      oldPage.classList.add("hidden");
      oldPage.setAttribute("aria-hidden", "true");
      oldPage.inert = true;
    }
    if (newPage) {
      if (dest === "home") {
        newPage.style.transformOrigin = "top center";
        // FIX: snap active slide to visible instantly — page unfold is the animation
        const activeSlide = homeSlides[currentIndex];
        if (activeSlide) {
          homeSlides.forEach((s) => s.classList.remove("active", "exit"));
          activeSlide.style.transition = "none";
          activeSlide.style.transform = "scaleY(1)";
          activeSlide.style.opacity = "1";
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              activeSlide.style.transition = "";
              activeSlide.style.transform = "";
              activeSlide.style.opacity = "";
              activeSlide.classList.add("active");
            });
          });
        }
      } else if (direction === "next") {
        newPage.scrollTop = 0;
        newPage.style.transformOrigin = "bottom center";
      } else {
        newPage.scrollTop = newPage.scrollHeight;
        newPage.style.transformOrigin = "top center";
      }
      newPage.classList.remove("hidden");
      newPage.classList.add("visible");
      newPage.setAttribute("aria-hidden", "false");
      newPage.inert = false;
    }

    if (dest !== "home") flashMenuText(dest);
    setHash(dest === "home" ? "" : dest, push);
    updateMenuLinks(dest);
    currentPage = dest;
    syncSlideMedia(currentIndex);
    updatePageTitle(dest);
    fixColumnBreaks(newPage || document);
    syncUiMode();
    tLock.acquire(950);


  }

  initServicesAccordion();
  // Services: like the Details panel — closing, the text dissolves first and the row
  // folds after it; opening, the row unfolds and the text types in on the way.
  function initServicesAccordion() {
    document.querySelectorAll(".service-row").forEach((row) => {
      const body = row.querySelector(".service-body");
      const texts = () => [...body.querySelectorAll(".service-description, .type-service-tags")];
      let run = 0, open = row.classList.contains("expanded");
      const handleToggle = () => {
        const expand = (open = !open);
        const r = ++run;
        const toggle = row.querySelector(".service-toggle");
        if (toggle) toggle.textContent = expand ? "–" : "+"; // Garamond's own en dash: longer than a minus
        row.setAttribute("aria-expanded", String(expand));
        if (expand) {
          body.querySelectorAll(".text-out").forEach((span) => span.replaceWith(...span.childNodes));
          body.normalize();
          body.style.visibility = "hidden";
          row.classList.add("expanded");
          setTimeout(() => {
            if (r !== run) return;
            body.style.visibility = "";
            texts().forEach((el) => typewriterIn(el));
          }, 200);
        } else {
          body.style.visibility = "";
          const gone = textOut(texts());
          setTimeout(() => { if (r === run) row.classList.remove("expanded"); }, Math.min(gone, 200));
        }
      };
      row.addEventListener("click", handleToggle);
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleToggle(); }
      });
    });
  }


  // Scroll hint — shown once per visitor, dismissed on first interaction
  let scrollHintActive = false;

  function abortPeek() {
    if (!scrollHintActive) return;
    scrollHintActive = false;
    const hint = document.getElementById("scroll-hint");
    if (hint) {
      hint.style.transition = "opacity 0.3s ease-in";
      hint.style.opacity    = "0";
    }
  }

  async function runScrollIndicator() {
    if (homeSlides.length <= 1) return;
    const hint = document.getElementById("scroll-hint");
    if (!hint) return;

    scrollHintActive = true;

    const HALF_DUR  = 650;   // center → first endpoint
    const SWEEP_DUR = 920;   // endpoint → endpoint
    const HOLD      = 120;   // pause at each end
    const MOVE      = 55;    // px
    const CURVE     = "cubic-bezier(0.34, 1.4, 0.64, 1)";

    const wait   = ms => new Promise(r => setTimeout(r, ms));
    const alive  = () => scrollHintActive;
    const arrowL = hint.querySelector(".sh-arrow-l");
    const arrowR = hint.querySelector(".sh-arrow-r");

    // Accumulated rotation values
    let lRot = 0, rRot = 180; // inward: L→ R←

    const rotateArrows = (dl, dr) => {
      lRot += dl; rRot += dr;
      arrowL.style.transition = "none";
      arrowR.style.transition = "none";
      arrowL.style.transform  = `rotate(${lRot}deg)`;
      arrowR.style.transform  = `rotate(${rRot}deg)`;
    };

    const move = (dur, dest) => {
      hint.style.transition = `transform ${dur}ms ${CURVE}`;
      hint.style.transform  = dest;
    };

    // Fade in (arrows already inward from CSS)
    hint.style.transition = "opacity 350ms ease-out";
    hint.style.opacity    = "1";
    await wait(350);
    if (!alive()) return;

    // Snap to UP + move to top
    rotateArrows( -90, +90);
    move(HALF_DUR, `translateY(calc(-50% - ${MOVE}px))`);
    await wait(HALF_DUR + HOLD);
    if (!alive()) return;

    // Sweep DOWN
    rotateArrows( +180, -180);
    move(SWEEP_DUR, `translateY(calc(-50% + ${MOVE}px))`);
    await wait(SWEEP_DUR + HOLD);
    if (!alive()) return;

    // Sweep UP
    rotateArrows( -180, +180);
    move(SWEEP_DUR, `translateY(calc(-50% - ${MOVE}px))`);
    await wait(SWEEP_DUR + HOLD);
    if (!alive()) return;

    // Sweep DOWN
    rotateArrows( +180, -180);
    move(SWEEP_DUR, `translateY(calc(-50% + ${MOVE}px))`);
    await wait(SWEEP_DUR + HOLD);
    if (!alive()) return;

    // Snap back to inward + return to center
    rotateArrows( -90, +90);
    move(HALF_DUR, "translateY(-50%)");
    await wait(HALF_DUR);
    if (!alive()) return;

    // Fade out
    hint.style.transition = "opacity 350ms ease-in";
    hint.style.opacity    = "0";
    await wait(350);
    scrollHintActive = false;
  }

  // ── Home feed ────────────────────────────────────────────────
  // The feed is a continuous position (feedX, in slides). Between slide a and
  // a+1 the current slide folds up (scaleY, origin top) while the next unfolds
  // from the bottom — the original transition, but driven frame by frame so
  // a finger can drag it, flick it, and grab it again mid-animation (Reels-style).
  // At rest the slides go back to plain .active classes, which the menu and
  // page transitions rely on.
  const SLIDE_SLOW_MS = 700;   // matches --anim-speed: calm swipes, wheel, keys
  const SLIDE_FAST_MS = 280;   // hard flicks
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const mod = (a, n) => ((a % n) + n) % n;
  // px/ms → 0..1: ≤0.3 px/ms is a calm swipe, ≥1.2 px/ms a hard flick
  const velocityIntensity = (pxPerMs) => clamp01((pxPerMs - 0.3) / 0.9);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // CSS-style cubic-bezier easing for the JS-driven animation
  function cubicBezier(x1, y1, x2, y2) {
    const bez = (t, a, b) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
    return (x) => {
      let lo = 0, hi = 1, t = x;
      for (let k = 0; k < 24; k++) { t = (lo + hi) / 2; if (bez(t, x1, x2) < x) lo = t; else hi = t; }
      return bez(t, y1, y2);
    };
  }
  const EASE_SLIDE   = cubicBezier(0.80, 0, 0.20, 1); // --anim-curve
  const EASE_RELEASE = cubicBezier(0.22, 1, 0.36, 1); // finger let go: keep moving, then settle

  let feedX = homeSlides.length; // float position (middle loop copy); mod(round(feedX), n) is the slide in view
  let feedAnim = null;    // { from, to, start, duration, ease, raf }
  let feedLive = false;   // slides currently driven by inline styles
  let feedShownIdx = 0;   // slide whose title is in the footer

  // Videos play as soon as any part of their slide is on screen — also when
  // someone just peeks at the next slide mid-drag. Off-screen ones pause.
  function setSlideVideosPlaying(slide, playing) {
    if (slide._videosPlaying === playing) return;
    slide._videosPlaying = playing;
    slide.querySelectorAll("video:not([data-loop-standby])").forEach((v) => {
      if (playing) {
        if (v.preload !== "auto") v.preload = "auto";
        v.play().catch(() => {});
      } else rewindVideo(v);
    });
  }

  // Off screen: pause and go back to the first frame, so a video always enters from
  // its start — and the text colour is decided on that same starting frame
  function rewindVideo(v) {
    if (!v.paused) v.pause();
    if (v.readyState > 0 && v.currentTime > 0) v.currentTime = 0;
  }

  function renderFeed(x) {
    const n = homeSlides.length;
    const base = Math.floor(x), f = x - base;
    const a = mod(base, n), b = mod(base + 1, n);
    homeSlides.forEach((s, i) => {
      s.style.transition = "none";
      setSlideVideosPlaying(s, i === a ? f < 1 : i === b && f > 0);
      if (i === a) {
        s.style.transformOrigin = "top center";
        s.style.transform = `scaleY(${1 - f})`;
        s.style.opacity = "1";
        s.style.zIndex = "10";
      } else if (i === b && f > 0) {
        s.style.transformOrigin = "bottom center";
        s.style.transform = `scaleY(${f})`;
        s.style.opacity = "1";
        s.style.zIndex = "10";
      } else {
        s.style.transform = "scaleY(0)";
        s.style.opacity = "0";
        s.style.zIndex = "1";
      }
    });
    feedLive = true;
    updateUiColors(false, true); // per frame: only the slide behind each spot can change

    const shown = mod(Math.round(x), n);
    if (shown !== feedShownIdx) {
      feedShownIdx = shown;
      updateFooter(homeSlides[shown]);
      syncSlideMedia(shown, { playOnly: true });
    }
  }

  // Back to class-based state at an integer position
  function settleFeed() {
    stopCushion();
    const n = homeSlides.length;
    feedX = n + mod(Math.round(feedX), n); // re-centre onto the middle loop copy
    const idx = feedX - n;
    homeSlides.forEach((s, i) => {
      s.style.transition = "none";
      s.classList.remove("exit");
      s.classList.toggle("active", i === idx);
      s.style.transform = s.style.opacity = s.style.transformOrigin = s.style.zIndex = "";
    });
    void pageHome.offsetWidth; // commit before re-enabling CSS transitions
    homeSlides.forEach((s) => { s.style.transition = ""; });
    feedLive = false;
    currentIndex = idx;
    if (feedShownIdx !== idx) { feedShownIdx = idx; updateFooter(homeSlides[idx]); }
    syncSlideMedia(idx);
    syncScroller();
    updateUiColors(false);
  }

  function stopFeedAnim() {
    if (!feedAnim) return null;
    cancelAnimationFrame(feedAnim.raf);
    const target = feedAnim.to;
    feedAnim = null;
    return target;
  }

  // ── Cushion ──────────────────────────────────────────────────
  // Every landing — drag release, keys, trackpad snap — goes through here.
  // targetX is where the motion says the feed is; feedX (what's drawn) follows
  // it with a short exponential glide, so the last few milliseconds ease in
  // softly instead of stopping dead. While a finger drags or wheel events
  // arrive, the fold is drawn directly — no smoothing, no lag.
  const CUSHION_MS = 45;       // softness of the landing (higher = softer and more visible)
  let targetX = feedX;
  let targetIdle = true;       // the motion has finished; settle once the glide arrives
  let cushionRaf = 0, cushionLast = 0;
  let lastWheelAt = 0;

  function cushionStep(now) {
    const dt = Math.min(64, now - cushionLast);
    cushionLast = now;
    const direct = now - lastWheelAt < 60;
    feedX = direct ? targetX : feedX + (targetX - feedX) * (1 - Math.exp(-dt / CUSHION_MS));
    if (Math.abs(targetX - feedX) < 0.0005) feedX = targetX;
    renderFeed(feedX);
  }

  function cushionLoop(now) {
    cushionRaf = 0;
    if (feedAnim) return; // the animation drives the cushion itself
    cushionStep(now);
    if (feedX === targetX && targetIdle) { settleFeed(); return; }
    cushionRaf = requestAnimationFrame(cushionLoop);
  }

  function startCushion() {
    if (cushionRaf || feedAnim) return;
    cushionLast = performance.now();
    cushionRaf = requestAnimationFrame(cushionLoop);
  }

  function stopCushion() {
    if (cushionRaf) cancelAnimationFrame(cushionRaf);
    cushionRaf = 0;
  }

  function animateFeed(to, duration, ease) {
    stopFeedAnim();
    stopCushion();
    const from = feedX;
    targetX = from;
    if (reduceMotion.matches) duration = 0;
    if (duration <= 0 || from === to) { feedX = targetX = to; renderFeed(feedX); settleFeed(); return; }
    const anim = { from, to, start: performance.now(), duration, ease, raf: 0 };
    targetIdle = false;
    cushionLast = anim.start;
    const step = (now) => {
      const t = clamp01((now - anim.start) / anim.duration);
      targetX = anim.from + (anim.to - anim.from) * anim.ease(t);
      cushionStep(now);
      if (t < 1) anim.raf = requestAnimationFrame(step);
      else { feedAnim = null; targetIdle = true; startCushion(); } // glide the last bit in
    };
    feedAnim = anim;
    anim.raf = requestAnimationFrame(step);
  }

  // Jump straight to where the feed is heading (before menus / page changes)
  function finishFeed() {
    stopCushion();
    const target = stopFeedAnim();
    if (target !== null) feedX = target;
    if (feedLive) { renderFeed(feedX); settleFeed(); }
  }

  const feedReady = () =>
    currentPage === "home" && !isMenuOpen && (hasSeenBanner || !banner) && homeSlides.length > 1;

  // Wheel / keys: one slide with the original timing and curve.
  // Keys may be pressed again mid-transition to continue to the next slide.
  function changeSlide(direction) {
    abortPeek(); // cancel any running peek hint immediately
    if (!feedReady() || (isAnimating && !feedAnim)) return;
    const moving = !!feedAnim;
    const from = moving ? feedAnim.to : Math.round(feedX);
    // Pressed again mid-flight: keep moving (ease-out) instead of restarting from standstill
    animateFeed(from + (direction === "next" ? 1 : -1), SLIDE_SLOW_MS, moving ? EASE_RELEASE : EASE_SLIDE);
  }

  function updateFooter(slide) {
    if (!footerTitle || !slide) return;
    footerTitle.textContent = slide.getAttribute("data-title") || "";
    typewriterIn(footerTitle);
    detailsFor(slide.getAttribute("data-slot"));
  }

  // A short label changing like all other text: the old word dissolves letter by letter,
  // the new one types in. A change requested mid-dissolve just updates what types in.
  function swapLabel(el, text) {
    el._labelNext = text;
    if (el._labelTimer || el.textContent === text) return;
    el._labelTimer = setTimeout(() => {
      el._labelTimer = 0;
      el.textContent = el._labelNext;
      typewriterIn(el);
    }, textOut([el]));
  }

  // ── Details panel (home) ──────────────────────────────────────
  // Closed by default. "Details" folds the panel up with the project's type, studio
  // and responsibilities (projects/NN/project.json → "details"); the text types in
  // letter by letter; "Details" folds it in again (Escape too). The grey hint next to it
  // says what a click will do (superscript + / –). The text itself is not clickable, so swipes,
  // drags and trackpad scrolling over it move the feed like anywhere else. Swiping while
  // it's open regenerates the text, and the panel's height glides to the new size.
  // `var`: updateFooter() runs for the first slide before this block is reached
  var detailsBtn     = document.getElementById("details-btn");
  var detailsPanel   = document.getElementById("details-panel");
  var detailsBody    = detailsPanel && detailsPanel.querySelector(".details-body");
  var detailsHint    = detailsBtn && detailsBtn.querySelector(".details-hint");
  // "+" closed, "–" open, as a small superscript: the Process accordion's symbols
  function setDetailsHint(open) {
    if (detailsHint) swapLabel(detailsHint, open ? "–" : "+");
  }
  var DETAILS_LABELS = {
    type:             { en: "Type",             de: "Art" },
    studio:           { en: "Studio",           de: "Studio" },
    year:             { en: "Year",             de: "Jahr" },
    responsibilities: { en: "Responsibilities", de: "Verantwortung" },
    note: { en: "For a full portfolio presentation,<br>please reach out.",
            de: "Für eine vollständige Portfoliopräsentation<br>melden Sie sich gern." },
  };
  var detailsOpen = false, detailsSlot = null, detailsRun = 0, currentSlot = (homeSlides[0] && homeSlides[0].getAttribute("data-slot")) || null;

  function detailsHTML(slot) {
    const proj = projects.find((p) => p.slot === slot);
    const d = (proj && proj.details) || {};
    const lang = (window.getCurrentLang && window.getCurrentLang()) || "en";
    const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const line = (en, de) => `<p data-en="${esc(en)}" data-de="${esc(de)}">${lang === "de" ? de : en}</p>`;
    const L = DETAILS_LABELS;
    const groups = [];
    // Label on its own line, value below ("Type:" / "Freelance Project")
    const fact = (label, en, de) => line(`${label.en}:`, `${label.de}:`) + line(en, de);
    if (d.type)   groups.push(fact(L.type, d.type.en || d.type, d.type.de || d.type.en || d.type));
    if (d.studio) groups.push(fact(L.studio, d.studio, d.studio));
    if (d.year)   groups.push(fact(L.year, String(d.year), String(d.year)));
    const resp = d.responsibilities;
    if (resp && resp.en && resp.en.length) {
      const de = resp.de || resp.en;
      groups.push(line(`${L.responsibilities.en}:`, `${L.responsibilities.de}:`) +
        resp.en.map((item, i) => line(item, de[i] || item)).join(""));
    }
    groups.push(line(L.note.en, L.note.de));
    return groups.map((g) => `<div class="details-group">${g}</div>`).join("");
  }

  function typeDetails(slot, glide) {
    const from = detailsBody.offsetHeight;
    detailsBody.innerHTML = detailsHTML(slot);
    detailsSlot = slot;
    if (glide) {
      // Different amount of text: glide to the new height instead of jumping
      const to = detailsBody.scrollHeight;
      if (Math.abs(to - from) > 1) {
        detailsBody.style.height = from + "px";
        void detailsBody.offsetHeight;
        detailsBody.style.transition = "height var(--anim-speed) var(--anim-curve)";
        detailsBody.style.height = to + "px";
        clearTimeout(detailsBody._glide);
        detailsBody._glide = setTimeout(() => { detailsBody.style.height = ""; detailsBody.style.transition = ""; }, 800);
      }
    }
    detailsBody.querySelectorAll("p").forEach((line) => typewriterIn(line)); // each line on its own, like all other text
  }

  function openDetails() {
    if (detailsOpen || !detailsPanel) return;
    detailsOpen = true;
    const run = ++detailsRun;
    detailsBtn.setAttribute("aria-expanded", "true");
    setDetailsHint(true);
    detailsBody.innerHTML = detailsHTML(currentSlot); // invisible until typed, but sets the height
    detailsBody.style.visibility = "hidden";
    detailsPanel.classList.add("open");
    setTimeout(() => updateUiColors(true), 750); // the stack is taller now
    setTimeout(() => { // type once the panel has mostly unfolded, so lines don't drift while typing
      if (run !== detailsRun) return;
      detailsBody.style.visibility = "";
      typeDetails(currentSlot);
    }, 420);
  }

  function closeDetails() {
    if (!detailsOpen) return;
    detailsOpen = false;
    const run = ++detailsRun;
    detailsBtn.setAttribute("aria-expanded", "false");
    setDetailsHint(false);
    const gone = textOut([...detailsBody.querySelectorAll("p")]);
    setTimeout(() => { if (run === detailsRun) detailsPanel.classList.remove("open"); }, Math.min(gone, 200));
    setTimeout(() => updateUiColors(true), Math.min(gone, 200) + 750);
    setTimeout(() => { if (run === detailsRun) { detailsBody.innerHTML = ""; detailsSlot = null; } }, gone + 900);
  }

  // New slide: remember it; if the panel is open, regenerate its text
  function detailsFor(slot) {
    currentSlot = slot;
    if (!detailsOpen || !detailsBody || slot === detailsSlot) return;
    const run = ++detailsRun;
    const gone = textOut([...detailsBody.querySelectorAll("p")]);
    setTimeout(() => { if (run === detailsRun && detailsOpen) typeDetails(currentSlot, true); }, gone);
  }

  // ── Adaptive UI colour (home) ─────────────────────────────────
  // On the feed the "difference" blend is unreadable on mid-grey images, so the UI
  // turns solid black or white instead, measured from the pixels behind its letters.
  // Two groups share one colour each: the header (©julianjakob, DE/EN, Menu) and the
  // footer (Details, project title) — single words never flip on a detail of the picture.
  // Rule: on a new slide, white if it reaches UI_LOW_CONTRAST against the group's
  // average background, else black. After that the colour stays — it only switches
  // once it has had low contrast for UI_SWITCH_MS (moving video).
  // Everywhere else (white pages, black menu) the original difference blend stays.
  var uiGroups = null, uiVideoTimer = 0;
  var UI_LOW_CONTRAST = 3;   // contrast ratio below this counts as hard to read
  var UI_SWITCH_MS = 2000;   // …and only if it stays that low this long, the colour switches
  // Pictures are read from a small thumbnail of the whole image (drawing a sub-region
  // of a responsive <img> is unreliable across browsers). sRGB → linear via lookup table.
  var UI_THUMB_W = 128, uiThumbs = new WeakMap();
  var UI_LIN = new Float32Array(256).map((_, c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });

  function uiThumb(media, isVideo, now) {
    let t = uiThumbs.get(media);
    if (t && (isVideo ? now - t.at < 300 : t.src === media.currentSrc)) return t; // a video frame is shared by all spots
    const nw = isVideo ? media.videoWidth : media.naturalWidth, nh = isVideo ? media.videoHeight : media.naturalHeight;
    const w = UI_THUMB_W, h = Math.max(1, Math.round(w * nh / nw));
    if (!t) { const c = document.createElement("canvas"); t = { canvas: c, ctx: c.getContext("2d", { willReadFrequently: true }) }; }
    t.canvas.width = w; t.canvas.height = h;
    t.ctx.drawImage(media, 0, 0, w, h);
    const px = t.ctx.getImageData(0, 0, w, h).data;
    t.lum = new Float32Array(w * h);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) t.lum[j] = 0.2126 * UI_LIN[px[i]] + 0.7152 * UI_LIN[px[i + 1]] + 0.0722 * UI_LIN[px[i + 2]];
    t.w = w; t.h = h; t.src = isVideo ? null : media.currentSrc; t.at = now;
    uiThumbs.set(media, t);
    return t;
  }

  function uiGroupList() {
    if (!uiGroups) uiGroups = [
      [document.querySelector("#main-header .brand"), document.getElementById("lang-toggle"), menuBtn],
      [document.querySelector("#project-footer .project-details"), footerTitle],
    ].map((els) => ({ els: els.filter(Boolean) }));
    return uiGroups;
  }

  const uiActive = () => currentPage === "home" && !isMenuOpen && hasSeenBanner;

  // "Print" sits next to the language toggle on the CV page only, and leaves when
  // the menu opens — appearing / leaving like all other text
  const printBtn = document.getElementById("print-btn");
  if (printBtn) printBtn.addEventListener("click", () => window.print());
  let printShown = false, printTimer = 0;
  function syncPrintBtn() {
    const show = currentPage === "cv" && !isMenuOpen;
    if (!printBtn || show === printShown) return;
    printShown = show;
    clearTimeout(printTimer);
    if (show) {
      const lang = (window.getCurrentLang && window.getCurrentLang()) || "en";
      printBtn.textContent = printBtn.getAttribute(`data-${lang}`); // clean text, current language
      printBtn.hidden = false;
      typewriterIn(printBtn);
    }
    else printTimer = setTimeout(() => { printBtn.hidden = true; }, textOut([printBtn]));
  }

  function syncUiMode() {
    syncPrintBtn();
    const on = uiActive();
    document.documentElement.classList.toggle("ui-adaptive", on);
    if (on) { updateUiColors(true); return; }
    clearInterval(uiVideoTimer); uiVideoTimer = 0;
    uiGroupList().forEach((g) => {
      g.els.forEach((el) => { el.style.color = ""; });
      g.white = undefined; g.slide = null; g.lowSince = 0;
    });
  }

  // Layout rect of an element inside its slide (transform-free; slides fill the viewport)
  function slideRect(el, slide) {
    let x = 0, y = 0, n = el;
    while (n && n !== slide) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { left: x, top: y, right: x + el.offsetWidth, bottom: y + el.offsetHeight };
  }

  // Mean relative luminance (0 black … 1 white) of what is behind `rect` on `slide`
  function sampleSlide(slide, rect, now) {
    const areaOf = (r) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
    const total = areaOf(rect);
    if (!total) return null;
    let sum = 0, covered = 0;
    for (const media of slide.querySelectorAll("img, video:not([data-loop-standby])")) {
      const isVideo = media.tagName === "VIDEO";
      const nw = isVideo ? media.videoWidth : media.naturalWidth, nh = isVideo ? media.videoHeight : media.naturalHeight;
      const box = slideRect(media, slide);
      const bw = box.right - box.left, bh = box.bottom - box.top;
      if (!bw || !bh || box.right <= rect.left || box.left >= rect.right || box.bottom <= rect.top || box.top >= rect.bottom) continue;
      if (!nw || !nh || (isVideo && media.readyState < 2)) return null; // behind the text but not ready: unknown
      // Where the picture is actually drawn inside its box (object-fit)
      const fit = getComputedStyle(media).objectFit;
      let sx = bw / nw, sy = bh / nh;
      if (fit === "cover") sx = sy = Math.max(sx, sy);
      else if (fit === "contain" || fit === "scale-down") sx = sy = Math.min(sx, sy);
      const dx = box.left + (bw - nw * sx) / 2, dy = box.top + (bh - nh * sy) / 2;
      const r = {
        left: Math.max(rect.left, box.left, dx), top: Math.max(rect.top, box.top, dy),
        right: Math.min(rect.right, box.right, dx + nw * sx), bottom: Math.min(rect.bottom, box.bottom, dy + nh * sy),
      };
      const a = areaOf(r);
      if (!a) continue;
      try {
        const t = uiThumb(media, isVideo, now);
        const x0 = Math.max(0, Math.floor((r.left - dx) / (nw * sx) * t.w)), x1 = Math.min(t.w, Math.ceil((r.right - dx) / (nw * sx) * t.w));
        const y0 = Math.max(0, Math.floor((r.top - dy) / (nh * sy) * t.h)), y1 = Math.min(t.h, Math.ceil((r.bottom - dy) / (nh * sy) * t.h));
        let s1 = 0, n = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s1 += t.lum[y * t.w + x]; n++; }
        if (n) { sum += (s1 / n) * a; covered += a; }
      } catch (e) { return null; }
    }
    return (sum + (total - covered)) / total; // uncovered = the slide's white background
  }

  // Tight boxes around a spot's text lines; cached until its text or size changes.
  // During a swipe the text doesn't move, so frames reuse the last measurement
  // (re-checking the size every frame would force a layout).
  function uiTextRects(el, reuse) {
    if (reuse && el._uiRects) return el._uiRects;
    const key = el.textContent + "|" + el.offsetWidth + "x" + el.offsetHeight;
    if (el._uiRectsKey === key) return el._uiRects;
    const rects = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (!n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > window.innerHeight) continue;
        // Merge pieces of the same line (text being typed in is split into letters)
        const line = rects.find((q) => Math.abs((q.top + q.bottom) / 2 - (r.top + r.bottom) / 2) < r.height / 2);
        if (line) { line.left = Math.min(line.left, r.left - 4); line.right = Math.max(line.right, r.right + 4); }
        else rects.push({ left: r.left - 4, top: r.top - 3, right: r.right + 4, bottom: r.bottom + 3 });
      }
    }
    el._uiRectsKey = key;
    el._uiRects = rects;
    return rects;
  }

  // Which slide is behind a viewport y position right now (during a swipe: top = outgoing, bottom = incoming)
  function slideAtY(y) {
    const n = homeSlides.length;
    if (!feedLive) return homeSlides[currentIndex];
    const base = Math.floor(feedX), f = feedX - base;
    return y < (1 - f) * window.innerHeight ? homeSlides[mod(base, n)] : homeSlides[mod(base + 1, n)];
  }

  function updateUiColors(force, frame) {
    if (!uiActive()) return;
    const now = performance.now();
    let hasVideo = false;
    uiGroupList().forEach((g) => {
      const lines = g.els.flatMap((el) => uiTextRects(el, frame));
      if (!lines.length) return;
      const slide = slideAtY((lines[0].top + lines[lines.length - 1].bottom) / 2);
      if (!slide) return;
      const video = !!slide.querySelector("video");
      if (video) hasVideo = true;
      // Average background luminance behind all the group's lines (area-weighted);
      // still pictures are measured once per slide and text layout
      const key = Array.prototype.indexOf.call(homeSlides, slide) + g.els.map((el) => el._uiRectsKey).join();
      if (force || video || !g.measured || g.measured.key !== key) {
        let sum = 0, area = 0;
        for (const r of lines) {
          const L = sampleSlide(slide, r, now);
          if (L === null) return; // media not ready: keep the current colour
          const a = (r.right - r.left) * (r.bottom - r.top);
          sum += L * a; area += a;
        }
        const avg = sum / area;
        g.measured = { key, w: 1.05 / (avg + 0.05), b: (avg + 0.05) / 0.05 }; // WCAG contrast of white / black
      }
      const c = g.measured;
      let white = g.white;
      if (white === undefined || g.slide !== slide || force) {
        white = c.w >= UI_LOW_CONTRAST; // new slide (or text changed): white wherever it reads
        g.lowSince = 0;
      } else if ((white ? c.w : c.b) < UI_LOW_CONTRAST && (white ? c.b > c.w : c.w > c.b)) {
        // Same slide, current colour hard to read: switch only after UI_SWITCH_MS of that
        if (!g.lowSince) g.lowSince = now;
        if (now - g.lowSince >= UI_SWITCH_MS) { white = !white; g.lowSince = 0; }
      } else g.lowSince = 0;
      g.white = white;
      g.slide = slide;
      g.els.forEach((el) => { el.style.color = white ? "#fff" : "#000"; });
    });
    // Moving pictures: re-check twice a second while a video sits behind the text
    if (hasVideo && !uiVideoTimer) uiVideoTimer = setInterval(() => updateUiColors(false), 500);
    if (!hasVideo && uiVideoTimer) { clearInterval(uiVideoTimer); uiVideoTimer = 0; }
  }
  // Images arriving / resizing can change what is behind the text
  homeSlides.forEach((s) => s.querySelectorAll("img").forEach((img) => img.addEventListener("load", () => updateUiColors(true))));
  window.addEventListener("resize", () => updateUiColors(true));

  if (detailsBtn && detailsPanel) {
    detailsBtn.addEventListener("click", () => (detailsOpen ? closeDetails() : openDetails()));
  }

  // ── Drag / swipe (touch + mouse) ─────────────────────────────
  let drag = null; // { id, startY, startX, startFeed, anchor, resumeTo, active, samples }

  window.addEventListener("pointerdown", (e) => {
    // A previous drag whose release never arrived (system gesture, focus loss…) must not
    // block the feed: a new press always ends it first
    if (drag) endDrag(null, true);
    if (!feedReady() || (isAnimating && !feedAnim)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Swipes may start anywhere on the feed — also on the logo, Menu, Details and the open
    // Details text. A press only becomes a swipe once it moves (see pointermove); a plain
    // tap stays a click, and the click after a real swipe is swallowed (see endDrag)
    if (e.target.closest && e.target.closest("#menu-overlay")) return;
    abortPeek();
    stopCushion();                   // grab the slide mid-glide…
    const resumeTo = stopFeedAnim(); // …or mid-flight
    drag = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startFeed: feedX,
      anchor: resumeTo !== null ? resumeTo : Math.round(feedX),
      resumeTo,
      active: false,
      samples: [{ y: e.clientY, t: performance.now() }],
    };
  });

  window.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (e.pointerType === "mouse" && e.buttons === 0) { endDrag(e); return; } // button released elsewhere
    const dy = drag.startY - e.clientY; // >0 = finger moves up = next slide
    const dx = e.clientX - drag.startX;
    if (!drag.active) {
      if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
      if (Math.abs(dx) > Math.abs(dy)) { endDrag(e, true); return; } // horizontal: not ours
      drag.active = true;
      document.body.style.userSelect = "none";
    }
    const now = performance.now();
    drag.samples.push({ y: e.clientY, t: now });
    while (drag.samples.length > 2 && now - drag.samples[0].t > 100) drag.samples.shift();
    // Finger follows the fold line 1:1; at most one slide per swipe
    const x = drag.startFeed + dy / window.innerHeight;
    feedX = targetX = Math.min(drag.anchor + 1, Math.max(drag.anchor - 1, x));
    renderFeed(feedX);
  });

  function endDrag(e, cancelled = false) {
    if (!drag || (e && e.pointerId !== undefined && e.pointerId !== drag.id)) return;
    const d = drag;
    drag = null;
    document.body.style.userSelect = "";
    // A swipe that started or ended on a control (Details, logo, Menu…) must not also click it
    if (d.active) {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
    }

    if (!d.active || cancelled) {
      // Tap or horizontal move: let an interrupted transition finish
      if (d.resumeTo !== null) animateFeed(d.resumeTo, SLIDE_SLOW_MS * Math.abs(d.resumeTo - feedX), EASE_RELEASE);
      else if (feedLive) animateFeed(Math.round(feedX), 200, EASE_RELEASE);
      return;
    }

    const first = d.samples[0], last = d.samples[d.samples.length - 1];
    const dt = Math.max(16, performance.now() - first.t);
    const v = (first.y - last.y) / dt; // px/ms, >0 = towards next
    let target;
    if (Math.abs(v) > 0.3) target = v > 0 ? Math.ceil(feedX - 1e-6) : Math.floor(feedX + 1e-6);
    else target = Math.round(feedX);
    target = Math.min(d.anchor + 1, Math.max(d.anchor - 1, target));

    // Swipe speed sets the speed of the rest of the transition
    const msPerSlide = SLIDE_SLOW_MS - (SLIDE_SLOW_MS - SLIDE_FAST_MS) * velocityIntensity(Math.abs(v));
    animateFeed(target, Math.max(120, msPerSlide * Math.abs(target - feedX)), EASE_RELEASE); // cushion adds the landing
  }
  let suppressClick = false;
  window.addEventListener("click", (e) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  window.addEventListener("pointerup", (e) => endDrag(e));
  window.addEventListener("pointercancel", (e) => endDrag(e));
  // Releases that never reach the page (app switch, tab hidden…) still end the drag
  window.addEventListener("blur", () => endDrag(null));
  document.addEventListener("visibilitychange", () => { if (document.hidden) endDrag(null); });

  // ── Trackpad / mouse wheel: native scrolling ─────────────────
  // An invisible scroll layer (#feed-scroller) sits over the slides with one
  // snap point per slide. The browser handles trackpad fingers, momentum and
  // "one item per swipe" (scroll-snap-stop) exactly like any native page; the
  // fold is drawn from its scroll position. Three copies of the snap points
  // let the feed loop: at rest it is re-centred onto the middle copy.
  // Touch and mouse-drag don't scroll it — they use the pointer code above.
  // While wheel events arrive the fold follows the scroll 1:1 (see cushion).
  const TRACKPAD_DISTANCE = 1.25; // scrolling per slide, in viewport heights (higher = slower)
  const TRACKPAD_COMMIT = 0.15;   // share of a slide that commits a swipe (lower = more eager)
  const scroller = document.getElementById("feed-scroller");
  let scrollSyncing = false;   // ignore scroll events caused by our own scrollTop writes
  let scrollIdleTimer = 0;
  // The browser snaps to the nearest point, so a gentle swipe (< half a slide) would
  // bounce back. Once a swipe passes TRACKPAD_COMMIT, the snap point it started from
  // is switched off: the nearest one left is the next slide in that direction.
  // The decision is read from the trackpad input itself (a frame before the scroll it
  // causes) and it sticks until the feed lands: the browser's own snap-back motion never
  // undoes it — only fingers pulling back do. Otherwise a short, quick swipe that ends
  // before the switch reaches the browser would snap back and stay there ("stuck").
  const snaps = [];
  let restIdx = -1;            // snap point of the slide the feed rests on
  let commitDir = 0;           // -1 / 0 / 1: where this swipe is going
  let wheelSum = 0;            // trackpad travel since the feed last rested (px)
  let steering = false;        // we took over the landing (see the scroll handler)
  let lastScrollPos = 0;

  function setRestSnap(on) {
    if (snaps[restIdx]) snaps[restIdx].classList.toggle("off", !on);
  }
  // One slide on from where the feed is landing (wheel over the header / footer bars):
  // drives the same native scroll as a swipe, so both kinds of input share one path
  function trackpadStep(dir) {
    if (feedAnim) finishFeed();
    const base = commitDir ? restIdx + commitDir : Math.round(scroller.scrollTop / slideScrollHeight());
    restIdx = base;
    commitDir = dir;
    wheelSum = 0;
    steering = true; // the landing is set; no snap-back to correct
    setRestSnap(false);
    scroller.scrollTo({ top: (base + dir) * slideScrollHeight(), behavior: "smooth" });
  }

  // d: travel in slides since rest; pullingBack: fingers moving against the commitment
  function updateCommit(d, pullingBack) {
    if (Math.abs(d) >= TRACKPAD_COMMIT) commitDir = Math.sign(d);
    else if (pullingBack) commitDir = 0;
    setRestSnap(!commitDir);
  }

  const slideScrollHeight = () => scroller.clientHeight * TRACKPAD_DISTANCE;

  function syncScroller() {
    if (!scroller) return;
    targetX = feedX;
    snaps.forEach((snap) => snap.classList.remove("off"));
    restIdx = Math.round(feedX);
    commitDir = 0;
    wheelSum = 0;
    steering = false;
    lastScrollPos = feedX;
    scrollSyncing = true;
    scroller.scrollTop = feedX * slideScrollHeight();
    requestAnimationFrame(() => { scrollSyncing = false; });
  }

  let snapWaits = 0;
  function onNativeScrollEnd() {
    if (!scroller || (drag && drag.active) || feedAnim) return;
    const pos = scroller.scrollTop / slideScrollHeight();
    // Snap still settling: check again shortly — but never wait forever (that would
    // leave the feed between two slides and, un-recentred, eventually at the end)
    if (Math.abs(pos - Math.round(pos)) > 0.01 && snapWaits++ < 4) {
      clearTimeout(scrollIdleTimer);
      scrollIdleTimer = setTimeout(onNativeScrollEnd, 150);
      return;
    }
    snapWaits = 0;
    targetX = Math.round(pos);
    targetIdle = true;
    startCushion(); // lands softly, then settles
  }

  if (scroller) {
    const n = homeSlides.length;
    // Each step is TRACKPAD_DISTANCE screens tall, but its snap target stays exactly one
    // screen: snap areas taller than the screen would let the browser stop mid-slide.
    for (let k = 0; k < n * 3; k++) {
      const step = document.createElement("div");
      step.style.height = `${TRACKPAD_DISTANCE * 100}%`;
      const snap = document.createElement("div");
      snap.className = "feed-snap";
      snap.style.height = `${100 / TRACKPAD_DISTANCE}%`;
      step.appendChild(snap);
      scroller.appendChild(step);
      snaps.push(snap);
    }
    if (n <= 1) scroller.style.overflowY = "hidden";

    scroller.addEventListener("scroll", () => {
      if (scrollSyncing || (drag && drag.active)) return;
      if (!feedReady()) { syncScroller(); return; } // e.g. during the intro banner
      if (feedAnim) stopFeedAnim();                  // trackpad takes over from keys
      targetX = scroller.scrollTop / slideScrollHeight();
      targetIdle = false;
      // Momentum carrying the feed away from where it rested can commit; nothing here
      // un-commits (moving back toward the start is the browser's bounce, not the fingers)
      const moving = Math.sign(targetX - lastScrollPos);
      lastScrollPos = targetX;
      if (Math.sign(targetX - restIdx) === moving) updateCommit(targetX - restIdx, false);
      // Committed, fingers off, yet moving back toward the start: the browser decided to
      // bounce back before our switch reached it (a short, quick swipe). It doesn't
      // re-target a bounce already running, so steer the landing to the next slide.
      if (commitDir && !steering && moving === -commitDir && performance.now() - lastWheelAt > 30) {
        steering = true;
        scroller.scrollTo({ top: (restIdx + commitDir) * slideScrollHeight(), behavior: "smooth" });
      }
      // Fingers/momentum: draw right now, like a drag (no frame of delay)
      if (performance.now() - lastWheelAt < 60) { feedX = targetX; renderFeed(feedX); }
      startCushion();
      clearTimeout(scrollIdleTimer);
      scrollIdleTimer = setTimeout(onNativeScrollEnd, 150);
    }, { passive: true });
    // Trackpad during a key/touch animation: jump that one to its end first, so
    // the native scroll continues from the right slide instead of a stale position
    scroller.addEventListener("wheel", (e) => {
      const now = performance.now(), gap = now - lastWheelAt;
      lastWheelAt = now;
      if (feedAnim) finishFeed();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? scroller.clientHeight : 1);
      // A new swipe while the last one is still landing counts from where that one lands,
      // so two swipes move two slides. The browser never says when fingers touch or lift,
      // so this only applies when it's certain: the same direction after a real pause, with
      // the last swipe already past halfway. Anything less is the same swipe continuing
      // (a pause mid-swipe, the coast after lifting) — counting it again would jump a slide.
      const landed = (scroller.scrollTop / slideScrollHeight() - restIdx) * commitDir;
      if (commitDir && gap > 250 && Math.sign(dy) === commitDir && landed > 0.5) {
        restIdx += commitDir;
        wheelSum = 0;
        commitDir = 0;
        steering = false;
      }
      wheelSum += dy;
      updateCommit(wheelSum / slideScrollHeight(), commitDir !== 0 && Math.sign(dy) === -commitDir);
    }, { passive: true, capture: true });
    scroller.addEventListener("scrollend", () => {
      if (scrollSyncing) return;
      clearTimeout(scrollIdleTimer);
      onNativeScrollEnd();
    });
    window.addEventListener("resize", () => { if (!feedLive) syncScroller(); });
    // Wheel over the header/footer controls can't reach the scroll layer: one slide per gesture.
    // Listening on the bars only (not the window): a blocking wheel listener on the window
    // would route every trackpad scroll through the main thread.
    let barWheelAt = 0, barWheelSum = 0, barWheelDone = false;
    const onBarWheel = (e) => {
      if (!feedReady()) return;
      e.preventDefault();
      const now = performance.now();
      if (now - barWheelAt > 120) { barWheelSum = 0; barWheelDone = false; } // a new gesture
      barWheelAt = now;
      barWheelSum += e.deltaY;
      if (!barWheelDone && Math.abs(barWheelSum) > slideScrollHeight() * TRACKPAD_COMMIT) {
        barWheelDone = true;
        trackpadStep(barWheelSum > 0 ? 1 : -1);
      }
    };
    ["main-header", "project-footer"].forEach((bar) => {
      const el = document.getElementById(bar);
      if (el) el.addEventListener("wheel", onBarWheel, { passive: false });
    });
    syncScroller();
  }

  // ── Keyboard navigation ──────────────────────────────────────
  window.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (e.key === "Escape" && isMenuOpen) { toggleMenu(); return; }
    if (e.key === "Escape" && detailsOpen && currentPage === "home") { closeDetails(); return; }
    if (currentPage === "home") {
      if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); changeSlide("next"); }
      if (e.key === "ArrowUp"   || e.key === "ArrowLeft")  { e.preventDefault(); changeSlide("prev"); }
    }
  });

  window.addEventListener("hashchange", () => { handleHash().catch(console.error); });
  window.addEventListener("popstate",   () => { handleHash().catch(console.error); });
  await handleHash();

  async function handleHash() {
    // Responds to URL state — never pushes new history entries (push = false throughout)
    // /about and /about.html are the same page; /index.html is home
    const path  = window.location.pathname.replace(/^\//, "").replace(/\.html$/, "").replace(/^index$/, "").trim();
    const hash  = (window.location.hash || "").replace(/^#/, "").trim();
    const value = path || hash;

    // Empty path = home (e.g. back button from /about to /)
    if (!value) {
      if (currentPage !== "home") navigateTo("home", "next", false);
      return;
    }

    // Known page names: /about, /process, etc.
    if (pages[value] && value !== "home" && value !== currentPage) {
      if (hasSeenBanner) navigateTo(value, "next", false);
      else pendingAfterBanner = () => navigateTo(value, "next", false);
      return;
    }

    // Unknown path (e.g. a former case-study URL) — fall back to home
    if (!pages[value]) {
      setHash("", false);
      if (currentPage !== "home") navigateTo("home", "next", false);
    }
  }
} // end init()

// First slide's media is ready to show (capped, so a slow video never blocks the site)
function mediaReady(slide) {
  const media = slide && slide.querySelector("img, video:not([data-loop-standby])");
  if (!media) return Promise.resolve();
  const loaded = media.tagName === "IMG"
    ? (media.complete && media.naturalWidth ? Promise.resolve() : new Promise((r) => { media.addEventListener("load", r, { once: true }); media.addEventListener("error", r, { once: true }); }))
    : (media.readyState >= 3 ? Promise.resolve() : new Promise((r) => { media.addEventListener("canplay", r, { once: true }); media.addEventListener("error", r, { once: true }); }));
  return Promise.race([loaded, new Promise((r) => setTimeout(r, 6000))]);
}

let _projectsData = null;

// All projects in one request (projects-data.json, written by build-projects.js)
async function loadEnabledProjects() {
  try {
    const res = await fetch("projects-data.json", { cache: "no-cache" }); // always revalidated: new projects show at once
    if (res.ok) return (_projectsData = await res.json());
  } catch {}
  return [];
}

function getManifest(slot) {
  if (!_projectsData) return null;
  const p = _projectsData.find(p => p.slot === slot);
  return p ? p.manifest : null;
}

/* Home render */
async function renderHomeSlides(pageHome, projects) {
  const loading = pageHome.querySelector(".home-loading");
  if (loading) loading.remove();
  pageHome.querySelectorAll(".slide-section").forEach((el) => el.remove());

  const slidesToRender = [];
  for (const project of projects) {
    const homeBase = `projects/${project.slot}/home/`;
    const manifest = getManifest(project.slot);

    if (manifest) {
      // Manifest vorhanden: kein HEAD-Request nötig
      const toMedia = (m) => ({
        kind: /\.(mp4|webm)$/i.test(m.src) ? "video" : "image",
        src:  `${homeBase}${m.src}`,
        webm: m.webm ? `${homeBase}${m.webm}` : null,
        w: m.w || 0,
        h: m.h || 0,
        sizes: (m.sizes || []).map((v) => ({ w: v.w, src: `${homeBase}${v.src}` })),
      });
      for (const item of (manifest.home || [])) {
        let block;
        if (item.type === "row") {
          block = { type: "row", items: (item.items || []).map(toMedia) };
        } else if (item.type === "single" && item.item) {
          block = { type: "single", item: toMedia(item.item) };
        } else { continue; }
        slidesToRender.push({ title: project.title, slot: project.slot, block });
      }
    }
  }

  if (slidesToRender.length === 0) {
    const section = document.createElement("section");
    section.className = "slide-section active is-portrait";
    section.setAttribute("data-title", "");
    const msg = document.createElement("div");
    msg.className = "type-ui-text";
    msg.style.mixBlendMode = "difference";
    msg.textContent = "No projects enabled yet.";
    section.appendChild(msg);
    pageHome.appendChild(section);
    return [section];
  }

  // ── Sequence builder ─────────────────────────────────────────
  // Goal: never more than 2 consecutive single-poster slides.
  // Approach: separate slides into singles and rows, then build
  // the sequence by placing singles in groups of 1 or 2,
  // separated by a row slide. Guaranteed correct — no post-fix.
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  if (slidesToRender.length > 1) {
    const singles = slidesToRender.filter(s => s.block.type === "single");
    const rows    = slidesToRender.filter(s => s.block.type !== "single");

    shuffle(singles);
    shuffle(rows);

    // Build sequence: consume singles in groups of 1 or 2, place a row between groups
    // When rows run out, remaining singles go in groups of 2 back-to-back
    const merged = [];
    let si = 0, ri = 0;

    while (si < singles.length) {
      // Place 1 or 2 singles (randomly vary to avoid a mechanical pattern)
      const groupSize = (si + 1 < singles.length && Math.random() > 0.4) ? 2 : 1;
      for (let k = 0; k < groupSize && si < singles.length; k++) {
        merged.push(singles[si++]);
      }
      // Separate with a row if available
      if (ri < rows.length) {
        merged.push(rows[ri++]);
      }
    }

    // Append any remaining rows (more rows than single groups)
    while (ri < rows.length) merged.push(rows[ri++]);

    // Ensure no two consecutive slides from the same project
    for (let i = 0; i < merged.length - 1; i++) {
      if (merged[i].slot === merged[i + 1].slot) {
        for (let j = i + 2; j < merged.length; j++) {
          if (merged[j].slot !== merged[i].slot) {
            [merged[i + 1], merged[j]] = [merged[j], merged[i + 1]];
            break;
          }
        }
      }
    }

    slidesToRender.length = 0;
    merged.forEach(s => slidesToRender.push(s));
  }

  slidesToRender.forEach((item, idx) => {
    const section = document.createElement("section");
    section.className = "slide-section" + (idx === 0 ? " active" : "");
    section.setAttribute("data-title", item.title);
    section.setAttribute("data-slot", item.slot);
    const opts = { alt: `${item.title} — brand design by Julian Jakob`, priority: idx === 0 };

    if (item.block.type === "row") {
      section.classList.add("is-row", "is-portrait");
      const wrap = document.createElement("div");
      wrap.className = item.block.items.length >= 3 ? "media-row row-fit row-many" : "media-row row-fit";
      item.block.items.forEach((media) => {
        const itemWrap = document.createElement("div");
        itemWrap.className = "media-item";
        itemWrap.appendChild(createMediaElement(media, opts));
        wrap.appendChild(itemWrap);
      });
      section.appendChild(wrap);
    } else {
      const wrap = document.createElement("div");
      wrap.className = "content-single";
      const media = item.block.item;
      const mediaEl = createMediaElement(media, opts);
      // Videos are always landscape/fullbleed; images use their manifest dimensions.
      // Classifying here means init never waits for a download.
      if (media && media.kind === "video") {
        section.classList.add("is-landscape", "is-full-bleed");
      } else {
        const wide = media && media.w && media.h && media.w >= media.h;
        section.classList.add(...(wide ? ["is-landscape", "is-full-bleed"] : ["is-portrait"]));
      }
      wrap.appendChild(mediaEl);
      section.appendChild(wrap);
    }

    pageHome.appendChild(section);
  });

  return Array.from(pageHome.querySelectorAll(".slide-section"));
}

const IS_SAFARI = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

// Home slide media. Videos start with preload="none" and no autoplay:
// syncSlideMedia() in init() loads and plays them only around the visible slide.
function createMediaElement(media, { alt = "", priority = false } = {}) {
  if (!media) return document.createElement("div");

  if (media.kind === "video") {
    const v = document.createElement("video");
    v.muted       = true;
    v.playsInline = true;
    v.preload     = "none";
    v.setAttribute("playsinline", "");
    v.setAttribute("muted", "");
    v.setAttribute("aria-label", alt);
    // Safari gets the MP4; other browsers the (usually much smaller) WebM when available
    v.src = (!IS_SAFARI && media.webm) ? media.webm : media.src;

    // Safari: natives loop hat Frame-Gap — Double-Buffer für nahtlosen Loop
    if (IS_SAFARI) {
      v.loop = false;
      const slideActive = () => {
        const slide = v.closest(".slide-section");
        const page  = v.closest(".page-container");
        const onScreen = slide && (slide.classList.contains("active") || slide.style.opacity === "1");
        return !!onScreen && !(page && page.classList.contains("hidden"));
      };
      v.addEventListener("loadedmetadata", function setupLoop() {
        v.removeEventListener("loadedmetadata", setupLoop);
        const parent = v.parentNode;
        if (!parent) return;
        const vB = document.createElement("video");
        vB.src = v.src; vB.muted = true; vB.playsInline = true; vB.preload = "none";
        vB.setAttribute("playsinline", ""); vB.setAttribute("muted", ""); vB.setAttribute("aria-hidden", "true");
        vB.dataset.loopStandby = "";
        vB.style.cssText = "position:absolute;inset:0;width:100%;height:100%;opacity:0;pointer-events:none;";
        if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
        parent.appendChild(vB);
        const PREP = 0.4, SWAP = 0.06;
        let vids = [v, vB], inSwap = false, prepped = false;
        function tick() {
          const [curr, next] = vids;
          if (!slideActive()) {
            vids.forEach((vid) => { if (!vid.paused) vid.pause(); });
          } else if (!inSwap && curr.duration && !isNaN(curr.duration) && isFinite(curr.duration)) {
            if (curr.paused && document.visibilityState !== "hidden") curr.play().catch(() => {});
            const rem = curr.duration - curr.currentTime;
            if (rem <= PREP && !prepped && !curr.paused) {
              prepped = true; next.currentTime = 0; next.play().catch(() => {});
            }
            if (rem <= SWAP && !curr.paused) {
              inSwap = true;
              const done = curr;
              curr.style.opacity = "0"; next.style.opacity = "1";
              vids = [next, done];
              setTimeout(() => { done.pause(); done.currentTime = 0; prepped = false; inSwap = false; }, 300);
            }
          }
          requestAnimationFrame(tick);
        }
        [v, vB].forEach(vid => vid.addEventListener("ended", () => { vid.currentTime = 0; if (slideActive()) vid.play().catch(() => {}); }));
        requestAnimationFrame(tick);
      });
    } else {
      v.loop = true;
    }

    return v;
  }

  const img = document.createElement("img");
  img.alt = alt;
  if (media.w && media.h) { img.width = media.w; img.height = media.h; }
  if (media.sizes && media.sizes.length && media.w) {
    // Resized copies: fitImageSources() picks one once the display size is known
    img.dataset.srcset = [...media.sizes, { w: media.w, src: media.src }].map((v) => `${v.src} ${v.w}w`).join(", ");
    img.dataset.src = media.src;
  } else {
    img.src = media.src;
  }
  img.decoding = "async";
  img.draggable = false; // native image drag would cancel the feed's mouse drag
  // Eager on purpose: slides sit at scaleY(0), which defeats native lazy-loading
  img.loading = "eager";
  img.fetchPriority = priority ? "high" : "low";
  return img;
}

// Tell the browser how large each slide image is really displayed, so it loads
// the closest resized copy. Images far larger than shown get shrunk coarsely
// while a slide animates in, which looks pixelated.
function fitImageSources(slides) {
  slides.forEach((slide) => slide.querySelectorAll("img[data-srcset]").forEach((img) => {
    const bw = img.offsetWidth, bh = img.offsetHeight; // layout size — unaffected by the fold transform
    const w = +img.getAttribute("width"), h = +img.getAttribute("height");
    if (!bw || !bh || !w || !h) return;
    const ar = w / h;
    const cover = getComputedStyle(img).objectFit === "cover";
    const shown = cover ? Math.max(bw, bh * ar) : Math.min(bw, bh * ar);
    img.sizes = `${Math.ceil(shown)}px`;
    if (!img.srcset) {
      img.srcset = img.dataset.srcset;
      img.src = img.dataset.src;
    }
  }));
}

// ── Peek hint visibility ─────────────────────────────────────
// Show once per visitor. Resets after 30 days so returning
// visitors after a long absence see it again.
const PEEK_STORAGE_KEY  = "jj_peek_shown";
const PEEK_EXPIRY_DAYS  = 30;

function shouldShowPeek() {
  try {
    const raw = localStorage.getItem(PEEK_STORAGE_KEY);
    if (!raw) return true;
    const ts = parseInt(raw, 10);
    if (isNaN(ts)) return true;
    const ageMs = Date.now() - ts;
    return ageMs > PEEK_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  } catch { return true; }
}

function markPeekShown() {
  try { localStorage.setItem(PEEK_STORAGE_KEY, String(Date.now())); } catch {}
}

function setHash(value, push = false) {
  // Map page names to clean URL paths
  const pathMap = {
    "about":   "/about",
    "process": "/process",
    "pricing": "/pricing",
    "contact": "/contact",
    "legal":   "/legal",
    "cv":      "/cv",
  };
  let next;
  if (!value) {
    next = "/";
  } else if (pathMap[value]) {
    next = pathMap[value];
  } else {
    next = "/" + value;
  }
  const alreadyThere = window.location.pathname === next && !window.location.hash;
  if (!alreadyThere) {
    if (push) history.pushState(null, "", next);
    else      history.replaceState(null, "", next);
  }
}

// ── Text motion ───────────────────────────────────────────────
// How text leaves and arrives is set per text type with CSS variables
// (see "TEXT MOTION" in style.css): --tm-in, --tm-in-step, --tm-out,
// --tm-out-spread, --tm-out-unit. After typing in, the helper spans are removed
// again: plain text is lighter, and Chrome can fail to paint animated spans.
function textMotion(el) {
  const cs = getComputedStyle(el);
  const v = (name, fallback) => (cs.getPropertyValue(name) || "").trim() || fallback;
  const ms = (name, fallback) => parseFloat(v(name, "")) || fallback;
  return {
    in: v("--tm-in", "letters"),
    inStep: ms("--tm-in-step", 22),
    out: v("--tm-out", "letters"),
    outSpread: ms("--tm-out-spread", 140),
    outUnit: ms("--tm-out-unit", 140),
  };
}

function unwrapTypewriter(el) {
  el.querySelectorAll(".typewriter-char").forEach((span) => span.replaceWith(...span.childNodes));
  el.normalize();
}

// Splits the visible text of `el` into letter or word spans; returns the spans.
// `skip(textNode)` can exclude text (e.g. nested translated elements).
function splitText(el, byWord, className, skip) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (!n.textContent.trim() || n.parentElement.offsetParent === null) continue; // hidden (mobile-only…)
    if (skip && skip(n)) continue;
    nodes.push(n);
  }
  const spans = [];
  nodes.forEach((node) => {
    const frag = document.createDocumentFragment();
    (byWord ? node.textContent.split(/(\s+)/) : Array.from(node.textContent)).forEach((part) => {
      if (!part) return;
      if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
      const span = document.createElement("span");
      span.className = className;
      span.textContent = part;
      spans.push(span);
      frag.appendChild(span);
    });
    node.parentNode.replaceChild(frag, node);
  });
  return spans;
}

// Elements still typing in (see finishTyping)
const typingEls = new Set();

// Type text in, letter by letter or word by word (per --tm-in)
function typewriterIn(el, skip) {
  const m = textMotion(el);
  const byWord = m.in === "words" && el.getAttribute("data-typewriter") !== "char";
  const spans = splitText(el, byWord, "typewriter-char", skip);
  spans.forEach((span, i) => { span.style.animationDelay = (i * m.inStep) + "ms"; });
  clearTimeout(el._typewriterDone);
  const total = spans.length * m.inStep + 320;
  typingEls.add(el);
  el._typewriterDone = setTimeout(() => { typingEls.delete(el); unwrapTypewriter(el); }, total);
  return total; // ms until fully typed
}

// Complete all typing at once. Run before text is captured or dissolved again (a new
// language switch mid-typing): half-typed letters would otherwise be captured invisible.
function finishTyping() {
  typingEls.forEach((el) => { clearTimeout(el._typewriterDone); unwrapTypewriter(el); });
  typingEls.clear();
}

// Let a set of elements dissolve (per --tm-out). Each element is handled once: a parent
// covers its children. Returns how long until everything is gone (ms).
function textOut(elements) {
  let longest = 0;
  const done = [];
  elements.forEach((el) => {
    if (done.some((d) => d !== el && d.contains(el))) return;
    const m = textMotion(el);
    // Dissolve letter by letter / word by word in reading order, with a little jitter
    const units = splitText(el, m.out === "words", "text-out-pending");
    const last = Math.max(1, units.length - 1);
    units.forEach((span, k) => {
      span.style.animationDelay = Math.round((k / last) * m.outSpread + Math.random() * 40) + "ms";
      span.className = "text-out";
    });
    longest = Math.max(longest, m.outSpread + 40 + m.outUnit);
    done.push(el);
  });
  return longest;
}

window.textMotion = textMotion;
window.typewriterIn = typewriterIn;
window.finishTyping = finishTyping;
window.textOut = textOut;

// containerOverride: pass a different root (e.g. #menu-overlay) to bypass active-page check
function applyTypewriterEffect(elements, containerOverride) {
  const activePage = containerOverride || document.querySelector(".page-container.visible");
  elements.forEach((el) => {
    if (el.getAttribute("data-typewriter") === "false") return;
    if (activePage && !activePage.contains(el)) return;
    if (el.offsetParent === null) return;
    // Nested translated elements are typed once, via their translated parent
    const parent = el.parentElement && el.parentElement.closest("[data-en][data-de]");
    if (parent && parent !== el && activePage && activePage.contains(parent)) return;
    typewriterIn(el);
  });
}

// ── No words split across columns ─────────────────────────────
// In the two-column paragraphs the browser may hyphenate a word at the bottom
// of column 1 and continue it at the top of column 2 ("prac- / tice"). That reads
// badly, and Chrome fails to animate/paint such split words. Any word that jumps
// columns is kept whole (it moves to the next column); hyphenation within a
// column stays. Re-run after language switches, font loading and resizing.
function fixColumnBreaks(root = document) {
  root.querySelectorAll("p.type-contact-item").forEach((p) => {
    // Undo a previous pass — layout (width, language) may have changed
    p.querySelectorAll(".no-col-split").forEach((span) => span.replaceWith(...span.childNodes));
    p.normalize();
    if (!p.offsetParent || (parseInt(getComputedStyle(p).columnCount, 10) || 1) < 2) return;

    for (let pass = 0; pass < 12; pass++) { // keeping one word whole shifts the balance; repeat until it settles
      const word = findColumnSplitWord(p);
      if (!word) break;
      const span = document.createElement("span");
      span.className = "no-col-split";
      word.range.surroundContents(span);
    }
  });
}

function findColumnSplitWord(p) {
  const cs = getComputedStyle(p);
  const n = parseInt(cs.columnCount, 10) || 1;
  const box = p.getBoundingClientRect();
  const colStep = (box.width + (parseFloat(cs.columnGap) || 0)) / n; // column width + gap
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement.offsetParent === null || node.parentElement.closest(".no-col-split")) continue; // hidden (mobile-only) text
    for (const m of node.textContent.matchAll(/\S+/g)) {
      const range = document.createRange();
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      // Which column is each piece of the word in? (horizontal position only, so this
      // also works while a page is still folded flat by its scaleY transition)
      const cols = new Set(rects.map((r) => Math.floor((r.left - box.left) / colStep)));
      if (cols.size > 1) return { range };
    }
  }
  return null;
}
window.fixColumnBreaks = fixColumnBreaks;
// Text re-flows when the webfont arrives or the page finishes loading
if (document.fonts) {
  document.fonts.ready.then(() => fixColumnBreaks());
  document.fonts.addEventListener("loadingdone", () => fixColumnBreaks());
}
window.addEventListener("load", () => fixColumnBreaks());
// Re-run when a paragraph's size actually changes (fires after the new layout, unlike
// the window's resize event); widths only, so our own fixes don't re-trigger it
let _colResize = 0;
const _colWidths = new WeakMap();
const _colObserver = window.ResizeObserver && new ResizeObserver((entries) => {
  const changed = entries.some((e) => {
    const w = Math.round(e.contentRect.width), before = _colWidths.get(e.target);
    _colWidths.set(e.target, w);
    return before !== undefined && before !== w;
  });
  if (changed) { clearTimeout(_colResize); _colResize = setTimeout(() => requestAnimationFrame(() => fixColumnBreaks()), 120); }
});
if (_colObserver) document.addEventListener("DOMContentLoaded", () => document.querySelectorAll("p.type-contact-item").forEach((p) => _colObserver.observe(p)));

// ── Copy to clipboard (CV buttons, contact rows, footer links) ───────────────
(function () {
  // "Copied" swaps in like all other text: the old text dissolves, the new one types in
  function swap(el, content, isHTML, done) {
    setTimeout(function () {
      if (isHTML) { el.innerHTML = content; } else { el.textContent = content; }
      var typing = window.typewriterIn(el);
      if (done) setTimeout(done, typing);
    }, window.textOut([el]));
  }

  function wire(trigger, label) {
    var busy = false;
    // <a> without href isn't focusable — make copy triggers keyboard-accessible
    if (trigger.tagName !== "BUTTON") {
      trigger.setAttribute("role", "button");
      trigger.setAttribute("tabindex", "0");
      trigger.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); trigger.click(); }
      });
    }
    if (!trigger.hasAttribute("aria-label")) {
      trigger.setAttribute("aria-label", "Copy " + trigger.getAttribute("data-copy"));
    }
    trigger.addEventListener("click", function (e) {
      e.preventDefault();
      if (busy) return;
      busy = true;
      var text    = trigger.getAttribute("data-copy");
      var original = label.innerHTML;
      function show() {
        var copied = (window.getCurrentLang && window.getCurrentLang() === "de") ? "Kopiert" : "Copied";
        swap(label, copied, false, function () {
          setTimeout(function () {
            swap(label, original, true, function () { busy = false; });
          }, 1200);
        });
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(show).catch(show);
      } else {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;top:-999px;left:-999px";
        document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); } catch (e) {}
        document.body.removeChild(ta);
        show();
      }
    });
  }

  function initCopy() {
    document.querySelectorAll(".cv-copy-btn").forEach(function (btn) {
      wire(btn, btn);
    });
    document.querySelectorAll(".copy-row[data-copy]").forEach(function (row) {
      wire(row, row.querySelector(".type-contact-item") || row);
    });
    document.querySelectorAll(".copy-link[data-copy]").forEach(function (link) {
      wire(link, link);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCopy);
  } else {
    initCopy();
  }
})();
