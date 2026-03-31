CREATE EXTENSION IF NOT EXISTS vector;

CREATE INDEX ON jobs USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX ON cvs USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);
