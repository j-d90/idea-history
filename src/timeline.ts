import type { Era, EventKind, EventNotes, EventSummary as Event, TimelineIndex } from "./types";
import { escapeHtml as esc, eventKindLabels, formatRange, formatYear, statusLabels } from "./format";

// The timeline renders progressively: era by era, a batch of events at a time,
// as the reader nears the bottom. Each era's events are fetched when it's
// reached, and an event's notes only when they're opened.

/** Events added to the page per batch. */
const BATCH = 80;

/** DOM id of an event (see anchorOf in scripts/render.ts). */
const eventAnchor = (id: string) => `event-${id}`;

/** The year column: deep-time dates put "years ago" on a second line so they fit. */
function yearHtml(year: number, approx: boolean): string {
  const text = formatYear(year, approx);
  return text.endsWith(" years ago") ? `${esc(text.slice(0, -" years ago".length))}<span class="year-unit">years ago</span>` : esc(text);
}

function statusText(e: Event): string {
  if (e.status === "reviewed" && e.review) return `Reviewed by the ${esc(e.review.by)} agent on ${e.review.date}: every claim independently re-researched.`;
  if (e.status === "checked" && e.review)
    return `Checked by the ${esc(e.review.by)} agent on ${e.review.date}: its claims match the quoted excerpts, which were re-verified against the sources.`;
  return e.status === "sourced" ? "Sourced, awaiting a check." : "Unverified draft.";
}

function renderEvent(e: Event, era: string): string {
  const d = e.date;
  const dateDetail = d.marks || d.note || d.earliest !== undefined || d.latest !== undefined;
  return `
    <article class="entry event" id="${eventAnchor(e.id)}" data-kind="${e.kind}" data-status="${e.status}" data-year="${d.year}">
      <div class="idea-year"${dateDetail ? ` title="${esc(e.dateText)}"` : ""}>
        ${yearHtml(d.year, d.approx)}${dateDetail ? `<span class="idea-year-mark" aria-hidden="true">*</span>` : ""}
      </div>
      <div class="event-node" aria-hidden="true"></div>
      <div class="event-body">
        <div class="idea-meta">
          <span>${eventKindLabels[e.kind]}</span>
          <span class="event-place">${esc(e.place)}</span>
          <span class="status status-${e.status}">${statusLabels[e.status]}</span>
        </div>
        <h3 class="event-title">${esc(e.title)}</h3>
        <p class="event-summary">${esc(e.summary)}</p>
        ${
          e.hasNotes
            ? `<details class="idea-details" data-era="${era}" data-id="${e.id}">
                 <summary>Notes &amp; sources</summary>
                 <dl class="idea-facts">
                   <dt>Date</dt><dd>${esc(e.dateText)}</dd>
                   <dt>Status</dt><dd>${statusText(e)}</dd>
                 </dl>
                 <div class="notes" aria-live="polite"><p class="notes-loading">Loading…</p></div>
               </details>`
            : ""
        }
      </div>
    </article>`;
}

function renderNotes(id: string, n: EventNotes): string {
  const anchor = eventAnchor(id);
  return `
    ${n.bodyHtml ? `<div class="prose">${n.bodyHtml}</div>` : ""}
    ${
      n.references.length
        ? `<h4 class="refs-title">References</h4>
           <ol class="refs">${n.references.map((r) => `<li id="ref-${anchor}-${r.key}">${r.html}</li>`).join("")}</ol>`
        : ""
    }`;
}

function renderEraHeader(era: Era): string {
  return `
    <section class="era" id="era-${era.id}" data-year="${era.start}">
      <header class="era-header">
        <span class="era-range">${formatRange(era.start, era.end)}</span>
        <h2 class="era-name">${era.name}</h2>
        <p class="era-blurb">${era.blurb}</p>
      </header>
      <div class="era-ideas"></div>
    </section>`;
}

export function renderFilters(kinds: EventKind[]): string {
  const all = `<button class="filter is-active" data-filter="all">All</button>`;
  return all + kinds.map((k) => `<button class="filter" data-filter="${k}">${eventKindLabels[k]}</button>`).join("");
}

export interface Timeline {
  setFilter(kind: string): void;
}

/**
 * Render the timeline into `root`, filling more whenever `sentinel` (placed
 * after it) comes within a couple of screens of the viewport.
 */
