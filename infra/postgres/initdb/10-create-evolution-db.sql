-- Postgres init script (runs once, only when the data volume is first created).
--
-- The bundled `postgres` service hosts TWO logical databases on a single
-- instance:
--   - the application database (POSTGRES_DB, default `decodifica`) used by the
--     NestJS API via Prisma; created automatically by the postgres image.
--   - the `evolution` database used by the Evolution API gateway; created here.
--
-- Creating Evolution's database separately keeps its tables isolated from the
-- Prisma-managed schema so migrations on one never touch the other.
SELECT 'CREATE DATABASE evolution'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'evolution')\gexec
