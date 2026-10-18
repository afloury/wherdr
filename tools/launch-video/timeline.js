/* V1's animated launch pacing, with real app captures replacing every drawn control. */
const wide = document.getElementById("film").classList.contains("wide");
const tl = gsap.timeline({ paused: true, defaults: { ease: "power2.inOut" } });
tl.fromTo(
  "#desktop-title",
  { y: 24, autoAlpha: 0 },
  { y: 0, autoAlpha: 1, duration: 0.35 },
  0,
)
  .fromTo(
    "#desktop",
    { y: 65, scale: 0.94, rotation: -1, autoAlpha: 0 },
    { y: 0, scale: 1, rotation: 0, autoAlpha: 1, duration: 0.65 },
    0,
  )
  .to("#pc-working", { autoAlpha: 1, duration: 0.12 }, 1.15)
  .to("#desktop", { scale: 1.035, duration: 1.1 }, 0.65)
  .to("#desktop-title", { y: -25, autoAlpha: 0, duration: 0.25 }, 1.65)
  .to(
    "#desktop",
    { x: wide ? -240 : -160, y: 30, scale: 0.72, autoAlpha: 0, duration: 0.7 },
    1.85,
  )
  .fromTo(
    "#phone",
    { x: wide ? -250 : -240, y: 170, scale: 0.65, rotation: 5 },
    { x: 0, y: 0, scale: 1, rotation: 0, autoAlpha: 1, duration: 0.75 },
    1.85,
  )
  .fromTo(
    "#mobile-title",
    { y: 35 },
    { y: 0, autoAlpha: 1, duration: 0.4 },
    1.9,
  )
  .to("#handoff", { autoAlpha: 1, duration: 0.3 }, 2.15)
  .to("#permission", { autoAlpha: 1, duration: 0.16 }, 3.1)
  .to("#mobile-title,#handoff", { autoAlpha: 0, y: -18, duration: 0.22 }, 3.65)
  .fromTo(
    "#reply-title",
    { y: 25 },
    { autoAlpha: 1, y: 0, duration: 0.3 },
    3.85,
  )
  .to("#button-glow", { autoAlpha: 1, duration: 0.2 }, 4.25)
  .to("#button-glow", { autoAlpha: 0, duration: 0.18 }, 4.78)
  .to("#accepted", { autoAlpha: 1, duration: 0.12 }, 4.8)
  .to("#phone", { y: -13, scale: 1.018, duration: 1.2 }, 4.8)
  .to("#reply-title", { autoAlpha: 0, y: -20, duration: 0.23 }, 7.5)
  .fromTo(
    "#project-title",
    { y: 25 },
    { autoAlpha: 1, y: 0, duration: 0.32 },
    7.75,
  )
  .to("#project", { autoAlpha: 1, duration: 0.18 }, 7.8)
  .to("#phone", { y: 0, scale: 1, duration: 0.5 }, 7.8)
  .to("#project-title", { autoAlpha: 0, y: -20, duration: 0.22 }, 9.85)
  .to("#phone", { x: 250, rotation: 3, autoAlpha: 0, duration: 0.5 }, 10)
  .fromTo(
    "#board-title",
    { y: 30 },
    { autoAlpha: 1, y: 0, duration: 0.35 },
    10.05,
  )
  .fromTo(
    "#board",
    { y: 65, scale: 0.94, rotation: -1 },
    { autoAlpha: 1, y: 0, scale: 1, rotation: 0, duration: 0.55 },
    10.15,
  )
  .to("#board", { scale: 1.025, duration: 1.4 }, 10.7)
  .to("#end", { autoAlpha: 1, duration: 0.35 }, 12.15)
  .fromTo("#end h1", { y: 35 }, { y: 0, duration: 0.5 }, 12.2)
  .fromTo(
    "#end .cta",
    { y: 20, autoAlpha: 0 },
    { y: 0, autoAlpha: 1, duration: 0.45 },
    12.45,
  )
  .to(".timeline i", { scaleX: 1, duration: 15, ease: "none" }, 0);
