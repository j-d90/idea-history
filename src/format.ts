import type { EventKind, Status } from "./types";

/**
 * Before this year, dates read as "years ago", as the sources state them
 * ("about 73,000 years ago"). Agents store "N years ago" as year −N, so the two
 * convert exactly; the 2,000-year offset from BCE is within the uncertainty of
 * dates this old.
 */
export const YEARS_AGO_BEFORE = -50_000;

/** "3.4 million years ago", "73,000 years ago". */
export function yearsAgo(year: number): string {
  const ago = -year;
  if (ago >= 1_000_000) return `${(ago / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 3 })} million years ago`;
  const step = ago >= 100_000 ? 1000 : 100;
  return `${(Math.round(ago / step) * step).toLocaleString("en-US")} years ago`;
}

export function formatYear(year: number, approx = false): string {
  const prefix = approx ? "c. " : "";
  if (year < YEARS_AGO_BEFORE) return `${prefix}${yearsAgo(year)}`;
  if (year < 0) return `${prefix}${Math.abs(year).toLocaleString("en-US")} BCE`;
  if (year < 1000) return `${prefix}${year} CE`;
  return `${prefix}${year}`;
}

export function formatRange(start: number, end: number): string {
  const now = new Date().getFullYear();
  const endLabel = end > now ? "Present" : formatYear(end);
  // "4 million — 300,000 years ago" rather than repeating "years ago".
  if (start < YEARS_AGO_BEFORE && end <= YEARS_AGO_BEFORE) return `${yearsAgo(start).replace(" years ago", "")} — ${yearsAgo(end)}`;
  return `${formatYear(start)} — ${endLabel}`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const eventKindLabels: Record<EventKind, string> = {
  political: "Political",
  military: "Military",
  legal: "Law",
  religious: "Religious",
  cultural: "Cultural",
  economic: "Economic",
  technological: "Technology",
  scientific: "Science",
  construction: "Construction",
  migration: "Migration",
  environmental: "Environment",
};

export const statusLabels: Record<Status, string> = {
  candidate: "Candidate",
  draft: "Unverified",
  sourced: "Sourced",
  checked: "Checked",
  reviewed: "Reviewed",
};
