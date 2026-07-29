/**
 * Screenshot walk: the customer site and the plumber console, at phone width,
 * in both themes. Logs into the console for real using the dev-only OTP code,
 * so the job cards contain actual data rather than placeholders.
 *
 * Needs both servers running:
 *   (cd apps/api && node dist/main.js)          # :3000
 *   pnpm --filter @pipefix/web dev              # :3001
 * and some jobs to look at — see scripts/seed-demo-jobs.sh
 *
 * Usage: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/screenshots.mjs
 *
 * Do not run `pnpm --filter @pipefix/web build` while the dev server is up —
 * they share .next and the dev server will start 500ing.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = '/workspace/plumbingapp/apps/web/screenshots';
mkdirSync(OUT, { recursive: true });
const WEB = 'http://localhost:3001';

async function shot(page, name) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('  ok', name);
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: theme,
    });
    const page = await ctx.newPage();
    console.log(theme + ':');
    await page.goto(WEB + '/', { waitUntil: 'networkidle' });
    await shot(page, 'customer-home-' + theme);
    await page.goto(WEB + '/services', { waitUntil: 'networkidle' });
    await shot(page, 'customer-services-' + theme);
    await page.goto(WEB + '/services/PLB-LEAK-004', { waitUntil: 'networkidle' });
    await shot(page, 'customer-inspect-first-' + theme);

    if (theme === 'light') {
      // The hamburger drawer, open.
      await page.goto(WEB + '/', { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: /open menu/i }).click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: OUT + '/customer-menu-open.png' });
      console.log('  ok customer-menu-open');

      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      await page.goto(WEB + '/how-it-works', { waitUntil: 'networkidle' });
      await shot(page, 'customer-how-it-works');
    }
    await ctx.close();
  }

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  });
  const page = await ctx.newPage();

  console.log('plumber console:');
  await page.goto(WEB + '/dad', { waitUntil: 'networkidle' });
  await shot(page, 'plumber-login');

  await page.getByRole('button', { name: /send me a code/i }).click();
  await page.waitForTimeout(1500);

  const hint = await page.locator('text=/Development only/').first().textContent();
  const match = (hint || '').match(/\b(\d{6})\b/);
  if (!match) throw new Error('could not read dev code from: ' + hint);
  console.log('  dev code:', match[1]);

  await page.getByLabel(/6-digit code/i).fill(match[1]);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForTimeout(3000);
  await shot(page, 'plumber-jobs-today');

  const historyBtn = page.getByRole('button', { name: /past jobs for this customer/i }).first();
  if ((await historyBtn.count()) > 0) {
    await historyBtn.click();
    await page.waitForTimeout(1500);
    await shot(page, 'plumber-history-open');
  }

  await page.getByRole('tab', { name: /finished/i }).click();
  await page.waitForTimeout(2000);
  await shot(page, 'plumber-finished');

  await ctx.close();
  await browser.close();
  console.log('done');
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
