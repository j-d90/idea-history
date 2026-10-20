import type { Category, IdeaDate, Source, Status } from "./types";

export function formatYear(year: number, approx = false): string {
  const prefix = approx ? "c. " : "";
  if (year < 0) return `${prefix}${Math.abs(year).toLocaleString("en-US")} BCE`;
  if (year < 1000) return `${prefix}${year} CE`;
  return `${prefix}${year}`;
}

export function formatRange(start: number, end: number): string {
  const now = new Date().getFullYear();
  const endLabel = end > now ? "Present" : formatYear(end);
  return `${formatYear(start)} — ${endLabel}`;
}

/** Longer description of a date's uncertainty, for tooltips. */
export function describeDate(date: IdeaDate): string {
  const parts: string[] = [];
  if (date.earliest !== undefined || date.latest !== undefined) {
    const lo = formatYear(date.earliest ?? date.year);
    const hi = formatYear(date.latest ?? date.year);
    parts.push(`Estimates range ${lo} – ${hi}.`);
  }
  if (date.note) parts.push(date.note);
  return parts.join(" ");
}

export function formatSource(s: Source): string {
  const year = s.year !== undefined ? ` (${escapeHtml(String(s.year))})` : "";
  const text = [
    s.author ? `${escapeHtml(s.author)}${year}.` : null,
    `<cite>${escapeHtml(s.title)}</cite>${s.author ? "" : year}.`,
    s.publisher ? `${escapeHtml(s.publisher)}.` : null,
    s.locator ? `${escapeHtml(s.locator)}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return s.url
    ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${text}</a>`
    : text;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const categoryLabels: Record<Category, string> = {
  technology: "Technology",
  philosophy: "Philosophy",
  religion: "Religion",
  politics: "Politics & Law",
  science: "Science",
  mathematics: "Mathematics",
  economics: "Economics",
};

export const statusLabels: Record<Status, string> = {
  draft: "Unverified",
  sourced: "Sourced",
  reviewed: "Reviewed",
};
