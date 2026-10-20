import type { Category, Era, LinkType, RenderedIdea as Idea } from "./types";
import { categoryLabels, escapeHtml as esc, formatRange, formatYear, statusLabels } from "./format";

const byId = (ideas: Idea[]) => new Map(ideas.map((i) => [i.id, i]));

function renderDetails(idea: Idea): string {
  if (!idea.bodyHtml && !idea.references.length) return "";

  const review = idea.review
    ? `Reviewed by the ${esc(idea.review.by)} agent on ${idea.review.date}.`
    : idea.status === "sourced"
      ? "Sourced, awaiting independent review."
      : "Unverified draft.";

  return `
    <details class="idea-details">
      <summary>Notes &amp; sources</summary>
      <dl class="idea-facts">
        <dt>Date</dt><dd>${esc(idea.dateText)}</dd>
        <dt>Status</dt><dd>${review}</dd>
      </dl>
      ${idea.bodyHtml ? `<div class="prose">${idea.bodyHtml}</div>` : ""}
      ${
        idea.references.length
          ? `<h4 class="refs-title">References</h4>
             <ol class="refs">${idea.references.map((r) => `<li id="ref-${idea.id}-${r.key}">${r.html}</li>`).join("")}</ol>`
          : ""
      }
    </details>`;
}

const LINK_LABELS: Record<LinkType, string> = {
  BUILDS_ON: "Builds on",
  REACTS_AGAINST: "Reacts against",
  PARALLELS: "Parallels",
};

const LINK_STATUS: Record<string, string> = {
  seed: "Unverified link from the original placeholder content",
  linker: "Proposed by the linker agent with cited evidence; not yet reviewed",
};

function renderLinks(idea: Idea, lookup: Map<string, Idea>): string {
  return (Object.keys(LINK_LABELS) as LinkType[])
    .map((type) => {
      const chips = idea.links
        .filter((l) => l.type === type && lookup.has(l.to))
        .map((l) => {
          const status = l.status === "reviewed" ? "Reviewed" : LINK_STATUS[l.origin];
          const title = [l.why, status].filter(Boolean).join(" · ");
          return `<a class="chip chip-${l.status === "reviewed" ? "reviewed" : l.origin}" href="#${l.to}" title="${esc(title)}">${esc(lookup.get(l.to)!.title)}</a>`;
        })
        .join("");
      return chips ? `<div class="idea-links"><span class="idea-links-label">${LINK_LABELS[type]}</span>${chips}</div>` : "";
    })
    .join("");
}

function renderIdea(idea: Idea, lookup: Map<string, Idea>): string {
  const links = renderLinks(idea, lookup);

  const d = idea.date;
  const dateDetail = d.marks || d.note || d.earliest !== undefined || d.latest !== undefined;

  return `
    <article class="idea" id="${idea.id}" data-category="${idea.category}" data-status="${idea.status}" data-year="${d.year}">
      <div class="idea-year"${dateDetail ? ` title="${esc(idea.dateText)}"` : ""}>
        ${formatYear(d.year, d.approx)}${dateDetail ? `<span class="idea-year-mark" aria-hidden="true">*</span>` : ""}
      </div>
      <div class="idea-node" aria-hidden="true"></div>
      <div class="idea-card">
        <div class="idea-meta">
          <span class="cat-dot cat-${idea.category}"></span>
          <span>${categoryLabels[idea.category]}</span>
          <span class="status status-${idea.status}">${statusLabels[idea.status]}</span>
        </div>
        <h3 class="idea-title">${esc(idea.title)}</h3>
        <p class="idea-origin">${esc(idea.origin)}</p>
        <p class="idea-summary">${esc(idea.summary)}</p>
        ${links}
        ${renderDetails(idea)}
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
  const sorted = [...ideas].sort((a, b) => a.date.year - b.date.year);
  const lookup = byId(sorted);
  return eras
    .map((era) =>
      renderEra(
        era,
        sorted.filter((i) => i.date.year >= era.start && i.date.year < era.end),
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
