-- NOTE: Prisma originally generated DROP INDEX statements here for the
-- PostGIS GiST indexes it cannot see in schema.prisma. They were removed by
-- hand; those indexes are owned by prisma/sql/postgis-objects.sql, which
-- db:migrate re-applies after every deploy. See DECISIONS D-010.

-- CreateEnum
CREATE TYPE "BookingPricingMode" AS ENUM ('UPFRONT', 'INSPECT_FIRST');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "pricingMode" "BookingPricingMode" NOT NULL DEFAULT 'UPFRONT';
