import type { Category, Era, Idea } from "./types";
import { categoryLabels, formatRange, formatYear } from "./format";

const byId = (ideas: Idea[]) => new Map(ideas.map((i) => [i.id, i]));

function renderIdea(idea: Idea, lookup: Map<string, Idea>): string {
  const links = (idea.buildsOn ?? [])
    .map((id) => lookup.get(id))
    .filter((i): i is Idea => !!i)
    .map((i) => `<a class="chip" href="#${i.id}">${i.title}</a>`)
    .join("");

  return `
    <article class="idea" id="${idea.id}" data-category="${idea.category}" data-year="${idea.year}">
      <div class="idea-year">${formatYear(idea.year, idea.approx)}</div>
      <div class="idea-node" aria-hidden="true"></div>
      <div class="idea-card">
        <div class="idea-meta">
          <span class="cat-dot cat-${idea.category}"></span>
          <span>${categoryLabels[idea.category]}</span>
        </div>
        <h3 class="idea-title">${idea.title}</h3>
        <p class="idea-origin">${idea.origin}</p>
        <p class="idea-summary">${idea.summary}</p>
        ${links ? `<div class="idea-links"><span class="idea-links-label">Builds on</span>${links}</div>` : ""}
      </div>
    </article>`;
}

function renderEra(era: Era, ideas: Idea[], lookup: Map<string, Idea>): string {
  return `
    <section class="era" id="era-${era.id}" data-year="${era.start}">
      <header class="era-header">
        <span class="era-range">${formatRange(era.start, era.end)}</span>
        <h2 class="era-name">${era.name}</h2>
        <p class="era-blurb">${era.blurb}</p>
      </header>
      <div class="era-ideas">
        ${ideas.map((i) => renderIdea(i, lookup)).join("")}
      </div>
    </section>`;
}

export function renderTimeline(eras: Era[], ideas: Idea[]): string {
  const sorted = [...ideas].sort((a, b) => a.year - b.year);
  const lookup = byId(sorted);
  return eras
    .map((era) =>
      renderEra(
        era,
        sorted.filter((i) => i.year >= era.start && i.year < era.end),
        lookup,
      ),
    )
    .join("");
}

export function renderFilters(categories: Category[]): string {
  const all = `<button class="filter is-active" data-filter="all">All</button>`;
  const rest = categories
    .map(
      (c) =>
        `<button class="filter" data-filter="${c}"><span class="cat-dot cat-${c}"></span>${categoryLabels[c]}</button>`,
    )
    .join("");
  return all + rest;
}

/** Fade ideas in as they enter the viewport. */
export function observeReveal(root: HTMLElement): void {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("is-visible");
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: "0px 0px -10% 0px" },
  );
  root.querySelectorAll(".idea, .era-header").forEach((el) => io.observe(el));
}

/** Keep the header's year readout in sync with whatever is at the top of the viewport. */
export function trackCurrentYear(root: HTMLElement, out: HTMLElement): void {
  const marks = Array.from(root.querySelectorAll<HTMLElement>("[data-year]"));
  let ticking = false;

  const update = () => {
    ticking = false;
    const line = window.innerHeight * 0.35;
    let current: HTMLElement | undefined;
    for (const m of marks) {
      if (m.offsetParent === null) continue; // hidden by filter
      if (m.getBoundingClientRect().top <= line) current = m;
      else break;
    }
    out.textContent = current ? formatYear(Number(current.dataset.year)) : "";
  };

  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true },
  );
  update();
}
