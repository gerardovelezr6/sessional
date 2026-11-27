import { expect, test, type Page } from '@playwright/test';

// The main website: the contact form (stored, rate limited, read in Admin → Inbox), the live
// committee scene, and the grouped, navigable sections.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const admin = (path = '/') => `http://admin.localhost:${PORT}${path}`;
let address = 0;
// Each test writes from its own network address, as far as rate limiting can tell.
const fromNewAddress = (page: Page) => page.setExtraHTTPHeaders({ 'x-forwarded-for': `203.0.113.${++address + Math.floor(Math.random() * 200)}` });

async function fill(page: Page, name: string, org: string) {
  const form = page.locator('#contact form');
  await form.getByLabel('Your name').fill(name);
  await form.getByLabel('Email').fill(`${name.split(' ')[0]!.toLowerCase()}@school.test`);
  await form.getByRole('combobox', { name: 'You are', exact: true }).selectOption('staff');
  await form.getByLabel('School or organization').fill(org);
  await form.getByRole('combobox', { name: /^Country/ }).selectOption('MX');
  await form.getByLabel(/^Committees/).fill('12');
  await form.getByLabel(/^Delegates/).fill('300');
  await form.getByLabel(/^Anything else/).fill('We use THIMUN rules.');
}
// People take more than a few seconds to fill a form; the form ignores anything faster.
const humanPause = (page: Page) => page.waitForTimeout(3100);

test('the contact form explains what is missing, then files the request', async ({ page }) => {
  await fromNewAddress(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Write to us' }).click();
  await expect(page).toHaveURL(/#contact$/);
  const form = page.locator('#contact form');
  await form.getByLabel('Email').fill('not-an-email');
  await humanPause(page);
  await form.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Some fields need a second look.')).toBeVisible();
  await expect(form.getByLabel('Your name')).toBeFocused();
  await expect(form.getByLabel('Your name')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Write an email address like name@school.edu.')).toBeVisible();
  // What was typed stays in the form.
  await expect(form.getByLabel('Email')).toHaveValue('not-an-email');

  await fill(page, 'Ana Torres', 'Colegio Contacto');
  await form.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('status')).toContainText('Thanks. We have your message.');
});

test('a bot that fills the hidden field is told it worked, and nothing is stored', async ({ page }) => {
  await fromNewAddress(page);
  await page.goto('/');
  await fill(page, 'Robot Uno', 'Bot Academy');
  await page.locator('#contact-website').evaluate((el: HTMLInputElement) => (el.value = 'https://spam.test'));
  await humanPause(page);
  await page.locator('#contact form').getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('status')).toContainText('Thanks. We have your message.');
});

test('a fourth message within the hour from one address is refused with a reason', async ({ page }) => {
  await fromNewAddress(page);
  for (const n of [1, 2, 3]) {
    await page.goto('/');
    await fill(page, `Flood ${n}`, `Flood School ${n}`);
    await humanPause(page);
    await page.locator('#contact form').getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('status')).toContainText('Thanks.');
  }
  await page.goto('/');
  await fill(page, 'Flood Four', 'Flood School 4');
  await humanPause(page);
  await page.locator('#contact form').getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('several messages from your network in the last hour')).toBeVisible();
});

test('a platform admin reads requests in the inbox, marks them answered and deletes them', async ({ page }) => {
  await page.goto(admin('/login'));
  await page.getByLabel('Email').fill('root@platform.test');
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Inbox' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inbox');
  const item = page.getByRole('listitem').filter({ hasText: 'Colegio Contacto' });
  await expect(item).toContainText('Ana Torres');
  await expect(item).toContainText('ana@school.test');
  await expect(item).toContainText('Mexico');
  await expect(item).toContainText('12 committees, 300 delegates');
  await expect(item).toContainText('We use THIMUN rules.');
  await expect(page.getByRole('listitem').filter({ hasText: 'Bot Academy' })).toHaveCount(0);
  await item.getByRole('button', { name: 'Mark answered' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Colegio Contacto' })).toContainText('Answered');
  await page.getByRole('listitem').filter({ hasText: 'Colegio Contacto' }).getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete this request for good' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Colegio Contacto' })).toHaveCount(0);
});

