import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ToolError } from "./types.ts";

const USER_AGENT = "HistoryOfIdeas-FactChecker/0.1 (source verification; non-commercial research)";
const MAX_REDIRECTS = 5;

export interface FetchedResource {
  finalUrl: string;
  status: number;
  contentType: string;
  body: Uint8Array;
}

/**
 * Fetch a URL the model asked for. Model-chosen URLs are untrusted, so this:
 * - allows only http(s), and resolves every hop's host to reject private,
 *   loopback and link-local addresses (no reaching Neo4j or other local services);
 * - follows redirects manually so each hop is checked;
 * - enforces a timeout and a size cap.
 * (DNS can change between the check and the connection; for stronger isolation
 * run the agent where it has no route to internal networks.)
 */
export async function safeFetch(
  url: string,
  opts: { signal: AbortSignal; maxBytes?: number; timeoutMs?: number; accept?: string },
): Promise<FetchedResource> {
  const maxBytes = opts.maxBytes ?? 25 * 1024 * 1024;
  const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs ?? 30_000)]);
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = parseHttpUrl(current);
    await assertPublicHost(parsed.hostname);

    const res = await fetchWithRetry(parsed, signal, opts.accept);

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, parsed).toString();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new ToolError(`${current} returned HTTP ${res.status}. If this is a source, try another copy (find_archived_copy, the DOI, or a repository).`);
    }

    return {
      finalUrl: current,
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      body: await readCapped(res, maxBytes, current),
    };
  }
  throw new ToolError(`too many redirects fetching ${url}`);
}

const RETRYABLE = new Set([429, 502, 503, 504]);

/** One hop, retrying rate limits and transient server errors (bounded, honouring Retry-After up to 10 s). */
async function fetchWithRetry(url: URL, signal: AbortSignal, accept?: string, attempts = 3): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal,
        headers: { "user-agent": USER_AGENT, accept: accept ?? "text/html,application/pdf,application/xhtml+xml,*/*;q=0.8" },
      });
    } catch (e) {
      if (signal.aborted || attempt >= attempts) throw new ToolError(`could not fetch ${url}: ${(e as Error).message}`);
      await sleep(1000 * attempt, signal);
      continue;
    }
    if (!RETRYABLE.has(res.status) || attempt >= attempts) return res;
    await res.body?.cancel();
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 2000 * attempt, signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), reject(signal.reason)), { once: true });
  });
}

function parseHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ToolError(`not a valid URL: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new ToolError(`only http(s) URLs are allowed: ${raw}`);
  if (u.username || u.password) throw new ToolError("URLs with credentials are not allowed");
  return u;
}

async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  } catch {
    throw new ToolError(`could not resolve host ${hostname}`);
  }
  if (addresses.some(isPrivateAddress)) throw new ToolError(`refusing to fetch from a private or local address (${hostname})`);
}

export function isPrivateAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return isPrivateAddress(mapped[1]);

  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || /^ff/.test(v6);
}

async function readCapped(res: Response, maxBytes: number, url: string): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new ToolError(`${url} is larger than ${Math.round(maxBytes / 1e6)} MB`);
    chunks.push(chunk);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** Fetch and parse JSON from a fixed, known API (Crossref, Europe PMC, Internet Archive). */
export async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await safeFetch(url, { signal, accept: "application/json", maxBytes: 5 * 1024 * 1024 });
  try {
    return JSON.parse(new TextDecoder().decode(res.body));
  } catch {
    throw new ToolError(`${url} did not return JSON`);
  }
}
