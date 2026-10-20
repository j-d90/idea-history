import type { Category, Era, LinkType, RenderedEvent as Event, RenderedIdea as Idea } from "./types";
import { categoryLabels, escapeHtml as esc, eventKindLabels, formatRange, formatYear, stageLabels, statusLabels } from "./format";

interface Lookup {
  ideas: Map<string, Idea>;
  events: Map<string, Event>;
}

/** DOM id of an event (ideas use their own id; see scripts/render.ts). */
const eventAnchor = (id: string) => `event-${id}`;

function renderDetails(idea: Idea | Event, anchor: string): string {
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
             <ol class="refs">${idea.references.map((r) => `<li id="ref-${anchor}-${r.key}">${r.html}</li>`).join("")}</ol>`
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

const EMERGENCE_STATUS = "Identified by the interpreter agent with cited evidence; not yet reviewed";

function chipRow(label: string, chips: string): string {
  return chips ? `<div class="idea-links"><span class="idea-links-label">${label}</span>${chips}</div>` : "";
}

function renderLinks(idea: Idea, lookup: Lookup): string {
  const emerged = idea.emergesIn
    .filter((e) => lookup.events.has(e.event))
    .map((e) => {
      const ev = lookup.events.get(e.event)!;
      const title = [`${stageLabels[e.stage]}: ${e.why}`, e.status === "reviewed" ? "Reviewed" : EMERGENCE_STATUS].join(" · ");
      return `<a class="chip chip-event chip-${e.status === "reviewed" ? "reviewed" : "linker"}" href="#${eventAnchor(e.event)}" title="${esc(title)}">${esc(ev.title)}, ${formatYear(ev.date.year, ev.date.approx)}</a>`;
    })
    .join("");
  const typed = (Object.keys(LINK_LABELS) as LinkType[]).map((type) =>
    chipRow(
      LINK_LABELS[type],
      idea.links
        .filter((l) => l.type === type && lookup.ideas.has(l.to))
        .map((l) => {
          const status = l.status === "reviewed" ? "Reviewed" : LINK_STATUS[l.origin];
          const title = [l.why, status].filter(Boolean).join(" · ");
          return `<a class="chip chip-${l.status === "reviewed" ? "reviewed" : l.origin}" href="#${l.to}" title="${esc(title)}">${esc(lookup.ideas.get(l.to)!.title)}</a>`;
        })
        .join(""),
    ),
  );
  return chipRow("Seen in", emerged) + typed.join("");
}

function renderEvent(event: Event, lookup: Lookup): string {
  const d = event.date;
  const dateDetail = d.marks || d.note || d.earliest !== undefined || d.latest !== undefined;
  const ideas = event.ideas
    .filter((e) => lookup.ideas.has(e.idea))
    .map((e) => {
      const title = [`${stageLabels[e.stage]}: ${e.why}`, e.status === "reviewed" ? "Reviewed" : EMERGENCE_STATUS].join(" · ");
      return `<a class="chip chip-${e.status === "reviewed" ? "reviewed" : "linker"}" href="#${e.idea}" title="${esc(title)}">${esc(lookup.ideas.get(e.idea)!.title)}</a>`;
    })
    .join("");

  return `
    <article class="entry event" id="${eventAnchor(event.id)}" data-kind="${event.kind}" data-status="${event.status}" data-year="${d.year}">
      <div class="idea-year"${dateDetail ? ` title="${esc(event.dateText)}"` : ""}>
        ${formatYear(d.year, d.approx)}${dateDetail ? `<span class="idea-year-mark" aria-hidden="true">*</span>` : ""}
      </div>
      <div class="event-node" aria-hidden="true"></div>
      <div class="event-body">
        <div class="idea-meta">
          <span>${eventKindLabels[event.kind]}</span>
          <span class="event-place">${esc(event.place)}</span>
          <span class="status status-${event.status}">${statusLabels[event.status]}</span>
        </div>
        <h3 class="event-title">${esc(event.title)}</h3>
        <p class="event-summary">${esc(event.summary)}</p>
        ${chipRow("Ideas", ideas)}
        ${renderDetails(event, eventAnchor(event.id))}
      </div>
    </article>`;
}

function renderIdea(idea: Idea, lookup: Lookup): string {
  const links = renderLinks(idea, lookup);

  const d = idea.date;
  const dateDetail = d.marks || d.note || d.earliest !== undefined || d.latest !== undefined;

  return `
    <article class="entry idea" id="${idea.id}" data-category="${idea.category}" data-status="${idea.status}" data-year="${d.year}">
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
        ${renderDetails(idea, idea.id)}
      </div>
    </article>`;
}

type Item = { kind: "idea"; entry: Idea } | { kind: "event"; entry: Event };

function renderEra(era: Era, items: Item[], lookup: Lookup): string {
  return `
    <section class="era" id="era-${era.id}" data-year="${era.start}">
      <header class="era-header">
        <span class="era-range">${formatRange(era.start, era.end)}</span>
        <h2 class="era-name">${era.name}</h2>
        <p class="era-blurb">${era.blurb}</p>
      </header>
      <div class="era-ideas">
        ${items.map((i) => (i.kind === "idea" ? renderIdea(i.entry, lookup) : renderEvent(i.entry, lookup))).join("")}
      </div>
    </section>`;
}

/** Ideas and events on one spine, by year; at the same year, events come first. */
export function renderTimeline(eras: Era[], ideas: Idea[], events: Event[]): string {
  const items: Item[] = [
    ...events.map((entry) => ({ kind: "event" as const, entry })),
    ...ideas.map((entry) => ({ kind: "idea" as const, entry })),
  ].sort((a, b) => a.entry.date.year - b.entry.date.year || (a.kind === b.kind ? 0 : a.kind === "event" ? -1 : 1));
  const lookup: Lookup = { ideas: new Map(ideas.map((i) => [i.id, i])), events: new Map(events.map((e) => [e.id, e])) };
  return eras
    .map((era) =>
      renderEra(
        era,
        items.filter((i) => i.entry.date.year >= era.start && i.entry.date.year < era.end),
        lookup,
      ),
    )
    .join("");
}

export function renderFilters(categories: Category[], hasEvents: boolean): string {
  const all = `<button class="filter is-active" data-filter="all">All</button>` + (hasEvents ? `<button class="filter" data-filter="events"><span class="event-dot"></span>Events</button>` : "");
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
  root.querySelectorAll(".entry, .era-header").forEach((el) => io.observe(el));
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