// Scrolls so that a step is this far through its part of the story.
// On wide screens the steps and the stage are pinned together while their track scrolls by; this
// scrolls to the given fraction of a step (index from 0).
const scrollThrough = (step: import('@playwright/test').Locator, fraction: number) =>
  step.evaluate((el: HTMLElement, f) => {
    const track = document.querySelector('.story-track') as HTMLElement;
    const pinned = document.querySelector('.story-pinned') as HTMLElement;
    const steps = [...document.querySelectorAll('.story-steps > li')];
    const i = steps.indexOf(el);
    const top = track.getBoundingClientRect().top + window.scrollY - parseFloat(getComputedStyle(pinned).top);
    const distance = track.offsetHeight - pinned.offsetHeight;
    window.scrollTo(0, top + (distance * (i + f)) / steps.length);
  }, fraction);

test('“How a session runs” is told by scrolling: the pinned stage plays each step', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const steps = page.locator('ol.story-steps > li');
  await expect(steps).toHaveCount(6);
  const stage = page.locator('.story-stage');
  // Roll call: delegations answer as you scroll through the step.
  await scrollThrough(steps.nth(0), 0.6);
  await expect(stage).toContainText(/\d+ of 15 answered/);
  await expect(steps.nth(0)).toHaveAttribute('aria-current', 'step');
  // Voting: further down, the placards vote and the resolution passes.
  await scrollThrough(steps.nth(4), 0.95);
  await expect(steps.nth(4)).toHaveAttribute('aria-current', 'step');
  await scrollThrough(steps.nth(2), 0.95);
  await expect(stage).toContainText('Voted in this order');
  await scrollThrough(steps.nth(4), 0.95);
  await expect(stage).toContainText('Vote on draft resolution 1.1');
  await expect(stage.getByText('Passed', { exact: true })).toBeVisible();
  // Grades and awards at the end.
  await scrollThrough(steps.nth(5), 0.95);
  await expect(stage).toContainText('Best Delegate');
  // Scrolling back plays it backwards.
  await scrollThrough(steps.nth(1), 0.05);
  await expect(stage).toContainText('Speaking now');
  // The stage stays pinned, in the upper middle of the screen, while the steps scroll past.
  const frame = page.locator('.story-stage').locator('xpath=ancestor::div[contains(@class,"landing-frame")][1]');
  const top = await frame.evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeLessThan(400);
  await scrollThrough(steps.nth(3), 0.5);
  expect(Math.abs((await frame.evaluate((el) => el.getBoundingClientRect().top)) - top)).toBeLessThan(2);
});

test('the steps and the stage move as one: the stage is level with the list, one step open at a time, no room left over', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  // The opening is not the story's stage.
  await expect(page.locator('section[aria-labelledby="hero-title"] .story-stage')).toHaveCount(0);
  const track = await page.locator('.story-track').evaluate((el) => ({ top: el.getBoundingClientRect().top + window.scrollY, height: el.getBoundingClientRect().height }));
  const pinnedHeight = await page.locator('.story-pinned').evaluate((el) => (el as HTMLElement).offsetHeight);
  for (let y = track.top - 96; y < track.top + track.height - pinnedHeight - 96; y += 140) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(380);
    const r = await page.evaluate(() => {
      const frame = document.querySelector('.story-stage')!.closest('.landing-frame')!.getBoundingClientRect();
      const list = document.querySelector('.story-steps')!.getBoundingClientRect();
      const label = document.querySelector('.story-stage')!.parentElement!.querySelector('.font-mono')!.textContent ?? '';
      const shown = Number(/Step (\d+) of/.exec(label)?.[1] ?? 0);
      const steps = [...document.querySelectorAll('.story-steps > li')];
      const open = steps.findIndex((li) => li.getAttribute('aria-current') === 'step') + 1;
      const bodies = steps.filter((li) => li.querySelector('.story-body')!.getBoundingClientRect().height > 12).length;
      // Each step is only as tall as what it shows: title, and the open one's text.
      const snug = steps.every((li) => li.getBoundingClientRect().height < 220);
      return { y: window.scrollY, shown, open, level: Math.abs(frame.top - list.top), bodies, snug };
    });
    expect(r.level, `stage level with the list at ${r.y}`).toBeLessThan(2);
    expect(r.bodies, `one step open at ${r.y}`).toBe(1);
    expect(r.snug, `no room left over at ${r.y}`).toBe(true);
    if (r.shown) expect(r.open, `the stage plays the open step at ${r.y}`).toBe(r.shown);
  }
  // The section ends right after the last step finishes: awards shown, the next section next.
  await page.evaluate((top) => window.scrollTo(0, top), track.top + track.height - pinnedHeight - 96);
  await expect(page.locator('.story-stage')).toContainText('Best Delegate');
  const gap = await page.evaluate(() => document.querySelector('#screens')!.getBoundingClientRect().top - document.querySelector('.story-pinned')!.getBoundingClientRect().bottom);
  expect(gap).toBeLessThan(100);
});

