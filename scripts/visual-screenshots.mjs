#!/usr/bin/env node
// Before/after screenshots for the visual refresh (docs/plans/screenshots/).
// Fresh headless Chrome (temp profile) via the playwright-core install at
// ~/.claude/scripts/comet-browser — never the user's real browser.
//
// Run: node scripts/visual-screenshots.mjs --base http://localhost:3456 --tag after
//      [--out docs/plans/screenshots] [--reduced-motion]

import { createRequire } from 'node:module';
import { mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(os.homedir(), '.claude/scripts/comet-browser/node_modules/playwright-core'));

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const BASE = arg('--base', 'http://localhost:3456');
const TAG = arg('--tag', 'after');
const OUT = path.resolve(ROOT, arg('--out', 'docs/plans/screenshots'));
const REDUCED = process.argv.includes('--reduced-motion');
mkdirSync(OUT, { recursive: true });

const FIREBASE_STUB = `window.firebase = window.firebase || { initializeApp(){}, auth: Object.assign(function(){ return { onAuthStateChanged(cb){ Promise.resolve().then(()=>cb(null)); }, signOut(){ return Promise.resolve(); } }; }, { GoogleAuthProvider: function(){} }) };`;
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
    try { return await chromium.launch({ channel: 'chrome', headless: true }); }
    catch { return chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true }); }
}

async function newPage(browser, viewport) {
    const ctx = await browser.newContext({ viewport, reducedMotion: REDUCED ? 'reduce' : 'no-preference' });
    let bytes = 0;
    const imgs = [];
    await ctx.route('**/*', (route) => {
        const url = route.request().url();
        if (url.includes('gstatic.com/firebasejs')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: FIREBASE_STUB });
        if (url.startsWith(BASE) || url.startsWith('data:') || /fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
        return route.abort();
    });
    const page = await ctx.newPage();
    page.on('response', async (r) => {
        try {
            const len = Number(r.headers()['content-length'] || 0) || (await r.body()).length;
            bytes += len;
            if (/\.(webp|jpe?g|png)(\?|$)/.test(r.url())) imgs.push(`${r.url().replace(BASE, '')} ${(len / 1024).toFixed(0)}KB`);
        } catch { /* body unavailable */ }
    });
    await page.addInitScript(() => {
        if (!localStorage.getItem('__shot-seeded')) {
            localStorage.setItem('rmd-level', 'a2');
            localStorage.setItem('__shot-seeded', '1');
        }
    });
    return { ctx, page, weight: () => ({ bytes, imgs }) };
}

async function shot(page, name, vp) {
    await sleep(900); // let entrance animations + image fades settle
    const file = path.join(OUT, `${TAG}-${vp}-${name}.png`);
    await page.screenshot({ path: file });
    console.log(`  ${path.relative(ROOT, file)} (${(statSync(file).size / 1024).toFixed(0)} KB)`);
}

async function openMode(page, mode) {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.$eval(`.mode-btn.${mode}`, (el) => el.click());
    await page.waitForFunction(() => document.querySelector('#question-content, .knm-exercise, .exercise-title'));
    await sleep(600);
}
// Scroll `sel` to just below the sticky header + mode bar (they overlay content).
const scrollTo = (page, sel) => page.$eval(sel, (el) => {
    el.scrollIntoView({ block: 'start' });
    const sticky = Math.max(0, ...[...document.querySelectorAll('.app-header, .mode-selector')]
        .map((e) => e.getBoundingClientRect().bottom));
    window.scrollBy(0, el.getBoundingClientRect().top - sticky - 12);
});

const browser = await launch();
for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
    console.log(`[${vp}]`);
    // landing + page weight of the first load
    {
        const { ctx, page, weight } = await newPage(browser, viewport);
        await page.goto(BASE, { waitUntil: 'networkidle' });
        await shot(page, 'landing', vp);
        const w = weight();
        console.log(`  landing transfer ≈ ${(w.bytes / 1024).toFixed(0)} KB; images: ${w.imgs.join(', ') || 'none'}`);
        await ctx.close();
    }
    const scenes = [
        ['schrijven', async (page) => { await openMode(page, 'schrijven'); await scrollTo(page, '#practice-area .card'); }],
        ['lezen', async (page) => { await openMode(page, 'lezen'); await scrollTo(page, '#practice-area .card'); }],
        ['luisteren', async (page) => {
            await openMode(page, 'luisteren');
            await page.evaluate(() => window.luisterenStart(0));
            await scrollTo(page, '#practice-area .card');
        }],
        ['spreken-part1', async (page) => {
            await openMode(page, 'spreken');
            await page.evaluate(() => window.sprekenStart(0, 0));
            await scrollTo(page, '#practice-area .card');
        }],
        ['spreken-picture', async (page) => {
            await openMode(page, 'spreken');
            await page.evaluate(() => window.sprekenStart(1, 0));
            await scrollTo(page, '#practice-area .card');
        }],
        ['spreken-story', async (page) => {
            await openMode(page, 'spreken');
            await page.evaluate(() => window.sprekenStart(3, 0));
            await scrollTo(page, '#practice-area .card');
        }],
        ['knm', async (page) => {
            await openMode(page, 'knm');
            await page.evaluate(() => window.knmStart(0));
            await scrollTo(page, '#practice-area .card');
        }],
        ['knm-answered', async (page) => {
            await openMode(page, 'knm');
            await page.evaluate(() => window.knmStart(0));
            await page.evaluate(() => { window.knmSelect(0); window.knmCheck(); });
            await scrollTo(page, '#practice-area .card');
        }],
        // results: answer the whole A2 lezen exam 1 (first answer wrong, rest right)
        ['results', async (page) => {
            await openMode(page, 'lezen');
            const data = await (await fetch(`${BASE}/data/a2/lezen.json`)).json();
            const n = data.exams.exam1.questions.length;
            for (let i = 0; i < n; i++) {
                await page.evaluate(() => {
                    const opts = document.querySelectorAll('#options .option');
                    return opts.length;
                });
                const q = data.exams.exam1.questions[i];
                await page.evaluate((idx) => { selectLezenOption(idx); checkLezenAnswer(); nextLezenQuestion(); },
                    i === 0 ? (q.correct + 1) % q.options.length : q.correct);
            }
            await scrollTo(page, '#practice-area .card');
            await sleep(1800); // count-up + confetti
        }],
    ];
    for (const [name, fn] of scenes) {
        const { ctx, page } = await newPage(browser, viewport);
        try { await fn(page); await shot(page, name, vp); }
        catch (e) { console.log(`  ! ${name}: ${e.message}`); }
        await ctx.close();
    }
}
await browser.close();
