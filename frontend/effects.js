/* effects.js -- motion, 3D depth and cursor interaction.
   Loaded after app.js. All enhancements are progressive: without GSAP,
   tsParticles, VanillaTilt or WebGL the page still works. Every effect is
   skipped when the visitor asks for reduced motion. */

(function () {
  "use strict";

  const motionQuery = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let reduce = !!(motionQuery && motionQuery.matches);
  const finePointer = window.matchMedia
    ? window.matchMedia("(pointer: fine)").matches : false;
  const hasGSAP = typeof window.gsap !== "undefined";
  const hasScroll = hasGSAP && typeof window.ScrollTrigger !== "undefined";

  if (hasScroll) gsap.registerPlugin(ScrollTrigger);

  /* ---------------------------------------------------- hero glow */
  const hero = document.querySelector(".hero");
  const glow = document.getElementById("heroGlow");
  let glowRaf = 0, glowX = 0, glowY = 0;
  function moveGlow(x, y) {
    if (!glow || reduce) return;
    glowX = x; glowY = y;
    if (glowRaf) return;
    glowRaf = requestAnimationFrame(() => {
      glowRaf = 0;
      glow.style.transform = `translate3d(${glowX}px, ${glowY}px, 0)`;
    });
  }
  if (hero && glow && finePointer) {
    hero.addEventListener("pointermove", (e) => {
      const r = hero.getBoundingClientRect();
      moveGlow(e.clientX - r.left, e.clientY - r.top);
      glow.style.opacity = "1";
    });
    hero.addEventListener("pointerleave", () => {
      if (glow) glow.style.opacity = "0";
    });
  }

  /* ------------------------------------- generic pointer spotlight */
  if (finePointer) {
    document.addEventListener("pointermove", (e) => {
      const el = e.target.closest && e.target.closest(".spotlight, .veg-card");
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      el.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100) + "%");
      el.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100) + "%");
    }, { passive: true });
  }

  /* --------------------------------------------------- slider sheen */
  document.addEventListener("input", (e) => {
    if (e.target.matches('input[type="range"]')) {
      e.target.style.setProperty("--p",
        (Number(e.target.value) - 1) / 4);
    }
  }, true);

  /* ------------------------------------------------------ ripple */
  document.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest && e.target.closest("button");
    if (!btn || reduce) return;
    const r = btn.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 1.4;
    const ink = document.createElement("span");
    ink.className = "ripple";
    ink.style.width = ink.style.height = size + "px";
    ink.style.left = (e.clientX - r.left - size / 2) + "px";
    ink.style.top = (e.clientY - r.top - size / 2) + "px";
    if (!btn.classList.contains("primary") && !btn.classList.contains("use-spot"))
      ink.style.background = "rgba(30, 70, 40, 0.16)";
    btn.appendChild(ink);
    ink.addEventListener("animationend", () => ink.remove(), { once: true });
  }, { passive: true });

  /* ------------------------------------------------- page-load motion */
  function intro() {
    if (!hasGSAP || reduce) return;
    const targets = [".kicker", ".hero h1", ".lede", ".fieldform",
                     ".hero-stats", ".scroll-cue"];
    gsap.set(targets, { autoAlpha: 0, y: 18 });
    gsap.set(".mappanel", { autoAlpha: 0, y: 22, scale: 0.96 });
    const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
    tl.to(".kicker", { autoAlpha: 1, y: 0, duration: 0.5 })
      .to(".hero h1", { autoAlpha: 1, y: 0, duration: 0.85 }, "-=0.25")
      .to(".lede", { autoAlpha: 1, y: 0, duration: 0.65 }, "-=0.55")
      .to(".fieldform", { autoAlpha: 1, y: 0, duration: 0.6 }, "-=0.5")
      .to(".hero-stats", { autoAlpha: 1, y: 0, duration: 0.6 }, "-=0.45")
      .to(".scroll-cue", { autoAlpha: 1, y: 0, duration: 0.5 }, "-=0.4")
      .to(".mappanel", { autoAlpha: 1, y: 0, scale: 1, duration: 1.0,
                         ease: "power2.out" }, 0.25);

    document.querySelectorAll(".count").forEach((el) => {
      const end = Number(el.dataset.count || 0);
      if (!end) return;
      const obj = { v: 0 };
      tl.to(obj, {
        v: end, duration: 1.5, ease: "power2.out",
        onUpdate: () => {
          el.textContent = Math.round(obj.v).toLocaleString("en-US");
        },
      }, 0.55);
    });
  }

  function scrollReveals() {
    if (!hasScroll || reduce) return;
    gsap.utils.toArray(".step").forEach((el) => {
      gsap.from(el, {
        y: 30, autoAlpha: 0, duration: 0.7, ease: "power3.out",
        scrollTrigger: { trigger: el, start: "top 90%", once: true },
      });
    });
    gsap.utils.toArray(".sitefoot").forEach((el) => {
      gsap.from(el, {
        y: 16, autoAlpha: 0, duration: 0.6, ease: "power2.out",
        scrollTrigger: { trigger: el, start: "top 98%", once: true },
      });
    });
  }

  /* ----------------------------------------------- active nav link */
  if ("IntersectionObserver" in window) {
    const links = [...document.querySelectorAll(".topnav a")];
    const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        links.forEach((a) => a.classList.remove("active"));
        const a = byId.get(en.target.id);
        if (a) a.classList.add("active");
      });
    }, { rootMargin: "-45% 0px -45% 0px" });
    ["step1", "step2", "step3", "step4"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
  }

  /* --------------------------------------------------- tilt on cards */
  function initTilt() {
    if (!finePointer || reduce || typeof window.VanillaTilt === "undefined")
      return;
    document.querySelectorAll(".tilt").forEach((el) => {
      if (el.vanillaTilt) el.vanillaTilt.destroy();
      VanillaTilt.init(el, {
        max: 5, speed: 550, scale: 1.008, glare: false,
        "max-glare": 0, gyroscope: false,
      });
    });
  }

  /* ------------------------------------------- recommendation moment */
  function seedBurst(card) {
    if (reduce) return;
    const colors = ["#B7E278", "#DE9F24", "#8FD0EA", "#F5F2DF"];
    for (let i = 0; i < 16; i++) {
      const s = document.createElement("span");
      s.className = "seed";
      const angle = (-Math.PI / 2) + (Math.random() - 0.5) * 2.2;
      const dist = 46 + Math.random() * 90;
      s.style.setProperty("--tx", (Math.cos(angle) * dist).toFixed(1) + "px");
      s.style.setProperty("--ty", (Math.sin(angle) * dist).toFixed(1) + "px");
      s.style.background = colors[i % colors.length];
      s.style.left = (30 + Math.random() * 40) + "%";
      s.style.top = "26px";
      s.style.animationDelay = (Math.random() * 0.12).toFixed(2) + "s";
      card.appendChild(s);
      s.addEventListener("animationend", () => s.remove(), { once: true });
    }
  }

  function afterRender() {
    initTilt();
    if (!hasGSAP || reduce) return;
    const card = document.querySelector(".rec-card");
    if (card) {
      gsap.from(card, {
        y: 26, autoAlpha: 0, rotateX: 4, transformPerspective: 900,
        duration: 0.7, ease: "power3.out",
        onComplete: () => { gsap.set(card, { clearProps: "transform" }); },
      });
      seedBurst(card);
    }
    gsap.from(".scorecard .bar.f, .scorecard .bar.warn, .scorecard .bar.bad", {
      scaleX: 0, transformOrigin: "left center", duration: 0.45,
      stagger: 0.015, ease: "power2.out", delay: 0.15,
    });
    gsap.from(".planrow", {
      x: -10, autoAlpha: 0, duration: 0.45, stagger: 0.08,
      ease: "power2.out", delay: 0.15,
    });
    gsap.from(".otherrow", {
      y: 10, autoAlpha: 0, duration: 0.4, stagger: 0.06,
      ease: "power2.out", delay: 0.1,
    });
    if (hasScroll) ScrollTrigger.refresh();
  }

  function animateVegetation() {
    const card = document.querySelector(".veg-card");
    if (!card) return;
    initTilt();
    if (!hasGSAP || reduce) return;
    gsap.from(card, { y: 24, autoAlpha: 0, duration: 0.6, ease: "power3.out" });
    const clip = card.querySelector(".veg-clip");
    const width = card.querySelector(".veg-chart svg");
    if (clip && width) {
      const W = Number(width.getAttribute("viewBox").split(" ")[2]) || 560;
      gsap.fromTo(clip, { attr: { width: 0 } },
        { attr: { width: W }, duration: 1.5, ease: "power2.inOut",
          delay: 0.15 });
    }
    gsap.from(card.querySelectorAll(".veg-metric"), {
      y: 10, autoAlpha: 0, duration: 0.4, stagger: 0.08,
      ease: "power2.out", delay: 0.1,
    });
  }

  /* ---------------------------------------------------- particles */
  async function particles() {
    const canvas = document.getElementById("heroParticles");
    if (!canvas || reduce) return;
    if (typeof window.tsParticles === "undefined") return;
    try {
      if (typeof window.loadSlim === "function")
        await loadSlim(tsParticles);
      await tsParticles.load({
        id: "heroParticles",
        options: {
          fullScreen: { enable: false },
          fpsLimit: 45,
          pauseOnBlur: true,
          pauseOnOutsideViewport: true,
          detectRetina: true,
          background: { color: "transparent" },
          particles: {
            number: { value: window.innerWidth < 720 ? 30 : 64,
                      density: { enable: true, width: 1100, height: 760 } },
            color: { value: ["#B7E278", "#8FD0EA", "#DE9F24", "#EAF2E4"] },
            links: { enable: window.innerWidth >= 720, distance: 132,
                     color: "#9FCB8C", opacity: 0.16, width: 1 },
            move: { enable: true, speed: 0.42, direction: "none",
                    outModes: { default: "out" } },
            opacity: { value: { min: 0.12, max: 0.55 },
                       animation: { enable: true, speed: 0.35,
                                    sync: false, startValue: "random" } },
            size: { value: { min: 0.6, max: 2.5 },
                    animation: { enable: true, speed: 1.4,
                                 sync: false, startValue: "random" } },
            shape: { type: "circle" },
          },
          interactivity: {
            detectsOn: "canvas",
            events: {
              onHover: { enable: true, mode: ["repulse", "bubble"],
                         parallax: { enable: true, force: 18, smooth: 14 } },
              onClick: { enable: true, mode: "push" },
              resize: { enable: true },
            },
            modes: {
              repulse: { distance: 115, duration: 0.45, speed: 0.6 },
              bubble: { distance: 135, size: 3, duration: 2, opacity: 0.85 },
              push: { quantity: 2 },
            },
          },
        },
      });
    } catch (e) {
      console.warn("particle field unavailable:", e && e.message);
    }
  }

  /* ----------------------------------------------------- boot */
  intro();
  scrollReveals();
  initTilt();
  if (motionQuery && motionQuery.addEventListener) {
    motionQuery.addEventListener("change", (e) => { reduce = e.matches; });
  }
  if (document.readyState === "complete") particles();
  else window.addEventListener("load", particles, { once: true });

  window.LCRDA_EFFECTS = { afterRender, animateVegetation, initTilt };
})();