test('every screen runs on one clock while on screen, can be paused, and starts paused for less motion', async ({ page, browser }) => {
  await page.goto('/');
  await page.locator('#screens').scrollIntoViewIfNeeded();
  // The console, the Secretariat's view, the projector, a delegate's phone and the check-in page:
  // real screens, no printed placard.
  const screens = page.locator('#screens figure');
  await expect(screens).toHaveCount(5);
  await expect(page.getByRole('figure', { name: 'The chair’s console on a laptop' })).toContainText('Next speaker');
  await expect(page.getByRole('figure', { name: 'The Secretariat’s view of every committee' })).toContainText('Security Council');
  await expect(page.getByRole('figure', { name: 'A chair’s phone at the door' })).toContainText('Check in Switzerland');
  // The console works, and the other screens follow it.
  const console_ = page.getByRole('figure', { name: 'The chair’s console on a laptop' });
  await console_.getByRole('button', { name: 'Pause timer' }).click();
  const speaker = () => page.getByRole('figure', { name: 'The projector screen in the committee room' }).locator('.text-3xl').textContent();
  const before = await speaker();
  await console_.getByRole('button', { name: 'Next speaker' }).click();
  await expect.poll(speaker).not.toBe(before);
  await expect(page.getByRole('figure', { name: 'A delegate’s phone' })).toContainText((await speaker())!);
  await console_.getByRole('button', { name: 'Resume timer' }).click();
  // Checking Switzerland in at the door counts it present on the console.
  await expect(console_).toContainText('14 of 15 present');
  const door = page.getByRole('figure', { name: 'A chair’s phone at the door' });
  await door.getByRole('button', { name: 'Mark as Present and voting' }).click();
  await expect(door).toContainText('Switzerland is marked Present and voting.');
  await expect(console_).toContainText('15 of 15 present');
  await door.getByRole('button', { name: 'Undo' }).click();
  await expect(console_).toContainText('14 of 15 present');
  // Nothing spills out of its column.
  expect(await page.locator('#screens').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  const projector = page.getByRole('figure', { name: 'The projector screen in the committee room' }).locator('.font-mono');
  const phone = page.getByRole('figure', { name: 'A delegate’s phone' }).locator('.font-mono');
  const first = await projector.textContent();
  await expect(projector).not.toHaveText(first!, { timeout: 3000 });
  await page.getByRole('button', { name: 'Pause the screens' }).click();
  const stopped = await projector.textContent();
  await page.waitForTimeout(1500);
  await expect(projector).toHaveText(stopped!);
  await expect(phone).toHaveText(stopped!);

  const calm = await (await browser.newContext({ reducedMotion: 'reduce' })).newPage();
  await calm.goto('/');
  await calm.locator('#screens').scrollIntoViewIfNeeded();
  await expect(calm.getByRole('button', { name: 'Play the screens' })).toHaveAttribute('aria-pressed', 'true');
  await calm.context().close();
});

test('organizer features are grouped in tabs that work from the keyboard, and the section nav marks where you are', async ({ page }) => {
  await page.goto('/');
  const tabs = page.getByRole('tablist', { name: 'When' });
  await expect(tabs.getByRole('tab', { name: 'Before the conference' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Before the conference' })).toContainText('Bring your spreadsheet');
  await tabs.getByRole('tab', { name: 'Before the conference' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'During' })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'During' })).toContainText('Printing');
  await page.keyboard.press('End');
  await expect(page.getByRole('tabpanel', { name: 'After' })).toContainText('Your data leaves with you');

  const nav = page.getByRole('navigation', { name: 'On this page' });
  await nav.getByRole('link', { name: 'Pricing' }).click();
  await expect(nav.getByRole('link', { name: 'Pricing' })).toHaveAttribute('aria-current', 'location');
  // The sticky header does not cover the section's heading.
  const top = await page.getByRole('heading', { level: 2, name: 'Pricing' }).evaluate((h) => h.getBoundingClientRect().top);
  const header = await page.locator('header').first().evaluate((h) => h.getBoundingClientRect().bottom);
  expect(top).toBeGreaterThanOrEqual(header);
});

// Scrolls so that the opening is this far through its scroll (0 to 1).
const scrollOpening = (page: import('@playwright/test').Page, f: number) =>
  page.evaluate((f) => {
    const track = document.querySelector('.opening') as HTMLElement;
    const stage = document.querySelector('.opening-stage') as HTMLElement;
    window.scrollTo(0, Math.round((track.offsetHeight - stage.offsetHeight) * f));
  }, f);

test('the opening plays by itself once you scroll in, and goes back to rest at the top', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const opening = page.locator('section[aria-labelledby="hero-title"]');
  await expect(opening.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(opening.getByRole('link', { name: 'Write to us' })).toBeVisible();
  // It stays put while pinned: the wordmark doesn't slide when scrolling starts.
  const at = () => opening.locator('svg').first().evaluate((el) => Math.round(el.getBoundingClientRect().top));
  const rest = await at();
  await scrollOpening(page, 0.02);
  expect(await at()).toBe(rest);
  // A little further in, the logo's part plays on its own to the committees, with the page held
  // still meanwhile so it isn't skipped.
  await scrollOpening(page, 0.05);
  const y = await page.evaluate(() => window.scrollY);
  const room = page.getByRole('figure', { name: /^Example: one conference/ });
  await expect(room).toContainText('One conference.', { timeout: 4000 });
  await page.mouse.wheel(0, 1500);
  await page.waitForTimeout(200);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThan(2);
  // It ends on the committee tiles, the magenta gone.
  await expect(room.getByText('One conference.')).toHaveCount(0, { timeout: 6000 });
  await expect(room).toContainText('Every committee, at once.');
  // The committees and the room follow the scroll, not the clock.
  await page.waitForTimeout(1500);
  await expect(room).toContainText('Every committee, at once.');
  await scrollOpening(page, 0.95);
  await expect(room).toContainText('Every screen in the room, on one clock.');
  // Back at the top, it plays backwards to the wordmark, without the words.
  await scrollOpening(page, 0);
  await expect(room.getByText('One conference.')).toHaveCount(1, { timeout: 3000 });
  expect(await room.getByText('One conference.').evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(0);
  await expect(room).toHaveCount(0, { timeout: 6000 });
  await expect(opening.getByRole('heading', { level: 1 })).toBeVisible();

  // On a phone it fits the width, and the headline is on the first screen.
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await phone.goto('/');
  expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const h1 = await phone.getByRole('heading', { level: 1 }).evaluate((el) => el.getBoundingClientRect().bottom);
  expect(h1).toBeLessThan(844);
  await phone.context().close();
});

test('with less motion the opening doesn’t play by itself: scrolling moves it, and the magenta fades away', async ({ browser }) => {
  const calm = await (await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } })).newPage();
  await calm.goto('/');
  // No growing square: the screen cuts straight to magenta.
  await scrollOpening(calm, 0.2);
  await expect(calm.locator('.opening-stage > div.absolute.bg-primary')).toHaveCount(0);
  await calm.waitForTimeout(1500);
  await expect(calm.getByRole('figure', { name: /^Example: one conference/ })).toHaveCount(0);
  await scrollOpening(calm, 0.37);
  const room = calm.getByRole('figure', { name: /^Example: one conference/ });
  await expect(room).toContainText('One conference.');
  // The words fade out, then the whole magenta screen fades away to the committees under it.
  const shown = () => room.getByText('One conference.').evaluate((el) => Number(getComputedStyle(el).opacity));
  const cover = () => room.getByText('One conference.').evaluate((el) => Number(getComputedStyle(el.parentElement!.parentElement!).opacity));
  await expect.poll(shown).toBe(1);
  await expect.poll(cover).toBe(1);
  await scrollOpening(calm, 0.455);
  await expect.poll(shown).toBe(0);
  await expect.poll(cover).toBeLessThan(0.5);
  await scrollOpening(calm, 0.55);
  await expect(room).toContainText('Every committee, at once.');
  await expect(room.getByRole('listitem')).toHaveCount(6);
  await scrollOpening(calm, 0.75);
  await expect(room).toContainText('Every screen in the room, on one clock.');
  const first = await room.locator('.font-mono').last().textContent();
  await scrollOpening(calm, 0.99);
  await expect(room.locator('.font-mono').last()).not.toHaveText(first!);
  await calm.context().close();
});

