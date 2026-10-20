import "./style.css";
import { events, ideas } from "virtual:ideas";
import { eras } from "./data/eras";
import { formatYear } from "./format";
import { observeReveal, renderFilters, renderTimeline, trackCurrentYear } from "./timeline";

const categories = [...new Set(ideas.map((i) => i.category))];
const entries = [...events, ...ideas];
const start = Math.min(-3200, ...entries.map((e) => e.date.year));
const span = new Date().getFullYear() - start;
const sourced = entries.filter((e) => e.status !== "draft").length;
const reviewed = entries.filter((e) => e.status === "reviewed").length;

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
      <p class="eyebrow">${formatYear(start, true)} — Present</p>
      <h1>The ideas that<br />made the world.</h1>
      <p class="lede">
        What happened, as the sources record it — from the first marks pressed into clay
        to machines that learn — and the ideas that emerged from it.
      </p>
      <dl class="stats">
        <div><dt>Years</dt><dd>${span.toLocaleString("en-US")}</dd></div>
        <div><dt>Events</dt><dd>${events.length}</dd></div>
        <div><dt>Ideas</dt><dd>${ideas.length}</dd></div>
        <div><dt>Sourced</dt><dd>${sourced}<span class="stats-of">/${entries.length}</span></dd></div>
        <div><dt>Reviewed</dt><dd>${reviewed}<span class="stats-of">/${entries.length}</span></dd></div>
      </dl>
    </section>

    <nav class="filters" aria-label="Filter by category">
      <div class="filters-inner">${renderFilters(categories, events.length > 0)}</div>
    </nav>

    <div class="timeline" id="timeline">
      ${renderTimeline(eras, ideas, events)}
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
    timeline.querySelectorAll<HTMLElement>(".entry").forEach((el) => {
      const isEvent = el.classList.contains("event");
      el.hidden = f === "all" ? false : f === "events" ? !isEvent : isEvent || el.dataset.category !== f;
    });
    timeline.querySelectorAll<HTMLElement>(".era").forEach((era) => {
      era.classList.toggle("is-empty", !era.querySelector(".entry:not([hidden])"));
    });
  }),
);

// Briefly highlight an idea or event when jumped to via a chip
window.addEventListener("hashchange", () => {
  const el = document.getElementById(location.hash.slice(1));
  if (!el?.classList.contains("entry")) return;
  el.hidden = false;
  el.closest(".era")?.classList.remove("is-empty");
  el.classList.add("is-visible", "is-flash");
  el.scrollIntoView({ block: "center" });
  setTimeout(() => el.classList.remove("is-flash"), 1600);
});
