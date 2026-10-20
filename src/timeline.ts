import type { Era, EventKind, RenderedEvent as Event } from "./types";
import { escapeHtml as esc, eventKindLabels, formatRange, formatYear, statusLabels } from "./format";

/** DOM id of an event (see anchorOf in scripts/render.ts). */
const eventAnchor = (id: string) => `event-${id}`;

function renderDetails(idea: Event, anchor: string): string {
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

function renderEvent(event: Event): string {
  const d = event.date;
  const dateDetail = d.marks || d.note || d.earliest !== undefined || d.latest !== undefined;

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
        ${renderDetails(event, eventAnchor(event.id))}
      </div>
    </article>`;
}

function renderEra(era: Era, events: Event[]): string {
  return `
    <section class="era" id="era-${era.id}" data-year="${era.start}">
      <header class="era-header">
        <span class="era-range">${formatRange(era.start, era.end)}</span>
        <h2 class="era-name">${era.name}</h2>
        <p class="era-blurb">${era.blurb}</p>
      </header>
      <div class="era-ideas">
        ${events.map(renderEvent).join("")}
      </div>
    </section>`;
}

/** Events by year, grouped into eras; eras with no events are left out. */
export function renderTimeline(eras: Era[], events: Event[]): string {
  const sorted = [...events].sort((a, b) => a.date.year - b.date.year);
  return eras
    .map((era) => ({ era, events: sorted.filter((e) => e.date.year >= era.start && e.date.year < era.end) }))
    .filter((x) => x.events.length)
    .map((x) => renderEra(x.era, x.events))
    .join("");
}

export function renderFilters(kinds: EventKind[]): string {
  const all = `<button class="filter is-active" data-filter="all">All</button>`;
  return all + kinds.map((k) => `<button class="filter" data-filter="${k}">${eventKindLabels[k]}</button>`).join("");
}

/** Fade entries in as they enter the viewport. */
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
