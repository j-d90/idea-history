export type Category =
  | "technology"
  | "philosophy"
  | "religion"
  | "politics"
  | "science"
  | "mathematics"
  | "economics";

export interface Idea {
  id: string;
  /** Negative years are BCE. */
  year: number;
  /** Date is approximate ("c."). */
  approx?: boolean;
  title: string;
  /** Who / where, shown as a short byline. */
  origin: string;
  summary: string;
  category: Category;
  /** Ids of earlier ideas this one builds on. */
  buildsOn?: string[];
}

export interface Era {
  id: string;
  name: string;
  start: number;
  end: number;
  blurb: string;
}
