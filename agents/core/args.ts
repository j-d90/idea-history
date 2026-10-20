/**
 * node:util parseArgs reads "-2500" as an option, so join the given options to a
 * following negative number ("--from -2500" → "--from=-2500").
 */
export function joinNegativeValues(argv: string[], options: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (options.includes(argv[i]) && /^-\d/.test(argv[i + 1] ?? "")) out.push(`${argv[i]}=${argv[++i]}`);
    else out.push(argv[i]);
  }
  return out;
}

/** A year: "-2500", "2500bce", "2500 BCE", "44bc", "1200ce", "1200ad" or "1200". Negative is BCE. */
export function parseYear(text: string | undefined): number | undefined {
  const m = /^\s*(-?\d+)\s*(bce|bc|ce|ad)?\s*$/i.exec(text ?? "");
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] && /^b/i.test(m[2]) ? -Math.abs(n) : n;
}
