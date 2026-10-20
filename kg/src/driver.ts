import neo4j, { type Driver } from "neo4j-driver";

export interface Neo4jConfig {
  uri: string;
  user: string;
  password?: string;
}

export function neo4jConfigFromEnv(env: NodeJS.ProcessEnv = process.env): Neo4jConfig {
  return { uri: env.NEO4J_URI ?? "bolt://localhost:7687", user: env.NEO4J_USER ?? "neo4j", password: env.NEO4J_PASSWORD };
}

/** Connect and verify, failing with a hint if Neo4j isn't running. */
export async function connect(cfg: Neo4jConfig): Promise<Driver> {
  if (!cfg.password) throw new Error("NEO4J_PASSWORD is not set (see .env.example)");
  // Plain JS numbers instead of neo4j Integer objects; our values are small.
  const driver = neo4j.driver(cfg.uri, neo4j.auth.basic(cfg.user, cfg.password), { disableLosslessIntegers: true });
  try {
    await driver.verifyConnectivity();
  } catch (e) {
    await driver.close();
    throw new Error(`cannot connect to Neo4j at ${cfg.uri}: ${(e as Error).message}\nIs it running? Try: npm run kg:up`);
  }
  return driver;
}
