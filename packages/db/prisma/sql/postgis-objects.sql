-- Database objects Prisma cannot express in schema.prisma.
--
-- WHY THIS FILE EXISTS: Prisma only manages what it can see in the schema.
-- PostGIS `Unsupported()` columns cannot carry an `@@index`, and Prisma has no
-- syntax for partial indexes. If these objects live only inside one migration,
-- Prisma treats them as drift and emits `DROP INDEX` in the NEXT migration it
-- generates — which is exactly what happened once already (DECISIONS D-010).
--
-- So they live here instead, written idempotently, and `pnpm db:migrate`
-- re-applies this file after every `prisma migrate deploy`. Prisma may drop
-- them; this puts them straight back.
--
-- Rules for editing: every statement MUST be safely re-runnable.

CREATE EXTENSION IF NOT EXISTS postgis;

-- Geospatial lookups: ST_DWithin partner-to-job, zone containment.
CREATE INDEX IF NOT EXISTS "Address_location_gist"
  ON "Address" USING GIST ("location");

CREATE INDEX IF NOT EXISTS "ZoneGeofence_polygon_gist"
  ON "ZoneGeofence" USING GIST ("polygon");

CREATE INDEX IF NOT EXISTS "PartnerLocationPing_location_gist"
  ON "PartnerLocationPing" USING GIST ("location");

-- One ACTIVE job per partner, enforced by the database rather than by hope.
-- Covers every state in which the partner is committed to a job on site, so
-- dispatch's `activeJobCount === 0` filter cannot be undermined by a race.
CREATE UNIQUE INDEX IF NOT EXISTS "Job_one_active_per_partner"
  ON "Job" ("partnerId")
  WHERE "status" IN ('ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'DIAGNOSING',
                     'QUOTE_PENDING', 'QUOTE_REVISED', 'IN_PROGRESS')
    AND "partnerId" IS NOT NULL;
