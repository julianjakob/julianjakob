document.addEventListener("DOMContentLoaded", () => {
  init().catch((e) => console.error("Init error:", e));
});

async function init() {
  const pageHome = document.getElementById("page-home");
  if (!pageHome) return;

  const pageCase = document.getElementById("page-case");
  const pageContact = document.getElementById("page-contact");
  const pageAbout = document.getElementById("page-about");
  const pageProcess = document.getElementById("page-process");
  const pagePricing = document.getElementById("page-pricing");
  const pageLegal = document.getElementById("page-legal");

  const banner = document.getElementById("intro-banner");
  const footerTitle = document.getElementById("footer-title");
  const footerLink = document.getElementById("footer-link");
  const menuBtn = document.getElementById("menu-btn");
  const menuOverlay = document.getElementById("menu-overlay");

  const caseTitleEl = document.getElementById("case-title");
  const caseContentEl = document.getElementById("case-content");
  const caseFooterLeft = document.getElementById("case-footer-left");

  const pages = {
    home: pageHome,
    case: pageCase,
    contact: pageContact,
    about: pageAbout,
    process: pageProcess,
    pricing: pagePricing,
    legal: pageLegal,
  };
  const pageOrder = ["about", "process"];

  let currentPage = "home",
    currentIndex = 0,
    currentCaseSlot = null,
    isAnimating = false, // managed by tLock — do not set directly
    hasSeenBanner = false,
    isMenuOpen = false,
    menuTimeout = null,
    menuTextTimer = null,
    touchStartX = 0,
    touchStartY = 0,
    lastWheelTime = 0,
    pendingAfterBanner = null,
    queuedSlideDir = null;

  const projects = await loadEnabledProjects();
  const homeSlides = await renderHomeSlides(pageHome, projects);

  
  await applySlideOrientationClasses(homeSlides);
  if (homeSlides.length > 0) updateFooter(homeSlides[0]);

  if (banner && homeSlides.length > 0) {
    homeSlides[0].classList.remove("active");
    setTimeout(() => {
      banner.classList.add("hidden");

      if (pendingAfterBanner) {
        hasSeenBanner = true;
        pendingAfterBanner();
        pendingAfterBanner = null;
      } else {
        homeSlides[0].style.transformOrigin = "bottom center";
        homeSlides[0].classList.add("active");
      }

      setTimeout(() => {
        banner.style.display = "none";
        hasSeenBanner = true;
        // Schedule peek only for first-time visitors
        if (shouldShowPeek()) {
          markPeekShown();
          let peekTimer = null;
          const removePeekListeners = () => {
            window.removeEventListener("wheel",      cancelEarly);
            window.removeEventListener("touchstart", cancelEarly);
            window.removeEventListener("keydown",    cancelEarly);
          };
          const cancelEarly = () => { clearTimeout(peekTimer); removePeekListeners(); };
          window.addEventListener("wheel",      cancelEarly, { once: true, passive: true });
          window.addEventListener("touchstart", cancelEarly, { once: true, passive: true });
          window.addEventListener("keydown",    cancelEarly, { once: true });
          peekTimer = setTimeout(() => {
            removePeekListeners();
            runPeekHint();
          }, 800);
        }
      }, 1000);
    }, 2000);
  } else hasSeenBanner = true;

  // Track the menu's own animation timer separately so it can be cancelled on re-click
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

  // ── Menu-Button Textanimation ────────────────────────────────
  // Breite und Opacity werden gleichzeitig animiert —
  // kein Layout-Snap, kein hartes Umschalten.
  function animateMenuText(text) {
    if (!menuBtn) return;
    if (menuTextTimer) { clearTimeout(menuTextTimer); menuTextTimer = null; }
    menuBtn.classList.remove("fade-out");

    // Zielbreite mit unsichtbarem Klon messen
    const probe = menuBtn.cloneNode(false);
    Object.assign(probe.style, {
      position: "absolute", visibility: "hidden",
      width: "auto", minWidth: "0", whiteSpace: "nowrap", pointerEvents: "none"
    });
    probe.textContent = text;
    document.body.appendChild(probe);
    const newW = probe.getBoundingClientRect().width;
    document.body.removeChild(probe);

    const curW = menuBtn.getBoundingClientRect().width;

    // Fade-out + Breite gleichzeitig: entschlossene Kurve
    menuBtn.style.transition = "opacity 0.28s cubic-bezier(0.32, 0, 0.67, 0), width 0.32s cubic-bezier(0.32, 0, 0.67, 0)";
    menuBtn.style.width      = curW + "px";
    menuBtn.style.opacity    = "0";
    requestAnimationFrame(() => requestAnimationFrame(() => {
      menuBtn.style.width = newW + "px";
    }));

    // Text tauschen + Fade-in: sanfte Ankunft
    menuTextTimer = setTimeout(() => {
      menuBtn.innerText        = text;
      menuBtn.style.transition = "opacity 0.32s cubic-bezier(0.33, 1, 0.68, 1)";
      menuBtn.style.opacity    = "1";
      menuTextTimer = setTimeout(() => {
        menuBtn.style.transition = "";
        menuBtn.style.opacity    = "";
        menuBtn.style.width      = "";
        menuTextTimer = null;
      }, 340);
    }, 300);
  }

  function fadeMenuText(text) {
    animateMenuText(text);
  }

  function toggleMenu(skipFadeToMenu = false) {
    isMenuOpen = !isMenuOpen;
    const activePage = pages[currentPage];
    if (isMenuOpen) {
      menuOverlay.classList.add("open");
      if (menuTimeout) clearTimeout(menuTimeout);
      fadeMenuText((window.getCurrentLang && window.getCurrentLang() === "de") ? "Schließen" : "Close");
      if (menuBtn) menuBtn.setAttribute("aria-expanded", "true");
      if (window.setLangToggleVisible) window.setLangToggleVisible("menu");
      // Menu offen → Header immer sichtbar
      showHeader();
      // Menu-Overlay ist schwarz → weißer Text
      setUIColor('#ffffff');
      if (activePage) {
        activePage.style.transformOrigin = "bottom center";
        activePage.classList.remove("visible");
        activePage.classList.add("hidden");
      }
    } else {
      menuOverlay.classList.remove("open");
      // Only fade to "Menu" if we're not about to flash a page name
      if (!skipFadeToMenu) {
        fadeMenuText((window.getCurrentLang && window.getCurrentLang() === "de") ? "Menü" : "Menu");
      }
      if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
      if (window.setLangToggleVisible) window.setLangToggleVisible(currentPage);
      // Farbe für aktuelle Seite wiederherstellen
      updateUIColorForPage(currentPage);
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
      }
    }
    tLock.bump(900); // --page-speed 850ms + 50ms buffer
  }

  function flashMenuText(pageName) {
    if (menuTimeout) clearTimeout(menuTimeout);
    const lang = (window.getCurrentLang && window.getCurrentLang()) || "en";
    const navLink = document.querySelector(`.nav-link[data-dest="${pageName}"]`);
    const display = navLink
      ? (navLink.getAttribute(`data-${lang}`) || navLink.getAttribute("data-en") || pageName)
      : pageName.charAt(0).toUpperCase() + pageName.slice(1);

    animateMenuText(display);

    // Nach 2000ms sichtbarer Zeit wieder zu "Menu" zurück
    menuTimeout = setTimeout(() => {
      if (!isMenuOpen) {
        animateMenuText((window.getCurrentLang && window.getCurrentLang() === "de") ? "Menü" : "Menu");
      }
    }, 2300); // 300ms (fade-out) + 2000ms sichtbar
  }

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const dest = link.getAttribute("data-dest");
      if (dest === currentPage) {
        if (isMenuOpen) toggleMenu();
        return;
      }
      if (dest !== "case") setHash("");
      navigateTo(dest, "next");
    });
  });

  const handleFooterClick = async (e) => {
    const href = footerLink ? footerLink.getAttribute("href") || "" : "";
    if (!href.startsWith("#case=")) return;
    e.preventDefault();
    const slot = href.split("=").pop();
    if (!slot) return;
    await openCase(slot);
  };
  if (footerLink) footerLink.addEventListener("click", handleFooterClick);
  if (footerTitle) footerTitle.addEventListener("click", handleFooterClick);

  function updateMenuLinks(dest) {
    document.querySelectorAll("#menu-overlay .nav-link").forEach((item) => {
      item.classList.remove("active-page");
      if (item.getAttribute("data-dest") === dest) item.classList.add("active-page");
    });
  }

  // ── Page title + OG meta updater ──────────────────────────────
  window.updatePageTitle = function(page, slot) { updatePageTitle(page, slot); };
  function updatePageTitle(page, slot) {
    const lang = (window.getCurrentLang && window.getCurrentLang()) || "en";
    const titlesEn = {
      home:    "Julian Jakob — Global Brand Designer",
      about:   "About — Julian Jakob",
      process: "Process — Julian Jakob",
      pricing: "Services — Julian Jakob",
      contact: "Contact — Julian Jakob",
      legal:   "Legal — Julian Jakob",
    };
    const titlesDe = {
      home:    "Julian Jakob — Global Brand Designer",
      about:   "Über mich — Julian Jakob",
      process: "Prozess — Julian Jakob",
      pricing: "Leistungen — Julian Jakob",
      contact: "Kontakt — Julian Jakob",
      legal:   "Impressum — Julian Jakob",
    };
    const map = lang === "de" ? titlesDe : titlesEn;
    let title = map[page] || titlesEn.home;

    if (page === "case" && caseTitleEl) {
      const caseTitle = caseTitleEl.textContent.trim();
      if (caseTitle) title = `${caseTitle} — Julian Jakob`;
    }

    document.title = title;

    const setMeta = (sel, attr, val) => {
      const el = document.querySelector(sel);
      if (el) el.setAttribute(attr, val);
    };
    setMeta('meta[property="og:title"]',    "content", title);
    setMeta('meta[name="twitter:title"]',   "content", title);
    const canonicalBase = "https://julianjakob.at";
    const pathMap = { about: "/about", process: "/process", pricing: "/pricing", contact: "/contact", legal: "/legal" };
    const ogUrl = page === "case" && slot
      ? `${canonicalBase}/#case=${slot}`
      : `${canonicalBase}${pathMap[page] || "/"}`;
    setMeta('meta[property="og:url"]', "content", ogUrl);
  }

  function navigateTo(dest, direction = "next") {
    if (!pages[dest] || isAnimating) return;
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
      toggleMenu(dest !== "home"); // skip "Menu" label when navigating to a page
      // Flash page name after menu closes — no need to wait for "Menu" anymore
      if (dest !== "home") setTimeout(() => flashMenuText(dest), 900); // nach Menu-Animation (850ms)
      return;
    }

    if (oldPage) {
      const oldOrigin = dest === "home" ? "bottom center"
                      : direction === "next" ? "top center" : "bottom center";
      oldPage.style.transformOrigin = oldOrigin;
      oldPage.classList.remove("visible");
      oldPage.classList.add("hidden");
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
    }

    if (dest !== "home") flashMenuText(dest);
    if (dest !== "home" && dest !== "case") setHash(dest);
    if (dest === "home") setHash("");
    updateMenuLinks(dest);
    currentPage = dest;
    updatePageTitle(dest, dest === "case" ? currentCaseSlot : null);
    if (window.setLangToggleVisible) window.setLangToggleVisible(dest);
    tLock.acquire(900); // --page-speed 850ms + 50ms buffer
    // Textfarbe für neue Seite setzen
    updateUIColorForPage(dest);
    // Header wieder einblenden + Scroll-Tracking zurücksetzen
    showHeader();
    resetScrollHeader();
  }

  // ── Header bei Scroll verstecken / zeigen ────────────────────
  const mainHeader = document.getElementById("main-header");

  function showHeader() {
    mainHeader?.classList.remove("header--hidden");
  }
  function hideHeader() {
    mainHeader?.classList.add("header--hidden");
  }

  // ── Gecachte Werte für den Scroll-Handler ───────────────────────
  // offsetHeight erzwingt Layout-Reflow — nie im Scroll-Event messen.
  // Einmal beim Laden / Seiten-Wechsel berechnen, bei Resize invalidieren.
  let _headerH    = 0;
  let _caseDims   = null;   // { imgH, caseTopH }
  let _caseHeroColor = null; // "#000000" | "#ffffff"

  function refreshHeaderH() {
    _headerH = mainHeader ? mainHeader.offsetHeight : 60;
  }
  function invalidateCaseCache() {
    _caseDims = null;
    _caseHeroColor = null;
  }
  function refreshCaseDims() {
    const caseTop  = document.querySelector("#page-case .case-top");
    const caseHero = document.querySelector("#page-case .case-hero");
    _caseDims = {
      imgH:     caseHero ? caseHero.offsetHeight : 0,
      caseTopH: caseTop  ? caseTop.offsetHeight  : 0,
    };
  }

  // Bei Resize alles neu messen
  window.addEventListener("resize", () => {
    refreshHeaderH();
    invalidateCaseCache();
  }, { passive: true });
  refreshHeaderH();

  function initScrollHeader() {
    let lastY = 0;
    const THRESHOLD = 8;
    const TOP_ZONE  = 80;

    function onScroll() {
      if (currentPage === "home" || isMenuOpen) return;
      const y = this.scrollTop;

      if (currentPage === "case") {
        if (!_caseDims) refreshCaseDims();
        const { imgH, caseTopH } = _caseDims;

        if (caseTopH > 0) {
          const imgExitPoint = imgH - _headerH;

          if (y <= caseTopH) {
            showHeader();
            // Farbe nur setzen wenn sich die Zone geändert hat
            if (y < imgExitPoint) {
              if (_caseHeroColor) setUIColor(_caseHeroColor);
            } else {
              setUIColor("#000000");
            }
            lastY = y;
            return;
          }
          setUIColor("#000000");
        }
      }

      if (y < TOP_ZONE) {
        showHeader();
      } else if (y > lastY + THRESHOLD) {
        hideHeader();
      } else if (y < lastY - THRESHOLD) {
        showHeader();
      }
      lastY = y;
    }

    document.querySelectorAll(".contact-container, .case-container").forEach(el => {
      el.addEventListener("scroll", onScroll, { passive: true });
    });

    return function reset() { lastY = 0; };
  }

  const resetScrollHeader = initScrollHeader();

  // Farbe des Case-Heroes messen und cachen — nur einmal pro Case-Load
  function updateUiColorForCaseHero() {
    if (_caseHeroColor) { setUIColor(_caseHeroColor); return; }

    const heroImg = document.querySelector("#page-case .case-hero img");
    if (!heroImg || !heroImg.complete || !heroImg.naturalWidth) {
      setUIColor("#ffffff");
      if (heroImg) {
        heroImg.addEventListener("load", updateUiColorForCaseHero, { once: true });
      }
      return;
    }
    try {
      const w = heroImg.naturalWidth, h = heroImg.naturalHeight;
      const p = Math.max(30, Math.min(80, Math.floor(Math.min(w, h) * 0.08)));
      const canvas = document.createElement("canvas");
      canvas.width = p * 2; canvas.height = p * 2;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(heroImg,   0,   0, p, p,  0, 0, p, p);
      ctx.drawImage(heroImg, w-p,   0, p, p,  p, 0, p, p);
      ctx.drawImage(heroImg,   0, h-p, p, p,  0, p, p, p);
      ctx.drawImage(heroImg, w-p, h-p, p, p,  p, p, p, p);
      const data = ctx.getImageData(0, 0, p*2, p*2).data;
      let lum = 0;
      for (let i = 0; i < data.length; i += 4) {
        lum += (0.2126 * data[i] + 0.7152 * data[i+1] + 0.0722 * data[i+2]) / 255;
      }
      _caseHeroColor = (lum / (data.length / 4)) > 0.5 ? "#000000" : "#ffffff";
      setUIColor(_caseHeroColor);
    } catch (e) {
      setUIColor("#ffffff");
    }
  }

  initServicesAccordion();
  function initServicesAccordion() {
    const OPEN_CURVE  = "cubic-bezier(0.76, 0, 0.24, 1)";
    const CLOSE_CURVE = "cubic-bezier(0.76, 0, 0.24, 1)";
    const DURATION    = 480; // ms

    document.querySelectorAll(".service-row").forEach((row) => {
      const body   = row.querySelector(".service-body");
      const toggle = row.querySelector(".service-toggle");
      if (!body) return;

      let runningAnim = null;

      row.addEventListener("click", () => {
        const isExpanded = row.classList.contains("expanded");

        // Aktuelle Höhe ermitteln — auch mitten in einer laufenden Animation
        const fromHeight = body.getBoundingClientRect().height;

        if (runningAnim) { runningAnim.cancel(); runningAnim = null; }

        if (isExpanded) {
          // ── Schließen ──────────────────────────────────────────
          row.classList.remove("expanded");
          if (toggle) toggle.textContent = "+";

          body.style.overflow      = "hidden";
          body.style.maxHeight     = fromHeight + "px";
          body.style.paddingTop    = "20px";
          body.style.paddingBottom = "20px";
          body.style.opacity       = "1";

          runningAnim = body.animate(
            [
              { maxHeight: fromHeight + "px", paddingTop: "20px", paddingBottom: "20px", opacity: "1" },
              { maxHeight: "0px",             paddingTop: "0px",  paddingBottom: "0px",  opacity: "0" }
            ],
            { duration: DURATION, easing: CLOSE_CURVE, fill: "forwards" }
          );

          runningAnim.onfinish = () => {
            const anim = runningAnim;
            runningAnim = null;
            anim.cancel();          // fill: forwards entfernen, CSS übernimmt
            body.style.cssText = "";
          };

        } else {
          // ── Öffnen ────────────────────────────────────────────
          row.classList.add("expanded");
          if (toggle) toggle.textContent = "−";

          // Zielhöhe messen während CSS expanded aktiv ist
          body.style.maxHeight     = "none";
          body.style.paddingTop    = "20px";
          body.style.paddingBottom = "20px";
          const toHeight = body.scrollHeight;

          // Auf Startzustand zurücksetzen für die Animation
          body.style.overflow      = "hidden";
          body.style.maxHeight     = fromHeight + "px";
          body.style.paddingTop    = fromHeight > 0 ? "20px" : "0px";
          body.style.paddingBottom = fromHeight > 0 ? "20px" : "0px";
          body.style.opacity       = fromHeight > 0 ? "1"    : "0";

          runningAnim = body.animate(
            [
              {
                maxHeight:     fromHeight + "px",
                paddingTop:    fromHeight > 0 ? "20px" : "0px",
                paddingBottom: fromHeight > 0 ? "20px" : "0px",
                opacity:       fromHeight > 0 ? "1"    : "0"
              },
              {
                maxHeight:     toHeight + "px",
                paddingTop:    "20px",
                paddingBottom: "20px",
                opacity:       "1"
              }
            ],
            { duration: DURATION, easing: OPEN_CURVE, fill: "forwards" }
          );

          runningAnim.onfinish = () => {
            const anim = runningAnim;
            runningAnim = null;
            anim.cancel();          // fill: forwards entfernen, CSS übernimmt
            body.style.cssText = "";
          };
        }
      });
    });
  }

  // Abort token for runPeekHint — lets changeSlide cancel it instantly
  let peekController = null;

  function abortPeek() {
    if (!peekController) return;
    peekController.cancelled = true;
    peekController = null;
    // Brute-force wipe all inline styles on every slide — safe because
    // changeSlide immediately sets the inline transformOrigin it needs.
    homeSlides.forEach(s => { s.style.cssText = ""; });
    tLock.release();
  }

  /* ─────────────────────────────────────────────
     Image Peek Hint — fully interruptible
     Active slide never touched — peek only.
     Pull-back is slower than push-in so it feels
     reluctant to leave, not mechanical.
  ───────────────────────────────────────────── */
  async function runPeekHint() {
    if (homeSlides.length <= 1) return;

    const PEEK_SCALE = 0.07;
    const CURVE_IN   = "cubic-bezier(0.80, 0, 0.20, 1)";
    const CURVE_OUT  = "cubic-bezier(0.80, 0, 0.20, 1)";
    const SPEED_IN   = 520;
    const SPEED_OUT  = 480;
    const HOLD       = 380;
    const GAP        = 340;

    const ctrl = { cancelled: false };
    peekController = ctrl;
    // total: (480+180+680) + 300 + (40+480+180+680) = ~3020ms
    tLock.acquire(2600);

    const nextIdx  = (currentIndex + 1) % homeSlides.length;
    const prevIdx  = (currentIndex - 1 + homeSlides.length) % homeSlides.length;
    const nextSlide = homeSlides[nextIdx];
    const prevSlide = homeSlides[prevIdx];

    const wait = (ms) => new Promise((r) => {
      const t = setTimeout(r, ms);
      const check = () => { if (ctrl.cancelled) { clearTimeout(t); r(); } else requestAnimationFrame(check); };
      requestAnimationFrame(check);
    });

    function prepPeekSlide(slide, origin) {
      slide.style.transition      = "none";
      slide.style.transform       = "scaleY(0)";
      slide.style.transformOrigin = origin;
      slide.style.opacity         = "1";
      slide.style.zIndex          = "15"; // above active (z:10) — edge must be visible
    }

    const activeSlide = homeSlides[currentIndex];

    async function peekIn(slide, origin, activeOrigin) {
      if (ctrl.cancelled) return;
      slide.style.transformOrigin       = origin;
      slide.style.transition            = `transform ${SPEED_IN}ms ${CURVE_IN}`;
      slide.style.transform             = `scaleY(${PEEK_SCALE})`;
      activeSlide.style.transformOrigin = activeOrigin;
      activeSlide.style.transition      = `transform ${SPEED_IN}ms ${CURVE_IN}`;
      activeSlide.style.transform       = "scaleY(0.93)";
      await wait(SPEED_IN);
    }

    async function peekOut(slide, origin, activeOrigin) {
      if (ctrl.cancelled) return;
      slide.style.transformOrigin       = origin;
      slide.style.transition            = `transform ${SPEED_OUT}ms ${CURVE_OUT}`;
      slide.style.transform             = "scaleY(0)";
      activeSlide.style.transformOrigin = activeOrigin;
      activeSlide.style.transition      = `transform ${SPEED_OUT}ms ${CURVE_OUT}`;
      activeSlide.style.transform       = "scaleY(1)";
      await wait(SPEED_OUT);
    }

    function resetPeek(slide) {
      slide.style.cssText       = "";
      activeSlide.style.cssText = "";
    }

    // ── Peek next (from below) ──
    prepPeekSlide(nextSlide, "bottom center");
    await wait(40);
    await peekIn(nextSlide, "bottom center", "top center");
    await wait(HOLD);
    await peekOut(nextSlide, "bottom center", "top center");
    if (ctrl.cancelled) return;
    resetPeek(nextSlide);

    await wait(GAP);
    if (ctrl.cancelled) return;

    // ── Peek prev (from above) ──
    prepPeekSlide(prevSlide, "top center");
    await wait(40);
    await peekIn(prevSlide, "top center", "bottom center");
    await wait(HOLD);
    await peekOut(prevSlide, "top center", "bottom center");
    if (ctrl.cancelled) return;
    resetPeek(prevSlide);

    peekController = null;
    tLock.release();
  }

  function changeSlide(direction) {
    abortPeek();
    if (currentPage !== "home" || (!hasSeenBanner && banner) || isMenuOpen || homeSlides.length <= 1) return;

    if (isAnimating) {
      // Queue: nächste Richtung merken, wird am Ende der Animation ausgeführt
      queuedSlideDir = direction;
      return;
    }
    queuedSlideDir = null;

    const prevIndex = currentIndex;
    // currentIndex sofort updaten — rapid swipes berechnen so immer korrekt
    if (direction === "next") {
      currentIndex = (currentIndex + 1) % homeSlides.length;
    } else {
      currentIndex = (currentIndex - 1 + homeSlides.length) % homeSlides.length;
    }

    tLock.acquire(700); // exakt --anim-speed, Cleanup und Lock released gleichzeitig
    const currentSlide = homeSlides[prevIndex];
    const nextSlide    = homeSlides[currentIndex];

    if (direction === "next") {
      currentSlide.style.transformOrigin = "top center";
      currentSlide.classList.add("exit");
      currentSlide.classList.remove("active");
      nextSlide.style.transformOrigin = "bottom center";
      nextSlide.classList.add("active");
    } else {
      currentSlide.style.transformOrigin = "bottom center";
      currentSlide.classList.remove("active");
      nextSlide.style.transformOrigin = "top center";
      nextSlide.classList.remove("exit");
      nextSlide.classList.add("active");
    }

    updateFooter(nextSlide);
    setTimeout(() => {
      currentSlide.classList.remove("exit");
      // Wenn der User während der Animation geswiped hat → sofort ausführen
      if (queuedSlideDir) {
        const dir = queuedSlideDir;
        queuedSlideDir = null;
        requestAnimationFrame(() => changeSlide(dir));
      }
    }, 700); // exakt am Animationsende (--anim-speed: 0.7s)
  }

  function updateFooter(slide) {
    if (!footerTitle || !footerLink || !slide) return;
    const title = slide.getAttribute("data-title") || "",
      link = slide.getAttribute("data-link") || "#",
      hasCase = slide.getAttribute("data-has-case") !== "0";
    footerTitle.classList.remove("text-anim");
    footerLink.classList.remove("text-anim");
    void footerTitle.offsetWidth;
    footerTitle.innerText = title;
    footerLink.setAttribute("href", link);
    footerTitle.classList.add("text-anim");
    // Show "Learn more" only if this project has case content
    const learnMore = footerLink.closest(".learn-more") || footerLink;
    learnMore.style.visibility = hasCase ? "visible" : "hidden";
    if (hasCase) footerLink.classList.add("text-anim");
    // Title is only interactive when a case page exists
    footerTitle.style.cursor        = hasCase ? "pointer" : "default";
    footerTitle.style.pointerEvents = hasCase ? "auto"    : "none";
    // Textfarbe dynamisch setzen basierend auf Slide-Helligkeit
    updateUIColorForSlide(slide);
  }

  // ── UI Color System ─────────────────────────────────────────────
  // Steuert --ui-color (Header + Home-Footer) für alle Browser.
  // Aufgerufen bei: Slide-Wechsel, Seiten-Wechsel, Menu öffnen/schließen.

  function setUIColor(color) {
    // Direkt per inline style — umgeht alle CSS-Spezifität-Konflikte
    document.querySelectorAll(
      'header .type-ui-text, #project-footer .type-ui-text'
    ).forEach(el => { el.style.color = color; });
  }

  function getSlideTheme(slide) {
    // Portrait- und Row-Slides haben immer weißen Hintergrund
    if (slide.classList.contains('is-portrait') || slide.classList.contains('is-row')) {
      return 'light';
    }

    // Vollbild-Slides: die 4 Ecken des Bildes samplen.
    // Genau dort wo Header (oben) und Footer (unten) sitzen.
    const img = slide.querySelector('img');
    if (img && img.complete && img.naturalWidth > 0) {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        // Patch-Größe: ca. 8% der kleinsten Bildseite, min 30px max 80px
        const p = Math.max(30, Math.min(80, Math.floor(Math.min(w, h) * 0.08)));

        const canvas = document.createElement('canvas');
        canvas.width  = p * 2;
        canvas.height = p * 2;
        const ctx = canvas.getContext('2d');

        // Oben-links, oben-rechts, unten-links, unten-rechts
        ctx.drawImage(img,   0,     0,     p, p,  0, 0, p, p);
        ctx.drawImage(img, w-p,     0,     p, p,  p, 0, p, p);
        ctx.drawImage(img,   0,   h-p,     p, p,  0, p, p, p);
        ctx.drawImage(img, w-p,   h-p,     p, p,  p, p, p, p);

        const data = ctx.getImageData(0, 0, p * 2, p * 2).data;
        let lum = 0;
        for (let i = 0; i < data.length; i += 4) {
          lum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
        }
        return (lum / (data.length / 4)) > 0.5 ? 'light' : 'dark';
      } catch (e) {
        // CORS oder anderer Fehler — sicherer Fallback
      }
    }

    // Video oder Bild noch nicht geladen: Vollbild = dunkel (sicherer Default)
    return 'dark';
  }

  function updateUIColorForSlide(slide) {
    if (!slide) return;
    const theme = getSlideTheme(slide);
    setUIColor(theme === 'light' ? '#000000' : '#ffffff');

    // Falls Bild noch lädt: nochmals prüfen sobald es fertig ist
    if (theme === 'dark') {
      const img = slide.querySelector('img');
      if (img && !img.complete) {
        img.addEventListener('load', () => {
          // Nur updaten wenn dieser Slide noch aktiv ist
          if (homeSlides[currentIndex] === slide) {
            setUIColor(getSlideTheme(slide) === 'light' ? '#000000' : '#ffffff');
          }
        }, { once: true });
      }
    }
  }

  function updateUIColorForPage(page) {
    if (page === 'home') {
      updateUIColorForSlide(homeSlides[currentIndex]);
    } else if (page === 'case') {
      // Case-Seite: Hero-Farbe messen (Scroll ist 0 beim Navigieren)
      updateUiColorForCaseHero();
    } else {
      // Alle anderen Seiten haben weißen Hintergrund
      setUIColor('#000000');
    }
  }

  window.addEventListener("touchstart", (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  window.addEventListener("touchend", (e) => {
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const diffX = Math.abs(touchStartX - touchEndX);
    const diffY = touchStartY - touchEndY;

    if (isMenuOpen) {
      if (Math.abs(diffY) > 50) toggleMenu();
      return;
    }

    if (currentPage === "home") {
      if (diffX > Math.abs(diffY)) return;
      if (Math.abs(diffY) > 50) {
        if (diffY > 0) changeSlide("next");
        else changeSlide("prev");
      }
    }
  });

  // ── Mouse drag (desktop click-and-drag) ──────────────────────
  let mouseDragStartY = null;
  let mouseDragging   = false;

  window.addEventListener("mousedown", (e) => {
    if (currentPage !== "home" || isMenuOpen) return;
    if (e.button !== 0) return;
    e.preventDefault(); // Verhindert Text/Bild-Selektion beim Drag
    mouseDragStartY = e.clientY;
    mouseDragging   = false;
  });

  window.addEventListener("mousemove", (e) => {
    if (mouseDragStartY === null) return;
    if (Math.abs(e.clientY - mouseDragStartY) > 4) {
      mouseDragging = true;
      document.body.style.userSelect = "none";
    }
  });

  window.addEventListener("mouseup", (e) => {
    document.body.style.userSelect = "";
    if (mouseDragStartY === null) return;
    const diffY = mouseDragStartY - e.clientY;
    mouseDragStartY = null;

    if (!mouseDragging) return;
    mouseDragging = false;

    if (currentPage !== "home" || isMenuOpen) return;
    if (Math.abs(diffY) > 20) {
      if (diffY > 0) changeSlide("next");
      else changeSlide("prev");
    }
  });

  // Cancel drag if mouse leaves window
  window.addEventListener("mouseleave", () => {
    document.body.style.userSelect = "";
    mouseDragStartY = null;
    mouseDragging   = false;
  });

  window.addEventListener("wheel", (e) => {
    const now = Date.now();
    if (now - lastWheelTime < 600) return;
    if (isMenuOpen) {
      if (Math.abs(e.deltaY) > 50) {
        lastWheelTime = now;
        toggleMenu();
      }
      return;
    }
    if (currentPage === "home") {
      if (Math.abs(e.deltaY) > 20) {
        lastWheelTime = now;
        if (e.deltaY > 0) changeSlide("next");
        else changeSlide("prev");
      }
    }
  });

  // ── Keyboard navigation ──────────────────────────────────────
  window.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (e.key === "Escape" && isMenuOpen) { toggleMenu(); return; }
    if (currentPage === "home") {
      if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); changeSlide("next"); }
      if (e.key === "ArrowUp"   || e.key === "ArrowLeft")  { e.preventDefault(); changeSlide("prev"); }
    }
  });

  window.addEventListener("hashchange", () => { handleHash().catch(console.error); });
  await handleHash();

  async function handleHash() {
    // Support both legacy hash (#about) and clean path (/about) URLs
    const path  = window.location.pathname.replace(/^\//, "").trim();
    const hash  = (window.location.hash || "").replace(/^#/, "").trim();
    const value = path || hash;
    if (!value) return;

    // /case/01  or  #case=01
    const caseMatch = value.match(/^case[=/](.+)$/);
    if (caseMatch) {
      const slot = caseMatch[1];
      if (!slot) return;
      await renderCase(slot, projects, caseTitleEl, caseContentEl, caseFooterLeft);
      setHash("case=" + slot);
      if (currentPage !== "case") {
        if (hasSeenBanner) {
          navigateTo("case", "next");
        } else {
          pendingAfterBanner = () => navigateTo("case", "next");
        }
      }
      return;
    }

    if (pages[value] && value !== currentPage) {
      if (hasSeenBanner) {
        navigateTo(value, "next");
      } else {
        pendingAfterBanner = () => navigateTo(value, "next");
      }
    }
  }

  async function openCase(slot) {
    currentCaseSlot = slot;
    await renderCase(slot, projects, caseTitleEl, caseContentEl, caseFooterLeft);
    setHash(`case=${slot}`);
    updatePageTitle("case", slot);
    window._currentCaseSlot = slot;

    // ── Wire up "Next project" link ──
    const nextLink = document.getElementById("case-next-link");
    // Only cycle through projects that have a case page (intro.txt = canonical signal)
    const caseProjects = [];
    for (const p of projects) {
      if (await urlExists(`projects/${p.slot}/case/intro.txt`)) caseProjects.push(p);
    }
    if (nextLink && caseProjects.length > 1) {
      const idx     = caseProjects.findIndex(p => p.slot === slot);
      const nextIdx = (idx + 1) % caseProjects.length;
      const next    = caseProjects[nextIdx];
      nextLink.style.visibility = "visible";
      nextLink.onclick = (e) => { e.preventDefault(); transitionToCase(next.slot, caseProjects); };
    } else if (nextLink) {
      nextLink.style.visibility = "hidden";
    }

    if (currentPage !== "case") navigateTo("case", "next");
    // Cache invalidieren + Farbe des neuen Heroes setzen
    invalidateCaseCache();
    updateUiColorForCaseHero();
  }

  // Transitions between case pages.
  // Phase 1: fold current page away (from wherever user is scrolled — no snap).
  // Phase 2: render new content while folded.
  // Phase 3: expand new page in from bottom.
  async function transitionToCase(slot, caseProjects) {
    if (isAnimating) return;
    const SPEED = 850;
    tLock.acquire(SPEED * 2 + 200);

    const casePage = pages["case"];

    // Phase 1 — collapse. transformOrigin top = folds upward, same as leaving any page.
    // Do NOT touch scrollTop here — let it collapse from wherever the user is.
    casePage.style.transformOrigin = "top center";
    casePage.classList.remove("visible");
    casePage.classList.add("hidden");

    // Wait for collapse to finish + render in parallel (render is usually faster)
    await Promise.all([
      new Promise(r => setTimeout(r, SPEED)),
      renderCase(slot, projects, caseTitleEl, caseContentEl, caseFooterLeft),
    ]);

    // Update state while page is fully folded and invisible
    currentCaseSlot = slot;
    setHash(`case=${slot}`);
    updatePageTitle("case", slot);
    window._currentCaseSlot = slot;
    casePage.scrollTop = 0; // safe — page is scaleY(0), user sees nothing

    // Phase 3 — expand. transformOrigin bottom = unfolds upward, same as arriving on any page.
    casePage.style.transformOrigin = "bottom center";
    casePage.classList.remove("hidden");
    casePage.classList.add("visible");
    // Cache invalidieren + Farbe des neuen Heroes setzen
    invalidateCaseCache();
    updateUiColorForCaseHero();

    await openCaseInPlace(slot, caseProjects);
  }

  // Re-wires next-project link without triggering a full navigateTo
  async function openCaseInPlace(slot, caseProjects) {
    const nextLink = document.getElementById("case-next-link");
    if (!nextLink || !caseProjects || caseProjects.length <= 1) {
      if (nextLink) nextLink.style.visibility = "hidden";
      return;
    }
    const idx     = caseProjects.findIndex(p => p.slot === slot);
    const nextIdx = (idx + 1) % caseProjects.length;
    const next    = caseProjects[nextIdx];
    nextLink.style.visibility = "visible";
    nextLink.onclick = (e) => { e.preventDefault(); transitionToCase(next.slot, caseProjects); };
  }
} // end init()

/* Project + Manifest loader — 1 einziger Request für alle Daten */
let _projectsData = null;

async function loadProjectsData() {
  if (_projectsData) return _projectsData;
  try {
    const res = await fetch("projects-data.json", { cache: "default" });
    if (res.ok) {
      _projectsData = await res.json();
      return _projectsData;
    }
  } catch {}
  return null;
}

async function loadEnabledProjects() {
  const data = await loadProjectsData();
  if (data) return data; // projects-data.json vorhanden — fertig

  // Fallback: einzelne project.json Dateien laden (langsam)
  const slots = ["01","02","03","04","05","06","07","08"];
  const results = await Promise.all(slots.map(async slot => {
    try {
      const res = await fetch(`projects/${slot}/project.json`, { cache: "default" });
      if (!res.ok) return null;
      const d = await res.json();
      if (!d || !d.enabled) return null;
      return { slot, title: (d.title || `Project ${slot}`).trim(),
               title_de: d.title_de ? d.title_de.trim() : null,
               slug: (d.slug || `project-${slot}`).trim(), manifest: null };
    } catch { return null; }
  }));
  return results.filter(Boolean);
}

async function loadManifest(slot) {
  // Erst aus gecachten projects-data.json lesen
  const data = await loadProjectsData();
  if (data) {
    const project = data.find(p => p.slot === slot);
    return project ? project.manifest : null;
  }
  // Fallback: einzelne manifest.json
  try {
    const res = await fetch(`projects/${slot}/manifest.json`, { cache: "default" });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/* Home render */
async function renderHomeSlides(pageHome, projects) {
  const loading = pageHome.querySelector(".home-loading");
  if (loading) loading.remove();
  pageHome.querySelectorAll(".slide-section").forEach((el) => el.remove());

  const slidesToRender = [];

  // Alle Manifests parallel laden — 1 fetch pro Projekt
  const manifests = await Promise.all(projects.map(p => loadManifest(p.slot)));

  for (let pi = 0; pi < projects.length; pi++) {
    const project  = projects[pi];
    const manifest = manifests[pi];
    const homeBase = `projects/${project.slot}/home/`;
    const caseBase = `projects/${project.slot}/case/`;

    if (manifest) {
      // ── Manifest vorhanden: kein einziger HEAD-Request nötig ──
      const hasCase = !!(manifest.case && (manifest.case.hasIntro || manifest.case.hero));
      for (const item of (manifest.home || [])) {
        let block;
        if (item.type === "row") {
          block = { type: "row", items: (item.items || []).map(f => ({
            kind: /\.(mp4|webm)$/i.test(f) ? "video" : "image",
            src: `${homeBase}${f}`
          }))};
        } else if (item.type === "single" && item.src) {
          block = { type: "single", item: {
            kind: /\.(mp4|webm)$/i.test(item.src) ? "video" : "image",
            src: `${homeBase}${item.src}`
          }};
        } else {
          continue; // unbekanntes Format überspringen
        }
        slidesToRender.push({ title: project.title, link: `#case=${project.slot}`, hasCase, block });
      }
    } else {
      // ── Kein Manifest: Fallback auf HEAD-Requests ──────────────
      const hasCase = await urlExists(`${caseBase}intro.txt`);
      for (let i = 1; i <= 99; i++) {
        const block = await findNumberedBlock(homeBase, i, { allowText: false });
        if (!block) break;
        slidesToRender.push({ title: project.title, link: `#case=${project.slot}`, hasCase, block });
      }
    }
  }

  if (slidesToRender.length === 0) {
    const section = document.createElement("section");
    section.className = "slide-section active is-portrait";
    section.setAttribute("data-title", "");
    section.setAttribute("data-link", "#");
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
      if (merged[i].link === merged[i + 1].link) {
        for (let j = i + 2; j < merged.length; j++) {
          if (merged[j].link !== merged[i].link) {
            [merged[i + 1], merged[j]] = [merged[j], merged[i + 1]];
            break;
          }
        }
      }
    }

    // ── RANDOMIZATION ENHANCEMENT ──
    // Apply final shuffle to entire sequence to ensure true randomness on every visit
    shuffle(merged);
    
    // Ensure first slide has a case study (clickable to open case page)
    let firstCaseIndex = merged.findIndex(s => s.hasCase);
    if (firstCaseIndex > 0) {
      [merged[0], merged[firstCaseIndex]] = [merged[firstCaseIndex], merged[0]];
    }

    slidesToRender.length = 0;
    merged.forEach(s => slidesToRender.push(s));
  }

  // FIX: preload home images via Image() so they load even when page is scaleY(0)
  slidesToRender.forEach((item) => {
    const srcs = item.block.type === "row"
      ? item.block.items.filter((m) => m.kind === "image").map((m) => m.src)
      : item.block.item && item.block.item.kind === "image" ? [item.block.item.src] : [];
    srcs.forEach((src) => { const p = new Image(); p.src = src; });
  });

  slidesToRender.forEach((item, idx) => {
    const section = document.createElement("section");
    section.className = "slide-section" + (idx === 0 ? " active" : "");
    section.setAttribute("data-title", item.title);
    section.setAttribute("data-link", item.link);
    section.setAttribute("data-has-case", item.hasCase ? "1" : "0");

    if (item.block.type === "row") {
      section.classList.add("is-row");
      const wrap = document.createElement("div");
      wrap.className = item.block.items.length >= 3 ? "media-row row-fit row-many" : "media-row row-fit";
      item.block.items.forEach((media) => {
        const itemWrap = document.createElement("div");
        itemWrap.className = "media-item";
        itemWrap.appendChild(createMediaElement(media, { context: "home" }));
        wrap.appendChild(itemWrap);
      });
      section.appendChild(wrap);
    } else {
      const wrap = document.createElement("div");
      wrap.className = "content-single";
      wrap.appendChild(createMediaElement(item.block.item, { context: "home" }));
      section.appendChild(wrap);
    }

    pageHome.appendChild(section);
  });

  return Array.from(pageHome.querySelectorAll(".slide-section"));
}

/* Case render
 *
 * Loads both EN and DE text upfront in parallel.
 * Every text element gets data-en + data-de attributes —
 * the existing language swap system handles switching instantly.
 * Images are language-neutral and rendered once.
 */
// Render Lock — verhindert dass renderCase gleichzeitig zweimal läuft
let _renderLock = false;
let _pendingRender = null;

async function renderCase(slot, projects, titleEl, contentEl, caseFooterLeft) {
  if (!titleEl || !contentEl) return;

  // Falls gerade ein Render läuft: diesen als "als nächstes" merken
  if (_renderLock) {
    _pendingRender = { slot, projects, titleEl, contentEl, caseFooterLeft };
    return;
  }
  _renderLock = true;

  const project = projects.find((p) => p.slot === slot);
  const base    = `projects/${slot}/case/`;

  // ── Helper: load both language versions of a text file in parallel ──
  async function loadBoth(filename) {
    const deFile = filename.replace(/(\.[^.]+)$/, ".de$1");
    const [en, de] = await Promise.all([
      loadTextFile(base, filename),
      loadTextFile(base, deFile),
    ]);
    return { en, de: de || en };
  }

  // ── Helper: set data-en/data-de and apply current language ──
  function setLang(el, en, de, isText = false) {
    el.setAttribute("data-en", en);
    el.setAttribute("data-de", de);
    const lang = (window.getCurrentLang && window.getCurrentLang()) || "en";
    el.textContent = lang === "de" ? de : en;
  }

  // ── Title ──
  const titleEn = project ? project.title       : `Project ${slot}`;
  const titleDe = project ? (project.title_de || project.title) : `Project ${slot}`;
  setLang(titleEl, titleEn, titleDe);
  if (caseFooterLeft) setLang(caseFooterLeft, titleEn, titleDe);

  // ── Reset DOM ──
  contentEl.innerHTML = "";
  const wrapper = document.querySelector("#page-case .case-wrapper");
  const header  = wrapper ? wrapper.querySelector(".case-header") : null;
  if (!wrapper || !header) return;
  wrapper.querySelectorAll(".case-top,.case-intro,.case-category,.case-ending").forEach((n) => n.remove());
  if (header.parentElement !== wrapper) wrapper.insertBefore(header, wrapper.firstChild);

  // ── Manifest laden falls vorhanden ──
  const manifest = await loadManifest(slot);

  // ── Hero (language-neutral) ──
  const heroMedia = manifest && manifest.case && manifest.case.hero
    ? { kind: manifest.case.hero.match(/\.(mp4|webm)$/i) ? "video" : "image", src: `${base}${manifest.case.hero}` }
    : await findMediaByStem(base, "hero");
  let topEl = null;
  if (heroMedia) {
    topEl = document.createElement("div");
    topEl.className = "case-top";
    const heroEl = document.createElement("div");
    heroEl.className = "case-hero";
    heroEl.appendChild(createMediaElement(heroMedia, { context: "hero" }));
    topEl.appendChild(heroEl);
    topEl.appendChild(header);
    wrapper.insertBefore(topEl, wrapper.firstChild);
  }

  // ── Intro text ──
  const intro = manifest && manifest.case
    ? (manifest.case.hasIntro ? await loadBoth("intro.txt") : { en: "", de: "" })
    : await loadBoth("intro.txt");
  let introDiv = null;
  if (intro.en) {
    introDiv = document.createElement("div");
    introDiv.className = "case-intro";
    const textDiv = document.createElement("div");
    textDiv.className = "case-intro-text type-contact-item";
    setLang(textDiv, intro.en, intro.de, true);
    introDiv.appendChild(textDiv);
    if (topEl) topEl.insertAdjacentElement("afterend", introDiv);
    else header.insertAdjacentElement("afterend", introDiv);
  }

  // ── Category label ──
  const category = manifest && manifest.case
    ? (manifest.case.hasCategory ? await loadBoth("category.txt") : { en: "", de: "" })
    : await loadBoth("category.txt");
  if (category.en) {
    const cat = document.createElement("div");
    cat.className = "case-category type-contact-item";
    setLang(cat, category.en, category.de, true);
    if (introDiv) introDiv.insertAdjacentElement("afterend", cat);
    else if (topEl) topEl.insertAdjacentElement("afterend", cat);
    else header.insertAdjacentElement("afterend", cat);
  }

  // ── Numbered content blocks ──
  let foundAny = false;
  const caseBlocks = manifest && manifest.case && manifest.case.blocks
    ? manifest.case.blocks  // Manifest: direkt verwenden
    : await buildBlockListFromNetwork(base); // Fallback: HEAD-Requests

  for (const block of caseBlocks) {
    if (!block) continue;
    foundAny = true;

    const blockEl = document.createElement("div");
    blockEl.className = "case-block";
    const inner = document.createElement("div");
    inner.className = "case-block-inner";

    if (block.type === "text") {
      // Load both language versions of the text block
      const num  = block.num || pad2(block.index || caseBlocks.indexOf(block) + 1);
      const texts = await loadBoth(`${num}.txt`);
      blockEl.classList.add("is-text");
      const textEl = document.createElement("div");
      textEl.className = "case-text type-contact-item";
      setLang(textEl, texts.en, texts.de, true);
      inner.appendChild(textEl);
      blockEl.appendChild(inner);
      contentEl.appendChild(blockEl);
      continue;
    }

    if (block.type === "row") {
      const row = document.createElement("div");
      row.className = block.items.length >= 3 ? "media-row row-scroll" : "media-row row-fit";
      block.items.forEach((media) => {
        // Manifest: items sind Strings; Network: items sind {kind, src} Objekte
        const mediaObj = typeof media === "string"
          ? { kind: media.match(/\.(mp4|webm)$/i) ? "video" : "image", src: `${base}${media}` }
          : media;
        const itemWrap = document.createElement("div");
        itemWrap.className = "media-item";
        itemWrap.appendChild(createMediaElement(mediaObj, { context: "case" }));
        row.appendChild(itemWrap);
      });
      inner.appendChild(row);
      blockEl.appendChild(inner);
      contentEl.appendChild(blockEl);
      continue;
    }

    inner.classList.add("single");
    const singleWrap = document.createElement("div");
    singleWrap.className = "case-media-single";
    // Manifest: block.src ist ein String; Network: block.item ist {kind, src}
    const singleMedia = block.item || (block.src
      ? { kind: block.src.match(/\.(mp4|webm)$/i) ? "video" : "image", src: `${base}${block.src}` }
      : null);
    singleWrap.appendChild(createMediaElement(singleMedia, { context: "case" }));
    inner.appendChild(singleWrap);
    blockEl.appendChild(inner);
    contentEl.appendChild(blockEl);
  }

  // ── Outro + credits ──
  const outro  = manifest && manifest.case
    ? (manifest.case.hasOutro  ? await loadBoth("outro.txt")  : { en: "", de: "" })
    : await loadBoth("outro.txt");
  const credit = manifest && manifest.case
    ? (manifest.case.hasCredit ? await loadBoth("credit.txt") : { en: "", de: "" })
    : await loadBoth("credit.txt");
  if (outro.en || credit.en) {
    const ending = document.createElement("div");
    ending.className = "case-ending";
    if (outro.en) {
      const outroEl = document.createElement("div");
      outroEl.className = "case-outro type-contact-item";
      setLang(outroEl, outro.en, outro.de, true);
      ending.appendChild(outroEl);
    }
    if (credit.en) {
      const creditEl = document.createElement("div");
      creditEl.className = "case-credit type-contact-item";
      setLang(creditEl, credit.en, credit.de, true);
      ending.appendChild(creditEl);
    }
    const endingBlock = document.createElement("div");
    endingBlock.className = "case-block";
    const inner = document.createElement("div");
    inner.className = "case-block-inner";
    inner.style.justifyContent = "flex-start";
    inner.appendChild(ending);
    endingBlock.appendChild(inner);
    contentEl.appendChild(endingBlock);
  }

  if (!foundAny) {
    const msgBlock = document.createElement("div");
    msgBlock.className = "case-block is-text";
    const inner   = document.createElement("div");
    inner.className = "case-block-inner";
    const msg     = document.createElement("div");
    msg.className = "case-text type-contact-item";
    msg.textContent = `No case content found yet. Add files to projects/${slot}/case/.`;
    inner.appendChild(msg);
    msgBlock.appendChild(inner);
    contentEl.appendChild(msgBlock);
  }

  // Lock freigeben + ggf. gepufferten Render ausführen
  _renderLock = false;
  if (_pendingRender) {
    const next = _pendingRender;
    _pendingRender = null;
    await renderCase(next.slot, next.projects, next.titleEl, next.contentEl, next.caseFooterLeft);
  }
}

async function loadTextFile(base, filename) {
  const url = base + filename;
  if (!(await urlExists(url))) return "";
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return "";
    return ((await res.text()) || "").trim();
  } catch { return ""; }
}

// Fallback: baut Blockliste via HEAD-Requests (langsam, nur ohne Manifest)
async function buildBlockListFromNetwork(base) {
  const blocks = [];
  for (let i = 1; i <= 199; i++) {
    const block = await findNumberedBlock(base, i);
    if (!block) break;
    blocks.push(block);
  }
  return blocks;
}

async function findNumberedBlock(base, n) {
  const num = pad2(n);

  // Check for text block (just .txt — both languages loaded separately by renderCase)
  const txtUrl = `${base}${num}.txt`;
  if (await urlExists(txtUrl)) return { type: "text" };

  const rowItems = [];
  for (const letter of ["a", "b", "c"]) {
    const media = await findMediaByStem(base, `${num}${letter}`);
    if (!media) break;
    rowItems.push(media);
  }
  if (rowItems.length > 0) return { type: "row", items: rowItems };

  const single = await findMediaByStem(base, num);
  if (single) return { type: "single", item: single };

  return null;
}

async function findMediaByStem(base, stem) {
  const imageExts = ["jpg", "jpeg", "png", "webp"];
  const imageExtsArr = imageExts;

  // Safari kann kein WebM — MP4 zuerst für Safari, WebM zuerst für andere
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const videoExts = isSafari ? ["mp4", "webm"] : ["webm", "mp4"];

  for (const ext of imageExtsArr) {
    const url = `${base}${stem}.${ext}`;
    if (await urlExists(url)) return { kind: "image", src: url };
  }
  for (const ext of videoExts) {
    const url = `${base}${stem}.${ext}`;
    if (await urlExists(url)) return { kind: "video", src: url };
  }
  return null;
}

// ── Safari: Einfacher rAF-Loop für Case/Hero-Videos ─────────────────
// Kein Double-Buffer (kein DOM-Eingriff) — nur nahtloses Loopen
// mit Auto-Resume falls Safari das Video extern pausiert.
function setupSafariSimpleLoop(v) {
  let seeking = false;

  function tick() {
    if (v.duration && !isNaN(v.duration) && isFinite(v.duration)) {
      // Auto-resume bei externer Pause (Low Power Mode, Background-Tab)
      if (v.paused && !seeking && document.visibilityState !== "hidden") {
        v.play().catch(() => {});
      }

      if (!v.paused && !seeking && v.currentTime >= v.duration - 0.15) {
        seeking = true;
        v.currentTime = 0;
        v.play().catch(() => {});
        v.addEventListener("seeked", () => { seeking = false; }, { once: true });
      }
    }
    requestAnimationFrame(tick);
  }

  // Ended-Fallback
  v.addEventListener("ended", () => {
    seeking = false;
    v.currentTime = 0;
    v.play().catch(() => {});
  });

  // rAF starten sobald Metadaten geladen
  if (v.readyState >= 1) {
    requestAnimationFrame(tick);
  } else {
    v.addEventListener("loadedmetadata", () => requestAnimationFrame(tick), { once: true });
  }
}

function createMediaElement(media, { context }) {
  if (!media) return document.createElement("div");

  if (media.kind === "video") {
    const v = document.createElement("video");
    v.muted       = true;
    v.autoplay    = true;
    v.playsInline = true;
    v.preload     = "auto";
    v.setAttribute("playsinline", "");
    v.setAttribute("muted", "");
    v.setAttribute("autoplay", "");

    v.src = media.src;

    // ── Safari Video Loop ──────────────────────────────────────────
    // Safari unterstützt kein nahtloses natives loop.
    // Home-Slides: Double-Buffer (zwei Videos wechseln sich ab, kein Frame-Gap)
    // Case/Hero:   Simpler rAF-Loop mit Auto-Resume bei externer Pause
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    if (isSafari) {
      v.loop = false;

      if (context === "home") {
        // ── Double-Buffer: nur für Home-Slides ─────────────────────
        v.addEventListener("loadedmetadata", function setupLoop() {
          v.removeEventListener("loadedmetadata", setupLoop);
          const parent = v.parentNode;
          if (!parent) { setupSafariSimpleLoop(v); return; }

          const vB = document.createElement("video");
          vB.src = v.src;
          vB.muted = true; vB.playsInline = true; vB.preload = "none";
          vB.setAttribute("playsinline", ""); vB.setAttribute("muted", "");
          vB.dataset.loopStandby = "";
          vB.style.cssText = "position:absolute;inset:0;width:100%;height:100%;opacity:0;pointer-events:none;";

          if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
          parent.appendChild(vB);

          const PREP = 0.4;  // Standby 400ms vor Ende starten
          const SWAP = 0.06; // Überblenden bei 60ms vor Ende
          let vids = [v, vB]; // [aktiv, standby] — wird bei jedem Loop getauscht
          let inSwap = false;
          let prepped = false;

          function tick() {
            const [curr, next] = vids;

            if (!inSwap && curr.duration && !isNaN(curr.duration) && isFinite(curr.duration)) {
              // Auto-resume falls Safari das aktive Video extern pausiert hat
              if (curr.paused && !inSwap && document.visibilityState !== "hidden") {
                curr.play().catch(() => {});
              }

              const rem = curr.duration - curr.currentTime;

              if (rem <= PREP && !prepped && !curr.paused) {
                prepped = true;
                next.currentTime = 0;
                next.play().catch(() => {});
              }

              if (rem <= SWAP && !inSwap && !curr.paused) {
                inSwap = true;
                const finishing = curr;  // explizite Referenz vor dem Swap
                curr.style.opacity  = "0";
                next.style.opacity  = "1";
                vids = [next, finishing]; // Rollen korrekt tauschen

                setTimeout(() => {
                  finishing.pause();
                  finishing.currentTime = 0;
                  prepped = false;
                  inSwap = false;
                }, 300);
              }
            }

            requestAnimationFrame(tick); // läuft immer — kein Start/Stop-Chaos
          }

          // Ended-Fallback auf BEIDEN Videos
          [v, vB].forEach(vid => {
            vid.addEventListener("ended", () => {
              vid.currentTime = 0;
              vid.play().catch(() => {});
            });
          });

          // rAF sofort starten (v spielt bereits via autoplay)
          requestAnimationFrame(tick);
        });

      } else {
        // ── Einfacher robuster Loop: Case-Page und Hero ─────────────
        setupSafariSimpleLoop(v);
      }

    } else {
      v.loop = true;
    }

    return v;
  }

  const img = document.createElement("img");
  img.src = media.src;
  img.alt = "";
  img.loading = context === "home" ? "eager" : "lazy";
  return img;
}

async function applySlideOrientationClasses(slides) {
  const tasks = slides.map(async (slide) => {
    const isRow = slide.classList.contains("is-row") || slide.querySelector(".media-row") !== null;
    if (isRow) {
      slide.classList.add("is-portrait");
      slide.classList.remove("is-landscape", "is-full-bleed");
      return;
    }

    const imgs = Array.from(slide.querySelectorAll("img")),
      vids = Array.from(slide.querySelectorAll("video:not([data-loop-standby])"));
    const mediaEls = [...imgs, ...vids];
    if (mediaEls.length !== 1) {
      slide.classList.add("is-portrait");
      slide.classList.remove("is-landscape", "is-full-bleed");
      return;
    }

    const el = mediaEls[0],
      dims = await getMediaDims(el),
      w = dims.w || 0,
      h = dims.h || 0;

    slide.classList.remove("is-portrait", "is-landscape", "is-full-bleed");
    if (w >= h && w > 0 && h > 0) {
      slide.classList.add("is-landscape");
      slide.classList.add("is-full-bleed");
    } else {
      slide.classList.add("is-portrait");
    }
  });
  await Promise.all(tasks);
}

function getMediaDims(el) {
  return new Promise((resolve) => {
    if (!el) return resolve({ w: 0, h: 0 });
    if (el.tagName.toLowerCase() === "img") {
      const img = el;
      if (img.complete && img.naturalWidth > 0) return resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.addEventListener("load",  () => resolve({ w: img.naturalWidth,  h: img.naturalHeight }), { once: true });
      img.addEventListener("error", () => resolve({ w: 0, h: 0 }),                                  { once: true });
      return;
    }
    if (el.tagName.toLowerCase() === "video") {
      const v = el;
      if (v.videoWidth > 0) return resolve({ w: v.videoWidth, h: v.videoHeight });
      v.addEventListener("loadedmetadata", () => resolve({ w: v.videoWidth, h: v.videoHeight }), { once: true });
      v.addEventListener("error",          () => resolve({ w: 0, h: 0 }),                        { once: true });
      return;
    }
    resolve({ w: 0, h: 0 });
  });
}

function pad2(n) { return String(n).padStart(2, "0"); }

// ── URL Existence Cache ──────────────────────────────────────────
// Jede URL wird maximal einmal geprüft — Ergebnis wird gecacht.
// Verhindert hunderte doppelte Requests beim Laden.
const _urlCache = new Map();

async function urlExists(url) {
  if (_urlCache.has(url)) return _urlCache.get(url);

  // Falls dieselbe URL gerade geprüft wird, warten statt doppelt zu fetchen
  if (_urlCache.has(url + "__pending")) {
    return new Promise(resolve => {
      const check = () => {
        if (_urlCache.has(url)) { resolve(_urlCache.get(url)); return; }
        setTimeout(check, 20);
      };
      check();
    });
  }
  _urlCache.set(url + "__pending", true);

  let result = false;
  try {
    const head = await fetch(url, { method: "HEAD", cache: "default" });
    if (head.ok) {
      const ct = head.headers.get("content-type") || "";
      result = !ct.startsWith("text/html");
    }
  } catch {
    try {
      const get = await fetch(url, { method: "GET", cache: "default", headers: { Range: "bytes=0-0" } });
      if (get.ok) {
        const ct = get.headers.get("content-type") || "";
        result = !ct.startsWith("text/html");
      }
      if (get.body) get.body.cancel();
    } catch { result = false; }
  }

  _urlCache.delete(url + "__pending");
  _urlCache.set(url, result);
  return result;
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

function setHash(value) {
  // Map page names to clean URL paths
  const pathMap = {
    "about":   "/about",
    "process": "/process",
    "pricing": "/pricing",
    "contact": "/contact",
    "legal":   "/legal",
  };
  let next;
  if (!value) {
    // Clear both pathname and any hash (e.g. #case=01 left over from case page)
    next = "/";
    if (window.location.pathname !== next || window.location.hash) {
      history.replaceState(null, "", next);
    }
    return;
  } else if (value.startsWith("case=")) {
    // Case pages are client-side rendered — keep as hash so server refresh works
    const slot = value.split("=").pop();
    if (window.location.hash !== `#case=${slot}`) {
      history.replaceState(null, "", `#case=${slot}`);
    }
    return;
  } else if (pathMap[value]) {
    next = pathMap[value];
  } else {
    next = "/" + value;
  }
  if (window.location.pathname !== next) history.replaceState(null, "", next);
}

// Typewriter animation for language changes
function applyTypewriterEffect(elements) {
  // Find the currently active/visible page
  const activePage = document.querySelector(".page-container.visible");
  
  elements.forEach(el => {
    // Skip if element has data-typewriter="false"
    if (el.getAttribute("data-typewriter") === "false") return;
    
    // Only animate if element is on the currently active page
    if (activePage && !activePage.contains(el)) return;
    
    // Skip if element is not visible
    if (el.offsetParent === null) return;

    // Justified text paragraphs: word-by-word reveal instead of character-by-character.
    // Per-character spans on justified text create huge gaps because the browser
    // distributes justification spacing between individual letter spans.
    // Word spans preserve correct justification while keeping the cascading feel.
    if (el.matches("p.type-contact-item, .case-text, .case-intro-text, .case-outro")) {
      const wordDelay = 18; // ms per word — feels alive without being slow

      function revealWords(node, wordIndex) {
        if (node.nodeType === Node.TEXT_NODE) {
          const words = node.textContent.split(/(\s+)/);
          const frag = document.createDocumentFragment();
          words.forEach(function (part) {
            if (/^\s+$/.test(part)) {
              frag.appendChild(document.createTextNode(part));
            } else if (part) {
              const span = document.createElement("span");
              span.className = "typewriter-char";
              span.textContent = part;
              span.style.animationDelay = (wordIndex[0] * wordDelay) + "ms";
              span.style.display = "inline"; // keep inline so justification treats it as a word
              frag.appendChild(span);
              wordIndex[0]++;
            }
          });
          node.parentNode.replaceChild(frag, node);
        } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== "BR") {
          Array.from(node.childNodes).forEach(function (child) {
            revealWords(child, wordIndex);
          });
        }
      }

      const wordIndex = [0];
      el.innerHTML = el.innerHTML; // re-set to ensure clean state
      Array.from(el.childNodes).forEach(function (child) {
        revealWords(child, wordIndex);
      });
      return;
    }

    const text = el.textContent;
    const originalHTML = el.innerHTML;
    
    // Determine animation speed based on element type
    let charDelay = 40; // default for headlines and short UI labels
    // Only long body text paragraphs get fast delay — not short spans
    if ((el.tagName === "P" && el.classList.contains("type-contact-item")) ||
        el.classList.contains("case-text") ||
        el.classList.contains("service-description")) {
      charDelay = 5;
    }
    
    // Check if element has custom speed attribute
    const customSpeed = el.getAttribute("data-typewriter-speed");
    if (customSpeed === "fast") charDelay = 5;
    if (customSpeed === "slow") charDelay = 50;
    
    // Check if it has HTML content (links, formatting, etc)
    const hasHTML = el.innerHTML !== el.textContent;
    
    if (hasHTML) {
      // For HTML content, wrap text nodes
      let charIndex = 0;
      
      function wrapTextNodes(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          const container = document.createElement("span");
          for (let char of node.textContent) {
            // Don't wrap spaces, add them directly
            if (char === " ") {
              container.appendChild(document.createTextNode(" "));
            } else {
              const charSpan = document.createElement("span");
              charSpan.className = "typewriter-char";
              charSpan.textContent = char;
              charSpan.style.animationDelay = (charIndex * charDelay) + "ms";
              container.appendChild(charSpan);
            }
            charIndex++;
          }
          node.parentNode.replaceChild(container, node);
        } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== "BR") {
          for (let child of Array.from(node.childNodes)) {
            wrapTextNodes(child);
          }
        }
      }
      
      el.innerHTML = originalHTML;
      for (let child of Array.from(el.childNodes)) {
        wrapTextNodes(child);
      }
    } else {
      // For plain text, wrap each character (except spaces)
      el.innerHTML = "";
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        
        // Don't wrap spaces, add them directly
        if (char === " ") {
          el.appendChild(document.createTextNode(" "));
        } else {
          const span = document.createElement("span");
          span.className = "typewriter-char";
          span.textContent = char;
          span.style.animationDelay = (i * charDelay) + "ms";
          el.appendChild(span);
        }
      }
    }
  });
}