test('on a phone the header fits one line and the story’s block fits the screen', async ({ browser }) => {
  const phone = await (await browser.newContext({ viewport: { width: 375, height: 664 }, isMobile: true, hasTouch: true })).newPage();
  await phone.goto('/');
  const nav = phone.getByRole('navigation', { name: 'On this page' });
  expect(await nav.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  const links = await nav.getByRole('link').evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
  expect(links).toBe(1);
  const steps = phone.locator('ol.story-steps > li');
  // Scrolling down through the story only ever moves forward, and the block stays put.
  const track = await phone.locator('.story-track').evaluate((el) => ({ top: el.getBoundingClientRect().top + window.scrollY, height: (el as HTMLElement).offsetHeight }));
  let last = 0;
  let place: number | null = null;
  for (let y = track.top; y < track.top + track.height - 700; y += 60) {
    await phone.evaluate((top) => window.scrollTo(0, top), y);
    await phone.waitForTimeout(60);
    const r = await phone.evaluate(() => ({ open: [...document.querySelectorAll('.story-steps > li')].findIndex((li) => li.getAttribute('aria-current') === 'step'), top: Math.round(document.querySelector('.story-pinned')!.getBoundingClientRect().top) }));
    expect(r.open, `no step backwards at ${y}`).toBeGreaterThanOrEqual(last);
    last = r.open;
    if (r.open > 0) {
      place ??= r.top;
      expect(Math.abs(r.top - place), `block stays put at ${y}`).toBeLessThan(2);
    }
  }
  for (const i of [1, 2, 4, 5]) {
    await scrollThrough(steps.nth(i), 0.9);
    const bottom = await phone.locator('.story-pinned').evaluate((el) => el.getBoundingClientRect().bottom);
    expect(bottom, `step ${i + 1} fits`).toBeLessThanOrEqual(664);
  }
  await phone.context().close();
});

test('each step of the story jumps straight to it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const steps = page.locator('ol.story-steps > li');
  await steps.nth(4).getByRole('button').click();
  await expect(steps.nth(4)).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('.story-stage')).toContainText('Vote on draft resolution 1.1');
  await steps.nth(1).getByRole('button').click();
  await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('.story-stage')).toContainText('Speaking now');
});

