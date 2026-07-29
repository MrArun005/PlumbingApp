/* eslint-disable no-console -- CLI script, not runtime code */
/**
 * Applies `prisma/sql/postgis-objects.sql` — the indexes and extensions Prisma
 * cannot manage itself. Runs after `prisma migrate deploy` (see the db:migrate
 * script) and is safe to run any number of times.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const sql = readFileSync(join(__dirname, 'sql', 'postgis-objects.sql'), 'utf8');

  // Split on semicolons at end-of-statement, ignoring comment-only chunks.
  const statements = sql
    .split(/;\s*$/m)
    .map((s) =>
      s
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
  console.log(`  raw objects applied: ${statements.length} statement(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
