/* One seekable timeline: the desktop conversation is the very same DOM on the phone. */
const wide = document.getElementById("film").classList.contains("wide");
const phoneX = wide ? 1250 : 574;
const tl = gsap.timeline({ paused: true, defaults: { ease: "power2.inOut" } });
tl.fromTo(
  "#device",
  { y: 22, opacity: 0 },
  { y: 0, opacity: 1, duration: 0.35 },
  0,
)
  .fromTo(
    "#desktop-title",
    { y: 16, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.3 },
    0,
  )
  .fromTo("#mouse", { x: 40, y: 30 }, { x: 0, y: 0, duration: 0.28 }, 0.22)
  .to(
    "#start-agent",
    { backgroundColor: "#00f28a", scale: 0.98, duration: 0.12 },
    0.55,
  )
  .fromTo(
    "#sidebar .selected",
    { opacity: 0, height: 0, minHeight: 0, paddingTop: 0, paddingBottom: 0 },
    {
      opacity: 1,
      height: 81,
      minHeight: 78,
      paddingTop: 18,
      paddingBottom: 18,
      duration: 0.18,
    },
    0.85,
  )
  .set("#working-count", { textContent: "3" }, 0.85)
  .to("#launch", { opacity: 0, duration: 0.18 }, 0.85)
  .set("#launch", { visibility: "hidden" }, 1.03)
  .to(
    ".working",
    { opacity: 0.35, duration: 0.32, repeat: 3, yoyo: true },
    0.15,
  )
  .to("#desktop-title", { opacity: 0, y: -20, duration: 0.22 }, 1.35)
  .to(
    "#device",
    {
      left: phoneX,
      top: 194,
      width: 442,
      height: 774,
      borderRadius: 30,
      duration: 0.65,
    },
    1.5,
  )
  .to("#sidebar", { width: 0, opacity: 0, duration: 0.5 }, 1.5)
  .to("#browser", { opacity: 0, duration: 0.25 }, 1.5)
  .to("#phone-status, #home-indicator", { opacity: 1, duration: 0.2 }, 1.9)
  .to("#app", { top: 36, bottom: 24, duration: 0.4 }, 1.65)
  .set(".back", { display: "inline" }, 1.9)
  .fromTo(
    "#mobile-title",
    { y: 20, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.3 },
    1.65,
  )
  .to("#handoff", { opacity: 1, duration: 0.25 }, 1.9)
  .to("#approval, #question-badge", { opacity: 1, duration: 0.25 }, 2.7)
  .to("#working-badge", { opacity: 0, duration: 0.2 }, 2.7)
  .fromTo(
    "#thumb",
    { x: wide ? phoneX - 574 + 100 : 100, y: 120, opacity: 0 },
    { x: phoneX - 574, y: 0, opacity: 1, duration: 0.45 },
    3.8,
  )
  .to("#thumb", { y: -12, duration: 0.15 }, 4.35)
  .to(
    "#approve-button",
    { backgroundColor: "#00f28a", scale: 0.97, duration: 0.12 },
    4.4,
  )
  .set("#tap", { left: phoneX + 218 }, 4.4)
  .fromTo(
    "#tap",
    { opacity: 0.9, scale: 0.4 },
    { opacity: 0, scale: 1.6, duration: 0.5, immediateRender: false },
    4.4,
  )
  .to(
    "#thumb",
    { x: phoneX - 574 + 130, y: 170, opacity: 0, duration: 0.4 },
    4.65,
  )
  .to("#approval", { opacity: 0, duration: 0.16 }, 4.8)
  .to("#approved", { opacity: 1, duration: 0.2 }, 4.95)
  .to("#question-badge", { opacity: 0, duration: 0.15 }, 4.95)
  .to("#working-badge", { opacity: 1, duration: 0.15 }, 4.95)
  .fromTo(".run-line", { scaleX: 0.1 }, { scaleX: 1, duration: 1.1 }, 5)
  .to("#mobile-title, #handoff", { opacity: 0, duration: 0.2 }, 6.25)
  .to("#conversation", { opacity: 0, duration: 0.2 }, 6.4)
  .to("#project", { opacity: 1, duration: 0.2 }, 6.4)
  .fromTo(
    "#project-title",
    { y: 18, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.3 },
    6.4,
  )
  .fromTo(
    ".task",
    { y: 15, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.3, stagger: 0.08 },
    6.5,
  )
  .to("#tested-button", { backgroundColor: "#00f28a22", duration: 0.2 }, 8)
  .to("#tested-feedback", { opacity: 1, duration: 0.2 }, 8.2)
  .to("#project-title, #project", { opacity: 0, duration: 0.2 }, 9.2)
  .to("#machines", { opacity: 1, duration: 0.2 }, 9.35)
  .fromTo(
    "#machines-title",
    { y: 18, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.3 },
    9.35,
  )
  .fromTo(
    ".machine-content .agent",
    { x: 20, opacity: 0 },
    { x: 0, opacity: 1, stagger: 0.12, duration: 0.3 },
    9.5,
  )
  .to("#end", { opacity: 1, duration: 0.3 }, 12.1)
  .fromTo("#end h1", { y: 20 }, { y: 0, duration: 0.4 }, 12.15)
  .to(".timeline i", { scaleX: 1, duration: 15, ease: "none" }, 0);
