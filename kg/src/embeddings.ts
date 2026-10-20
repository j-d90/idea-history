import { createHash } from "node:crypto";
import OpenAI from "openai";
import type { Driver } from "neo4j-driver";
import { setEmbedding, staleEmbeddings } from "./repository.ts";

export interface EmbeddingConfig {
  model: string;
  dimensions: number;
}

export function embeddingConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EmbeddingConfig {
  return {
    model: env.EMBEDDING_MODEL ?? "text-embedding-3-large",
    dimensions: Number(env.EMBEDDING_DIMENSIONS ?? 512),
  };
}

const BATCH = 96;

/** OpenAI embeddings, used for the graph's vector indexes. */
export class Embedder {
  readonly config: EmbeddingConfig;
  private client: OpenAI;

  constructor(config: EmbeddingConfig = embeddingConfigFromEnv()) {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set (see .env.example)");
    this.config = config;
    this.client = new OpenAI({ maxRetries: 4 });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const res = await this.client.embeddings.create({
        model: this.config.model,
        dimensions: this.config.dimensions,
        input: texts.slice(i, i + BATCH),
      });
      out.push(...res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
    }
    return out;
  }

  async embedOne(text: string): Promise<number[]> {
    return (await this.embed([text]))[0];
  }

  /** Identifies the text and the embedding settings, so changes to either trigger re-embedding. */
  hash(text: string): string {
    return createHash("sha256").update(`${this.config.model}|${this.config.dimensions}|${text}`).digest("hex").slice(0, 16);
  }
}

/** Embed every idea and entity whose text (or the embedding settings) changed. */
export async function refreshEmbeddings(driver: Driver, embedder: Embedder): Promise<{ updated: number; total: number }> {
  const session = driver.session();
  try {
    const all = await session.executeRead((tx) => staleEmbeddings(tx));
    const stale = all.filter((x) => x.hash !== embedder.hash(x.text));
    if (stale.length) {
      const vectors = await embedder.embed(stale.map((x) => x.text));
      await session.executeWrite(async (tx) => {
        for (let i = 0; i < stale.length; i++) await setEmbedding(tx, stale[i].label, stale[i].id, vectors[i], embedder.hash(stale[i].text));
      });
    }
    return { updated: stale.length, total: all.length };
  } finally {
    await session.close();
  }
}
