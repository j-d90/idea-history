import type { ManagedTransaction } from "neo4j-driver";
import type { z } from "zod/v4";
import type { Bibliography } from "../../../src/content/schema.ts";
import type { EvidenceLedger } from "../../core/evidence.ts";
import type { Citation } from "../../core/sources.ts";

/**
 * A type of observation the gatherer can collect. Each type supplies its own
 * guidance (what counts, how to date it), its item schema, its checks, and how
 * accepted items are written to the graph. The gatherer's loop, source rules and
 * evidence checks are shared.
 */
export interface ObservationType<I = unknown> {
  /** Plural name used on the command line, e.g. "events". */
  name: string;
  /** Singular noun for prompts and messages, e.g. "event". */
  noun: string;
  /** Markdown guidance appended to the gatherer's prompt. */
  guidance: string;
  /** Strict zod (v4) schema for one item. */
  item: z.ZodType<I>;
  /** A short label for an item in messages. */
  describe(item: I): string;
  citations(item: I): Citation[];
  /** Type-specific checks. */
  check(item: I, at: string, ctx: CheckContext): string[];
  /** Write accepted items; returns what changed. */
  write(tx: ManagedTransaction, items: I[], ctx: WriteContext): Promise<WriteResult>;
}

export interface CheckContext {
  from: number;
  to: number;
  evidence: EvidenceLedger;
  /** Ids of existing nodes of this type. */
  exists: (id: string) => boolean;
  entityExists: (id: string) => boolean;
}

export interface WriteContext {
  runId: string;
  /** The existing bibliography plus the sources registered by this run. */
  bibliography: Bibliography;
}

export interface WriteResult {
  created: string[];
  updated: string[];
  entities: number;
}
