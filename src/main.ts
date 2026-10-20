import "./style.css";
import { eraLoaders, index, notesLoaders } from "virtual:events";
import { eras } from "./data/eras";
import { formatYear } from "./format";
import { createReveal, createTimeline, renderFilters, trackCurrentYear } from "./timeline";

const span = new Date().getFullYear() - index.start;
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
      <p class="eyebrow">${formatYear(index.start, true)} — Present</p>
      <h1>What happened,<br />and how we know.</h1>
      <p class="lede">
        A timeline of recorded events, from the first stone tools to the present.
        Every entry quotes the sources it rests on.
      </p>
      <dl class="stats">
        <div><dt>Years</dt><dd>${span.toLocaleString("en-US")}</dd></div>
        <div><dt>Events</dt><dd>${index.total.toLocaleString("en-US")}</dd></div>
        <div><dt>Checked</dt><dd>${index.checked.toLocaleString("en-US")}<span class="stats-of">/${index.total.toLocaleString("en-US")}</span></dd></div>
      </dl>
    </section>

    <nav class="filters" aria-label="Filter by kind of event">
      <div class="filters-inner">${renderFilters(index.kinds)}</div>
    </nav>

    <div class="timeline" id="timeline"></div>
    <div class="timeline-end" id="timeline-end" aria-hidden="true"></div>

    <footer class="footer">
      <p>History of Ideas · A work in progress</p>
    </footer>
  </main>
`;

const root = document.querySelector<HTMLElement>("#timeline")!;
const timeline = createTimeline({
  root,
  sentinel: document.querySelector<HTMLElement>("#timeline-end")!,
  eras,
  index,
  eraLoaders,
  notesLoaders,
  onRender: createReveal(),
});
trackCurrentYear(root, document.querySelector<HTMLElement>("#current-year")!);

const filterButtons = document.querySelectorAll<HTMLButtonElement>(".filter");
filterButtons.forEach((btn) =>
  btn.addEventListener("click", () => {
    filterButtons.forEach((b) => b.classList.toggle("is-active", b === btn));
    timeline.setFilter(btn.dataset.filter!);
  }),
);
