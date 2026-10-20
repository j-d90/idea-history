import "./style.css";
import { events } from "virtual:events";
import { eras } from "./data/eras";
import { formatYear } from "./format";
import { observeReveal, renderFilters, renderTimeline, trackCurrentYear } from "./timeline";

const kinds = [...new Set(events.map((e) => e.kind))];
const start = events.length ? Math.min(...events.map((e) => e.date.year)) : -3200;
const span = new Date().getFullYear() - start;
const checked = events.filter((e) => e.status === "checked" || e.status === "reviewed").length;

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
      <h1>What happened,<br />and how we know.</h1>
      <p class="lede">
        A timeline of recorded events, from the first marks pressed into clay to the present.
        Every entry quotes the sources it rests on.
      </p>
      <dl class="stats">
        <div><dt>Years</dt><dd>${span.toLocaleString("en-US")}</dd></div>
        <div><dt>Events</dt><dd>${events.length}</dd></div>
        <div><dt>Checked</dt><dd>${checked}<span class="stats-of">/${events.length}</span></dd></div>
      </dl>
    </section>

    <nav class="filters" aria-label="Filter by kind of event">
      <div class="filters-inner">${renderFilters(kinds)}</div>
    </nav>

    <div class="timeline" id="timeline">
      ${renderTimeline(eras, events)}
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
      el.hidden = f !== "all" && el.dataset.kind !== f;
    });
    timeline.querySelectorAll<HTMLElement>(".era").forEach((era) => {
      era.classList.toggle("is-empty", !era.querySelector(".entry:not([hidden])"));
    });
  }),
);

// Briefly highlight an event when jumped to by link
window.addEventListener("hashchange", () => {
  const el = document.getElementById(location.hash.slice(1));
  if (!el?.classList.contains("entry")) return;
  el.hidden = false;
  el.closest(".era")?.classList.remove("is-empty");
  el.classList.add("is-visible", "is-flash");
  el.scrollIntoView({ block: "center" });
  setTimeout(() => el.classList.remove("is-flash"), 1600);
});