test('the story follows the rules you pick: the product’s own four presets', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const rules = page.getByRole('group', { name: 'Rules' });
  await expect(rules.getByRole('radio', { name: 'UN-style' })).toBeChecked();
  const steps = page.locator('ol.story-steps > li');
  const stage = page.locator('.story-stage');
  // Roll call: Harvard-style needs a quarter of the room for debate, the others a third.
  await steps.nth(0).getByRole('button').click();
  await expect(stage).toContainText('5 needed');
  await rules.getByText('Harvard').click();
  await expect(stage).toContainText('4 needed');
  // Motions: THIMUN-style has lobbying time and moving to the previous question, not caucuses.
  await rules.getByText('THIMUN').click();
  await scrollThrough(steps.nth(2), 0.95);
  await expect(stage).toContainText('Lobbying time');
  await expect(stage).toContainText('Move to the previous question');
  await expect(stage).toContainText('Needs: Two-thirds majority');
  await rules.getByText('Spanish-language').click();
  await expect(stage).toContainText('Unmoderated caucus · 5 min');
  await expect(stage).toContainText('Needs: Simple majority');
});

test('in Spanish, the story starts on the Spanish-language rules', async ({ page }) => {
  await page.goto('/?lang=es');
  await expect(page.getByRole('group', { name: 'Reglamento' }).getByRole('radio', { name: 'En español' })).toBeChecked();
});

test('in Spanish on a phone the wordmark keeps its size and the section links fit', async ({ browser }) => {
  for (const height of [600, 664, 844]) {
    const phone = await (await browser.newContext({ viewport: { width: 375, height }, isMobile: true })).newPage();
    await phone.goto('/?lang=es');
    const nav = phone.getByRole('navigation', { name: 'En esta página' });
    expect(await nav.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `links fit at ${height}`).toBe(true);
    const mark = await phone.locator('.opening-stage svg').first().evaluate((el) => el.getBoundingClientRect());
    expect(mark.width, `wordmark full width at ${height}`).toBeGreaterThan(300);
    expect(Math.abs(mark.height - (mark.width * 805) / 3498), `wordmark not squeezed at ${height}`).toBeLessThan(2);
    // The opening fits, so it pins and plays.
    expect(await phone.locator('.opening-stage').evaluate((el) => el.classList.contains('sticky'))).toBe(true);
    await phone.context().close();
  }
});
