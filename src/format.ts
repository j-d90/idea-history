import type { Category, EmergenceStage, EventKind, Status } from "./types";

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

export const stageLabels: Record<EmergenceStage, string> = {
  "earliest-evidence": "Earliest evidence",
  articulation: "Articulated",
  institutionalization: "Institutionalized",
  spread: "Spread",
};

export const statusLabels: Record<Status, string> = {
  candidate: "Candidate",
  draft: "Unverified",
  sourced: "Sourced",
  reviewed: "Reviewed",
};