export function createTimeline(o: {
  root: HTMLElement;
  sentinel: HTMLElement;
  eras: Era[];
  index: TimelineIndex;
  eraLoaders: Record<string, () => Promise<{ events: Event[] }>>;
  notesLoaders: Record<string, () => Promise<{ notes: Record<string, EventNotes> }>>;
  onRender: (added: HTMLElement[]) => void;
}): Timeline {
  const eras = o.eras.filter((e) => o.index.eras[e.id]);
  const loaded = new Map<string, Promise<Event[]>>();
  const loadEra = (id: string) => loaded.get(id) ?? loaded.set(id, o.eraLoaders[id]().then((m) => [...m.events].sort((a, b) => a.date.year - b.date.year))).get(id)!;

  let filter = "all";
  let generation = 0;
  let eraPos = 0;
  let itemPos = 0;
  let current: { events: Event[]; list: HTMLElement } | undefined;
  let filling = false;

  const nearBottom = () => o.sentinel.getBoundingClientRect().top < window.innerHeight * 3;

  async function fill(): Promise<void> {
    if (filling) return;
    filling = true;
    const gen = generation;
    try {
      while (gen === generation && nearBottom() && eraPos < eras.length) {
        if (!current) {
          const era = eras[eraPos];
          const events = (await loadEra(era.id)).filter((e) => filter === "all" || e.kind === filter);
          if (gen !== generation) return;
          if (!events.length) {
            eraPos++;
            continue;
          }
          o.root.insertAdjacentHTML("beforeend", renderEraHeader(era));
          const section = o.root.lastElementChild as HTMLElement;
          current = { events, list: section.querySelector(".era-ideas")! };
          o.onRender([section.querySelector<HTMLElement>(".era-header")!, section]);
        }
        const batch = current.events.slice(itemPos, itemPos + BATCH);
        current.list.insertAdjacentHTML("beforeend", batch.map((e) => renderEvent(e, eras[eraPos].id)).join(""));
        o.onRender(Array.from(current.list.children).slice(-batch.length) as HTMLElement[]);
        itemPos += batch.length;
        if (itemPos >= current.events.length) {
          current = undefined;
          itemPos = 0;
          eraPos++;
        }
        // Let the browser lay out the batch before measuring again.
        await new Promise(requestAnimationFrame);
      }
    } finally {
      filling = false;
      // A filter change during this pass starts a fresh one.
      if (gen !== generation) void fill();
    }
  }

  new IntersectionObserver(() => void fill(), { rootMargin: "0px 0px 200% 0px" }).observe(o.sentinel);

  // Notes load the first time they're opened ("toggle" doesn't bubble, so listen in the capture phase).
  o.root.addEventListener(
    "toggle",
    async (ev) => {
      const details = ev.target as HTMLDetailsElement;
      if (!details.open || details.dataset.loaded) return;
      details.dataset.loaded = "1";
      const box = details.querySelector<HTMLElement>(".notes")!;
      try {
        const { notes } = await o.notesLoaders[details.dataset.era!]();
        const n = notes[details.dataset.id!];
        box.innerHTML = n ? renderNotes(details.dataset.id!, n) : "";
      } catch {
        delete details.dataset.loaded;
        box.innerHTML = `<p class="notes-loading">Couldn't load the notes. Close and reopen to try again.</p>`;
      }
    },
    true,
  );

  void fill();
  return {
    setFilter(kind: string) {
      filter = kind;
      generation++;
      eraPos = 0;
      itemPos = 0;
      current = undefined;
      o.root.innerHTML = "";
      void fill();
    },
  };
}

/** Fade entries in as they enter the viewport. */
export function createReveal(): (els: HTMLElement[]) => void {
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
  return (els) => els.filter((el) => el.matches(".entry, .era-header")).forEach((el) => io.observe(el));
}

/** Keep the header's year readout in sync with whatever is at the top of the viewport. */
export function trackCurrentYear(root: HTMLElement, out: HTMLElement): void {
  let ticking = false;
  const update = () => {
    ticking = false;
    const line = window.innerHeight * 0.35;
    // Binary search over the rendered rows, which are in year order.
    const marks = root.querySelectorAll<HTMLElement>(".entry");
    let lo = 0;
    let hi = marks.length - 1;
    let found: HTMLElement | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (marks[mid].getBoundingClientRect().top <= line) {
        found = marks[mid];
        lo = mid + 1;
      } else hi = mid - 1;
    }
    out.textContent = found ? formatYear(Number(found.dataset.year)) : "";
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
