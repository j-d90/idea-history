// Knowledge graph schema. Applied by `npm run kg:migrate`; every statement is idempotent.
//
// (:Idea)-[:CITES {order}]->(:Source)
// (:Idea)-[:BUILDS_ON {order, why, sources}]->(:Idea)
// (:Person)-[:CONTRIBUTED {role: author|editor|translator, order}]->(:Source)
// (:Review)-[:REVIEWS]->(:Idea)          one node per review run, kept as history

CREATE CONSTRAINT idea_id IF NOT EXISTS FOR (i:Idea) REQUIRE i.id IS UNIQUE;
CREATE CONSTRAINT source_key IF NOT EXISTS FOR (s:Source) REQUIRE s.key IS UNIQUE;
CREATE CONSTRAINT person_name IF NOT EXISTS FOR (p:Person) REQUIRE p.name IS UNIQUE;
CREATE CONSTRAINT review_run IF NOT EXISTS FOR (r:Review) REQUIRE r.runId IS UNIQUE;

CREATE INDEX idea_year IF NOT EXISTS FOR (i:Idea) ON (i.year);
CREATE INDEX idea_status IF NOT EXISTS FOR (i:Idea) ON (i.status);
CREATE INDEX idea_category IF NOT EXISTS FOR (i:Idea) ON (i.category);
