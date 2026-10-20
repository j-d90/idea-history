import "./style.css";
import { ideas } from "virtual:ideas";
import { eras } from "./data/eras";
import { formatYear } from "./format";
import { observeReveal, renderFilters, renderTimeline, trackCurrentYear } from "./timeline";

const categories = [...new Set(ideas.map((i) => i.category))];
const span = new Date().getFullYear() - Math.min(...ideas.map((i) => i.date.year));
const verified = ideas.filter((i) => i.status !== "draft").length;

const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="#top">
      <span class="brand-mark" aria-hidden="true"></span>
      History of Ideas
    </a>
    <span class="topbar-year" id="current-year"></span>
  </header>

  <main id="top">
    <section class="hero">
      <div class="hero-grid" aria-hidden="true"></div>
      <p class="eyebrow">${formatYear(-3200, true)} — Present</p>
      <h1>The ideas that<br />made the world.</h1>
      <p class="lede">
        A timeline of how human thought has evolved — from the first marks pressed into clay
        to machines that learn — and how each idea built on the ones before it.
      </p>
      <dl class="stats">
        <div><dt>Years</dt><dd>${span.toLocaleString("en-US")}</dd></div>
        <div><dt>Ideas</dt><dd>${ideas.length}</dd></div>
        <div><dt>Eras</dt><dd>${eras.length}</dd></div>
        <div><dt>Sourced</dt><dd>${verified}<span class="stats-of">/${ideas.length}</span></dd></div>
      </dl>
    </section>

    <nav class="filters" aria-label="Filter by category">
      <div class="filters-inner">${renderFilters(categories)}</div>
    </nav>

    <div class="timeline" id="timeline">
      ${renderTimeline(eras, ideas)}
    </div>

    <footer class="footer">
      <p>History of Ideas · A work in progress</p>
    </footer>
  </main>
`;

const timeline = document.querySelector<HTMLElement>("#timeline")!;
observeReveal(timeline);
trackCurrentYear(timeline, document.querySelector<HTMLElement>("#current-year")!);

// Category filtering
const filterButtons = document.querySelectorAll<HTMLButtonElement>(".filter");
filterButtons.forEach((btn) =>
  btn.addEventListener("click", () => {
    const f = btn.dataset.filter!;
    filterButtons.forEach((b) => b.classList.toggle("is-active", b === btn));
    timeline.querySelectorAll<HTMLElement>(".idea").forEach((el) => {
      el.hidden = f !== "all" && el.dataset.category !== f;
    });
    timeline.querySelectorAll<HTMLElement>(".era").forEach((era) => {
      era.classList.toggle("is-empty", !era.querySelector(".idea:not([hidden])"));
    });
  }),
);

// Briefly highlight an idea when jumped to via a "Builds on" link
window.addEventListener("hashchange", () => {
  const el = document.getElementById(location.hash.slice(1));
  if (!el?.classList.contains("idea")) return;
  el.hidden = false;
  el.closest(".era")?.classList.remove("is-empty");
  el.classList.add("is-visible", "is-flash");
  el.scrollIntoView({ block: "center" });
  setTimeout(() => el.classList.remove("is-flash"), 1600);
});
