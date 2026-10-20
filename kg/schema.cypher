// Knowledge graph schema. Applied by `npm run kg:migrate`; every statement is idempotent.
// {{EMBEDDING_DIMENSIONS}} is filled in from .env (default 512). Changing it requires
// dropping the vector indexes and re-embedding (`npm run kg -- embed`).
//
// (:Idea|:Event)-[:CITES {order}]->(:Source)
// (:Idea)-[:BUILDS_ON|REACTS_AGAINST|PARALLELS {why, origin, status, evidence, ...}]->(:Idea)
// (:Idea)-[:EMERGES_IN {stage, why, status, evidence, ...}]->(:Event)
// (:Person)-[:CONTRIBUTED {role, order}]->(:Source)
// (:Idea|:Event)-[:INVOLVES {role}]->(:Entity)
// (:Source)-[:DISCUSSES {evidence, locator}]->(:Idea)
// (:Review)-[:REVIEWS]->(:Idea|:Event)            one node per fact-checker run
// (:AgentRun)-[:ABOUT]->(:Idea|:Event|:Source)    one node per run of the other agents

CREATE CONSTRAINT idea_id IF NOT EXISTS FOR (i:Idea) REQUIRE i.id IS UNIQUE;
CREATE CONSTRAINT source_key IF NOT EXISTS FOR (s:Source) REQUIRE s.key IS UNIQUE;
CREATE CONSTRAINT person_name IF NOT EXISTS FOR (p:Person) REQUIRE p.name IS UNIQUE;
CREATE CONSTRAINT event_id IF NOT EXISTS FOR (e:Event) REQUIRE e.id IS UNIQUE;
CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE;
CREATE CONSTRAINT review_run IF NOT EXISTS FOR (r:Review) REQUIRE r.runId IS UNIQUE;
CREATE CONSTRAINT agent_run IF NOT EXISTS FOR (r:AgentRun) REQUIRE r.runId IS UNIQUE;

CREATE INDEX idea_year IF NOT EXISTS FOR (i:Idea) ON (i.year);
CREATE INDEX idea_status IF NOT EXISTS FOR (i:Idea) ON (i.status);
CREATE INDEX idea_category IF NOT EXISTS FOR (i:Idea) ON (i.category);
CREATE INDEX event_year IF NOT EXISTS FOR (e:Event) ON (e.year);
CREATE INDEX event_status IF NOT EXISTS FOR (e:Event) ON (e.status);
CREATE INDEX agent_run_agent IF NOT EXISTS FOR (r:AgentRun) ON (r.agent);
CREATE INDEX entity_kind IF NOT EXISTS FOR (e:Entity) ON (e.kind);

CREATE VECTOR INDEX idea_embedding IF NOT EXISTS FOR (i:Idea) ON i.embedding
  OPTIONS { indexConfig: { `vector.dimensions`: {{EMBEDDING_DIMENSIONS}}, `vector.similarity_function`: 'cosine' } };
CREATE VECTOR INDEX entity_embedding IF NOT EXISTS FOR (e:Entity) ON e.embedding
  OPTIONS { indexConfig: { `vector.dimensions`: {{EMBEDDING_DIMENSIONS}}, `vector.similarity_function`: 'cosine' } };
CREATE VECTOR INDEX event_embedding IF NOT EXISTS FOR (e:Event) ON e.embedding
  OPTIONS { indexConfig: { `vector.dimensions`: {{EMBEDDING_DIMENSIONS}}, `vector.similarity_function`: 'cosine' } };
