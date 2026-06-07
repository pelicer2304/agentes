-- Creates the dedicated database used by the Evolution API.
--
-- This script runs only on FIRST initialization of the postgres data volume
-- (docker-entrypoint-initdb.d). The primary application database is created by
-- the postgres image from POSTGRES_DB (default: decodifica); this adds a
-- separate `evolution` database so the WhatsApp gateway keeps its tables
-- isolated from the application's Prisma-managed schema.
CREATE DATABASE evolution;
