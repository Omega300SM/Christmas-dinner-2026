// Optional browser tests (Node + Playwright). Not needed to run or host the site.
// Serve the folder ABOVE the repo so the site lives under a subdirectory, like a
// GitHub Pages project site:   cd .. && python3 -m http.server 8765
// Then run:   BASE=http://localhost:8765/Christmas-dinner-2026/ node tests/ui-test.js
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const BASE = process.env.BASE || 'http://localhost:8765/Christmas-dinner-2026/';
const SHOTS = process.env.SHOTS || '';
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'venues.json'), 'utf8'));
const venue = (id) => DATA.venues.find((v) => v.id === id);
let pass = 0;
let failN = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { failN++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const external = [];
  page.on('request', (r) => { if (!r.url().startsWith(new URL(BASE).origin)) external.push(r.url()); });

  await page.goto(BASE);
  await page.waitForSelector('#app:not([hidden])');
  check('loads under a repository subdirectory', true);
  check('no JS errors on load', errors.length === 0, errors);
  check('loading message hidden after load', !(await page.isVisible('#load-state')));
  check('no external network requests on load', external.length === 0, external);

  const count = async () => (await page.textContent('#result-count')).trim();
  const cardIds = async (sel) => page.$$eval(sel + ' article.card', (els) => els.map((e) => e.id.replace('card-', '')));
  const total = DATA.venues.length;
  check('initial count shows all venues', (await count()).includes(`Showing ${total} of ${total}`), await count());

  const stats = await page.$$eval('.stat-value', (e) => e.map((x) => x.textContent));
  check('four overview stats', stats.length === 4, stats);
  check("evening-service count is 1 (Smith's only)", stats[2] === '1', stats);
  check('availability-verified count is 0', stats[3] === '0', stats);
  check('three editorial picks', (await page.$$('#picks li')).length === 3);

  // Search
  await page.fill('#f-q', 'turkey');
  check('search "turkey" narrows results', !(await count()).includes(`Showing ${total} `), await count());
  await page.fill('#f-q', 'riverside windsor');
  const multi = await cardIds('#results');
  check('multi-word search (AND)', multi.includes('sir-christopher-wren-windsor'), multi);
  await page.fill('#f-q', 'zzzznomatch');
  check('zero-results message shown', await page.isVisible('#no-results'));
  await page.click('#f-clear');
  check('clear restores all', (await count()).includes(`Showing ${total} of ${total}`));

  // Combined filters
  await page.selectOption('#f-area', 'windsor-eton');
  await page.selectOption('#f-verify', 'confirmed');
  const wc = await cardIds('#cards-confirmed');
  check('Windsor + confirmed: no leads shown', wc.length > 0 && (await cardIds('#cards-unconfirmed')).length === 0, wc);
  check('Windsor + confirmed: all Windsor', wc.every((id) => venue(id).area === 'windsor-eton'), wc);
  await page.selectOption('#f-type', 'pub');
  const pubs = await cardIds('#cards-confirmed');
  check('+ type pub narrows further', pubs.length < wc.length && pubs.every((id) => venue(id).category === 'pub'), pubs);
  await page.click('#f-clear');

  // Meal filter
  await page.uncheck('#f-meal-lunch');
  await page.uncheck('#f-meal-unknown');
  const eve = await cardIds('#results');
  check("evening-only filter returns Smith's only", eve.length === 1 && eve[0] === 'smiths-bar-grill-paddington', eve);
  await page.click('#f-clear');

  // Price ceiling and unknown prices
  await page.fill('#f-maxprice', '100');
  const u100 = await cardIds('#results');
  check('ceiling £100 includes unknown-price venues by default', u100.includes('windsor-lad-harvester'), u100);
  check('ceiling £100 excludes £159 venue', !u100.includes('sir-christopher-wren-windsor'));
  check('ceiling is inclusive (£100 venue kept)', u100.includes('coppa-club-maidenhead'));
  await page.uncheck('#f-unknownprice');
  const known = await cardIds('#results');
  check('excluding unknown prices removes them', !known.includes('windsor-lad-harvester') && known.includes('thatched-cottage-maidenhead'), known);
  await page.click('#f-clear');

  // Non-resident and availability filters
  await page.selectOption('#f-nonres', 'unknown');
  const nrU = await cardIds('#results');
  check('nonresident=unknown includes SCW and Fairmont', nrU.includes('sir-christopher-wren-windsor') && nrU.includes('fairmont-windsor-park'), nrU);
  await page.click('#f-clear');
  await page.selectOption('#f-avail', 'verified');
  check('availability=verified returns zero', (await cardIds('#results')).length === 0);
  await page.click('#f-clear');

  // Sorting
  await page.selectOption('#f-sort', 'price');
  const order = await cardIds('#cards-confirmed');
  const prices = order.map((id) => venue(id).pricing.adult);
  const firstNull = prices.indexOf(null);
  const knownPart = firstNull < 0 ? prices : prices.slice(0, firstNull);
  check('price sort ascending for known prices', knownPart.every((p, i) => i === 0 || knownPart[i - 1] <= p), prices);
  check('unknown prices sort after known', firstNull < 0 || prices.slice(firstNull).every((p) => p === null), prices);
  check('cheapest first is Thatched Cottage', order[0] === 'thatched-cottage-maidenhead', order[0]);
  await page.selectOption('#f-sort', 'name');
  const names = (await cardIds('#cards-confirmed')).map((id) => venue(id).name);
  check('name sort alphabetical', names.every((n, i) => i === 0 || names[i - 1].localeCompare(n, 'en-GB') <= 0), names);
  await page.selectOption('#f-sort', 'area');
  const ao = { 'windsor-eton': 0, 'maidenhead-bray-taplow': 1, 'paddington': 2 };
  const areas = (await cardIds('#cards-confirmed')).map((id) => venue(id).area);
  check('area sort grouped', areas.every((a, i) => i === 0 || ao[areas[i - 1]] <= ao[a]), areas);
  await page.click('#f-clear');

  // Compare limit and removal
  const cmp = ['smiths-bar-grill-paddington', 'sir-christopher-wren-windsor', 'carpenters-arms-windsor', 'coppa-club-maidenhead', 'braywood-paley-street'];
  for (const id of cmp.slice(0, 4)) await page.check('#cmp-' + id);
  check('compare shows 4 columns', (await page.$$('.compare-table thead th')).length === 4);
  check('5th compare checkbox disabled', await page.isDisabled('#cmp-' + cmp[4]));
  await page.click('.compare-table thead th button');
  check('remove from compare works', (await page.$$('.compare-table thead th')).length === 3);
  check('5th checkbox enabled again', !(await page.isDisabled('#cmp-' + cmp[4])));

  // Favourites + notes persistence
  await page.click('#card-carpenters-arms-windsor .fav-btn');
  await page.click('#card-carpenters-arms-windsor details:has(textarea) summary');
  await page.fill('#note-carpenters-arms-windsor', 'Ask about 1pm <b>sitting</b>');
  await page.waitForTimeout(700);
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  check('favourite persisted after reload', (await page.getAttribute('#card-carpenters-arms-windsor .fav-btn', 'aria-pressed')) === 'true');
  check('note persisted after reload', (await page.inputValue('#note-carpenters-arms-windsor')) === 'Ask about 1pm <b>sitting</b>');
  check('note rendered as text, not HTML', (await page.$$('#shortlist-view b')).length === 0 && (await page.textContent('#shortlist-view')).includes('<b>sitting</b>'));
  check('compare selection persisted', (await page.$$('.compare-table thead th')).length === 3);
  await page.check('#f-fav');
  check('favourites-only filter', (await cardIds('#results')).join() === 'carpenters-arms-windsor');
  await page.click('#f-clear');

  // Budget
  await page.fill('#p-adults', '2');
  await page.fill('#p-children', '1');
  const bud = await page.textContent('#budget-view');
  check('budget: SCW 2×£159 + £77.50 = £395.50', bud.includes('£395.50'));
  check("budget: Carpenter's adults only (child price unknown) = £188.00", bud.includes('£188.00') && bud.includes('Known adult subtotal only'));
  check('budget: unknown adult price gives no estimate', bud.includes('No estimate — adult price not published'));
  check('budget: never shows £0.00', !bud.includes('£0.00'));
  check("budget: Smith's 2×99 + 30 = £228.00 with 12.5% ≈ £28.50 shown separately", bud.includes('£228.00') && bud.includes('£28.50'));
  await page.fill('#p-adults', '-1');
  check('budget: invalid input shows error', await page.isVisible('#party-error'));
  await page.fill('#p-adults', '2');

  // Enquiry
  await page.selectOption('#e-venue', 'sir-christopher-wren-windsor');
  const enq = await page.inputValue('#e-text');
  check('enquiry includes venue and party', enq.includes('Sir Christopher Wren') && enq.includes('2 adults and 1 child'), enq);
  check('enquiry includes required wording', enq.includes('nonresident guests for Christmas Day lunch or dinner on December 25, 2026'));

  // Export / import
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#s-export')]);
  const exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  check('export has format, favourites and notes', exported.format === 'xmas2026-shortlist' && exported.favorites.includes('carpenters-arms-windsor') && !!exported.notes['carpenters-arms-windsor']);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xmas-import-'));
  const bad1 = path.join(tmp, 'bad.json'); fs.writeFileSync(bad1, '{not json');
  await page.setInputFiles('#s-import', bad1); await page.waitForTimeout(300);
  check('import rejects invalid JSON', (await page.textContent('#s-status')).includes('not valid JSON'));
  const bad2 = path.join(tmp, 'wrong.json'); fs.writeFileSync(bad2, JSON.stringify({ hello: 1 }));
  await page.setInputFiles('#s-import', bad2); await page.waitForTimeout(300);
  check('import rejects wrong format', (await page.textContent('#s-status')).includes('does not look like a shortlist'));
  const good = path.join(tmp, 'good.json');
  fs.writeFileSync(good, JSON.stringify({ format: 'xmas2026-shortlist', version: 1, favorites: ['smiths-bar-grill-paddington', 'ghost-venue', 'BAD ID!'], notes: { 'smiths-bar-grill-paddington': '<img src=x onerror=alert(1)>' }, party: { adults: 3, children: 0 } }));
  await page.setInputFiles('#s-import', good); await page.waitForTimeout(300);
  const st = await page.textContent('#s-status');
  check('valid import succeeds with warnings', st.includes('Imported') && st.includes('not in the current data') && st.includes('ignored'), st);
  check('imported HTML in note is not injected', (await page.$$('#shortlist-view img')).length === 0);
  check('import restores party inputs', (await page.inputValue('#p-adults')) === '3');

  // Printable shortlist content
  await page.evaluate(() => { window.print = () => {}; });
  await page.click('#s-print');
  check('printable shortlist includes source URLs', (await page.textContent('#print-shortlist')).includes('https://www.smithsbarandgrill.co.uk/christmas-day'));

  // Keyboard and labels
  await page.goto(BASE);
  await page.waitForSelector('#app:not([hidden])');
  await page.keyboard.press('Tab');
  check('first Tab focuses the skip link', (await page.evaluate(() => document.activeElement.className)) === 'skip-link');
  const unlabeled = await page.$$eval('input, select, textarea', (els) => els.filter((e) => {
    if (e.type === 'file') return false;
    if (e.closest('label')) return false;
    return !(e.id && document.querySelector('label[for="' + e.id + '"]')) && !e.getAttribute('aria-label');
  }).map((e) => e.id || e.outerHTML.slice(0, 60)));
  check('all form controls have labels', unlabeled.length === 0, unlabeled);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desktop.png') });

  // Mobile
  const m = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const mp = await m.newPage();
  await mp.goto(BASE);
  await mp.waitForSelector('#app:not([hidden])');
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal page overflow at 375px', overflow <= 0, overflow);
  for (const id of cmp.slice(0, 2)) await mp.check('#cmp-' + id);
  check('mobile compare uses stacked cards', (await mp.isVisible('.compare-cards')) && !(await mp.isVisible('.compare-table-wrap')));
  if (SHOTS) await mp.screenshot({ path: path.join(SHOTS, 'mobile.png') });
  await mp.emulateMedia({ media: 'print' });
  check('filters hidden in print media', !(await mp.isVisible('#filters')));

  // Failed JSON load
  const f = await browser.newContext();
  const fp = await f.newPage();
  await fp.route('**/data/venues.json', (r) => r.fulfill({ status: 404, body: 'missing' }));
  await fp.goto(BASE);
  await fp.waitForSelector('#load-error:not([hidden])');
  check('error state shown when JSON fails to load', (await fp.textContent('#load-error')).includes('could not be loaded'));

  // Browser storage unavailable (simulated)
  const ls = await browser.newContext();
  const lp = await ls.newPage();
  await lp.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage disabled for test'); } }); });
  await lp.goto(BASE);
  await lp.waitForSelector('#app:not([hidden])');
  check('storage warning shown when localStorage unavailable', await lp.isVisible('#storage-warning'));
  await lp.click('#card-carpenters-arms-windsor .fav-btn');
  check('favourites still work for the visit', (await lp.getAttribute('#card-carpenters-arms-windsor .fav-btn', 'aria-pressed')) === 'true');

  await browser.close();
  console.log(`\n${pass} passed, ${failN} failed`);
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
