/** A span of years, inclusive. Negative years are BCE. */
export interface Period {
  from: number;
  to: number;
}

/** "2500bce-2400bce", for run ids. */
export const periodSlug = ({ from, to }: Period) => [from, to].map((y) => (y < 0 ? `${-y}bce` : `${y}ce`)).join("-");
