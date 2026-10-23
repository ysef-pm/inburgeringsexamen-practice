#!/usr/bin/env node
// E2E regression sweep for the B1 mode (plan Task 13).
//
// Standalone headless Playwright against a locally spawned `node server.js`.
// Uses the playwright-core install at ~/.claude/scripts/comet-browser (no
// project dependency added) driving the system Google Chrome with a fresh
// temp profile — NEVER the user's real browser.
//
// Run: node scripts/e2e-b1.mjs
// Exit code 0 only when every check passes on BOTH viewports.

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require(
    path.join(os.homedir(), '.claude/scripts/comet-browser/node_modules/playwright-core')
);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.E2E_PORT || 3971; // NOT 3456 (dev default), NOT 3499 (known-stale holder)
const BASE = `http://localhost:${PORT}`;

// ---- ground truth from the content files (assertions are data-driven) ------
const data = (p) => JSON.parse(readFileSync(path.join(ROOT, 'public/data', p), 'utf8'));
const a2Schrijven = data('a2/schrijven.json');
const b1Schrijven = data('b1/schrijven.json');
const a2Lezen = data('a2/lezen.json');
const b1Lezen = data('b1/lezen.json');
const b1Spreken = data('b1/spreken.json');
const a2Luisteren = data('a2/luisteren.json');
const b1Luisteren = data('b1/luisteren.json');
const knm = data('knm-exercises.json');

const A2_Q1_SNIPPET = a2Schrijven.questions[0].prompt.slice(0, 40);
const B1_Q1_SNIPPET = b1Schrijven.questions[0].prompt.slice(0, 40);
const B1_Q1_GUIDANCE = `Richtlijn: ${b1Schrijven.questions[0].wordGuidance}`;

// ---- tiny check harness ----------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];

function report(name, ok, detail) {
    if (ok) { passed++; console.log(`PASS  ${name}`); }
    else {
        failed++;
        failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
        console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

function assert(cond, label) {
    if (!cond) throw new Error(`assert failed: ${label}`);
}

// ---- server ----------------------------------------------------------------
async function startServer() {
    const proc = spawn('node', ['server.js'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(PORT) },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        try {
            const r = await fetch(`${BASE}/data/a2/schrijven.json`, { method: 'HEAD' });
            if (r.ok) return proc;
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 200));
    }
    proc.kill();
    throw new Error(`server did not come up on :${PORT}`);
}

// ---- browser helpers -------------------------------------------------------
async function launchBrowser() {
    try {
        return await chromium.launch({ channel: 'chrome', headless: true });
    } catch (e) {
        // Fall back to an explicit system Chrome path (macOS)
        return chromium.launch({
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            headless: true,
        });
    }
}

/**
 * Fresh context per scenario. `seed` = localStorage entries written before any
 * page script runs. Also installs an Audio-constructor spy (the luisteren
 * player uses `new Audio(src)`, no <audio> element in the DOM) and blocks all
 * non-localhost requests so the sweep is deterministic offline.
 */
// auth.js assumes the firebase compat SDK loaded from gstatic. The sweep runs
// offline-deterministic, so those two script tags get a minimal stub instead:
// enough for auth.js to initialize with no signed-in user (the production
// "configured, signed out" code path).
const FIREBASE_STUB = `
window.firebase = window.firebase || {
    initializeApp: function () {},
    auth: Object.assign(function () {
        return {
            onAuthStateChanged: function (cb) { Promise.resolve().then(function () { cb(null); }); },
            signOut: function () { return Promise.resolve(); },
        };
    }, { GoogleAuthProvider: function () {} }),
};`;

async function newPage(browser, viewport, { seed = {}, fakeClock = false } = {}) {
    const ctx = await browser.newContext({ viewport });
    await ctx.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
        if (url.includes('gstatic.com/firebasejs')) {
            return route.fulfill({ status: 200, contentType: 'application/javascript', body: FIREBASE_STUB });
        }
        return route.abort();
    });
    const page = await ctx.newPage();
    await page.addInitScript((entries) => {
        // Seed exactly once per context — init scripts re-run on every
        // navigation, and re-seeding would undo in-app localStorage changes
        // (e.g. a level switch that reloads the page).
        if (!localStorage.getItem('__e2e-seeded')) {
            for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
            localStorage.setItem('__e2e-seeded', '1');
        }
        // Audio constructor spy
        window.__audioSrcs = [];
        const RealAudio = window.Audio;
        window.Audio = function (src) {
            window.__audioSrcs.push(src);
            return new RealAudio(src);
        };
        window.Audio.prototype = RealAudio.prototype;
    }, seed);
    if (fakeClock) await page.clock.install();
    return { ctx, page };
}

const sheetVisible = (page) =>
    page.evaluate(() => !document.getElementById('level-sheet').classList.contains('hidden'));
const storedLevel = (page) => page.evaluate(() => localStorage.getItem('rmd-level'));
const badgeText = (page) =>
    page.evaluate(() => document.getElementById('level-badge').textContent.trim());
// Programmatic click: works identically at 390px (where the sidebar is an
// off-canvas drawer) and on desktop.
const click = (page, sel) => page.$eval(sel, (el) => el.click());
const textOf = (page, sel) => page.$eval(sel, (el) => el.textContent);

async function waitFor(page, fn, label, timeout = 8000) {
    const deadline = Date.now() + timeout;
    let lastErr;
    while (Date.now() < deadline) {
        try { if (await fn()) return; } catch (e) { lastErr = e; }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timeout waiting for ${label}${lastErr ? ` (${lastErr.message})` : ''}`);
}

const waitForSelector = (page, sel, timeout) =>
    waitFor(page, () => page.$eval(sel, () => true).catch(() => false), sel, timeout);
const waitForText = (page, sel, text, timeout) =>
    waitFor(
        page,
        () => page.evaluate(
            ({ sel, text }) => [...document.querySelectorAll(sel)].some((e) => e.textContent.includes(text)),
            { sel, text }
        ),
        `${sel} containing "${text}"`,
        timeout
    );

// ---- scenarios -------------------------------------------------------------
async function run(browser, viewport, tag) {
    const T = (name) => `[${tag}] ${name}`;

    // Wraps one scenario in a fresh context and turns thrown asserts into FAILs.
    async function scenario(name, opts, fn) {
        const { ctx, page } = await newPage(browser, viewport, opts);
        try {
            await fn(page);
            report(T(name), true);
        } catch (e) {
            report(T(name), false, e.message);
        } finally {
            await ctx.close();
        }
    }

    // 1. Fresh visitor + Schrijven → level sheet, English strings
    await scenario('fresh schrijven shows level sheet (English)', {}, async (page) => {
        await page.goto(BASE);
        await click(page, '.mode-btn.schrijven');
        await waitFor(page, () => sheetVisible(page), 'level sheet');
        const sheet = await textOf(page, '#level-sheet');
        for (const s of [
            'Which exam are you preparing for?',
            'Wet inburgering 2013',
            'Wet inburgering 2021',
            'before 1 Jan 2022',
            'on or after 1 Jan 2022',
            "I'm not sure",
        ]) assert(sheet.includes(s), `sheet text "${s}"`);
        assert((await storedLevel(page)) === null, 'no level stored yet');
    });

    // 2. Pick A2 → sheet closes, A2 schrijven q1 renders, level persisted
    await scenario('choose A2 renders A2 schrijven q1', {}, async (page) => {
        await page.goto(BASE);
        await click(page, '.mode-btn.schrijven');
        await waitFor(page, () => sheetVisible(page), 'level sheet');
        await click(page, '#level-choice-a2');
        await waitFor(page, async () => !(await sheetVisible(page)), 'sheet closed');
        await waitForText(page, '.prompt', A2_Q1_SNIPPET);
        assert((await storedLevel(page)) === 'a2', "rmd-level === 'a2'");
        assert((await badgeText(page)).startsWith('A2'), 'badge shows A2');
        const sidebar = await textOf(page, '#exam-sidebar');
        assert(sidebar.includes('Original Exercises (10)'), 'A2 sidebar sections');
    });

    // 3. Pick B1 → B1 schrijven q1 with wordGuidance + register sections
    await scenario('choose B1 renders B1 schrijven with wordGuidance', {}, async (page) => {
        await page.goto(BASE);
        await click(page, '.mode-btn.schrijven');
        await waitFor(page, () => sheetVisible(page), 'level sheet');
        await click(page, '#level-choice-b1');
        await waitForText(page, '.prompt', B1_Q1_SNIPPET);
        assert((await storedLevel(page)) === 'b1', "rmd-level === 'b1'");
        assert((await badgeText(page)).startsWith('B1'), 'badge shows B1');
        const content = await textOf(page, '#question-content');
        assert(content.includes(B1_Q1_GUIDANCE), `"${B1_Q1_GUIDANCE}" shown`);
        const sidebar = await textOf(page, '#exam-sidebar');
        assert(sidebar.includes('Formele brieven en e-mails (12)'), 'formal section (12)');
        assert(sidebar.includes('Informele berichten (8)'), 'informal section (8)');
        const items = await page.$$eval('#exam-sidebar .exercise-item', (l) => l.length);
        assert(items === 20, `20 assignments listed (got ${items})`);
    });

    // 4. Decision helper → before 2022 → A2
    await scenario('helper "before 2022" resolves to A2', {}, async (page) => {
        await page.goto(BASE);
        await click(page, '.mode-btn.schrijven');
        await waitFor(page, () => sheetVisible(page), 'level sheet');
        await click(page, '#level-helper-link');
        await waitForSelector(page, '#level-sheet-helper:not(.hidden)');
        await click(page, '#level-helper-before');
        const confirm = await textOf(page, '#level-helper-confirm');
        assert(confirm.includes('Wi2013'), 'Wi2013 confirmation');
        await click(page, '#level-helper-continue');
        await waitFor(page, async () => !(await sheetVisible(page)), 'sheet closed');
        assert((await storedLevel(page)) === 'a2', 'helper picked a2');
        await waitForText(page, '.prompt', A2_Q1_SNIPPET); // pending mode resumed
    });

    // 5. Decision helper → on/after 2022 → B1
    await scenario('helper "on or after 2022" resolves to B1', {}, async (page) => {
        await page.goto(BASE);
        await click(page, '.mode-btn.schrijven');
        await waitFor(page, () => sheetVisible(page), 'level sheet');
        await click(page, '#level-helper-link');
        await click(page, '#level-helper-after');
        const confirm = await textOf(page, '#level-helper-confirm');
        assert(confirm.includes('Wi2021'), 'Wi2021 confirmation');
        await click(page, '#level-helper-continue');
        await waitFor(page, async () => !(await sheetVisible(page)), 'sheet closed');
        assert((await storedLevel(page)) === 'b1', 'helper picked b1');
    });

    // 6. Decision helper → "I don't know" → Mijn Inburgering card
    await scenario('helper "I don\'t know" shows Mijn Inburgering card', {}, async (page) => {
        await page.goto(BASE);
        await click(page, '.mode-btn.schrijven');
        await waitFor(page, () => sheetVisible(page), 'level sheet');
        await click(page, '#level-helper-link');
        await click(page, '#level-helper-unknown-btn');
        await waitForSelector(page, '#level-helper-unknown:not(.hidden)');
        const card = await textOf(page, '#level-helper-unknown');
        assert(card.includes('Mijn Inburgering'), 'Mijn Inburgering mentioned');
        assert(card.includes('DigiD'), 'DigiD mentioned');
        const href = await page.$eval('#level-helper-unknown a', (a) => a.href);
        assert(href.includes('inburgeren.nl'), 'inburgeren.nl link');
        assert((await storedLevel(page)) === null, 'no level chosen');
    });

    // 7. rmd-inline-state is written by the scorecard's inline writing demo
    // (public/js/inline-practice.js) — scorecard converts are NOT existing
    // practice users, so it must NOT suppress the level chooser.
    await scenario('inline-state-only visitor (scorecard demo) still gets level sheet', {
        seed: { 'rmd-inline-state': '{"mode":"schrijven"}' },
    }, async (page) => {
        await page.goto(BASE);
        await click(page, '.mode-btn.lezen');
        await waitFor(page, () => sheetVisible(page), 'level sheet');
        assert((await storedLevel(page)) === null, 'no level auto-set');
    });

    // 8. Existing user (progress key) → silently A2, no sheet
    await scenario('existing user (rmd-progress-luisteren) skips sheet', {
        seed: { 'rmd-progress-luisteren': '{}' },
    }, async (page) => {
        await page.goto(BASE);
        await click(page, '.mode-btn.spreken');
        await waitForText(page, '#exam-sidebar', 'Deel 1');
        assert(!(await sheetVisible(page)), 'no level sheet');
        assert((await storedLevel(page)) === 'a2', 'silently defaulted to a2');
    });

    // 9. CRITICAL regression: scorecard sid alone must NOT count as existing user
    await scenario('scorecard-sid-only visitor still gets level sheet', {
        seed: { 'rmd-scorecard-sid': 'sid_test_123' },
    }, async (page) => {
        await page.goto(BASE);
        await click(page, '.mode-btn.spreken');
        await waitFor(page, () => sheetVisible(page), 'level sheet');
        assert((await storedLevel(page)) === null, 'no level auto-set');
    });

    // 10. CRITICAL regression: rmd-last-result alone must NOT suppress the sheet
    await scenario('last-result-only visitor still gets level sheet', {
        seed: { 'rmd-last-result': '{"skill":"schrijven"}' },
    }, async (page) => {
        await page.goto(BASE);
        await click(page, '.mode-btn.luisteren');
        await waitFor(page, () => sheetVisible(page), 'level sheet');
        assert((await storedLevel(page)) === null, 'no level auto-set');
    });

    // 11. Badge reopens the sheet with the current level marked
    await scenario('badge reopens sheet with Current chip', {
        seed: { 'rmd-level': 'a2' },
    }, async (page) => {
        await page.goto(BASE);
        await click(page, '#level-badge');
        await waitFor(page, () => sheetVisible(page), 'level sheet');
        const chipA2Hidden = await page.$eval('#level-chip-a2', (el) => el.classList.contains('hidden'));
        const chipB1Hidden = await page.$eval('#level-chip-b1', (el) => el.classList.contains('hidden'));
        assert(!chipA2Hidden, 'A2 marked Current');
        assert(chipB1Hidden, 'B1 not marked Current');
        const noteHidden = await page.$eval('#level-switch-note', (el) => el.classList.contains('hidden'));
        assert(!noteHidden, 'switch-reload note shown');
    });

    // 12. Switching A2→B1 via badge reloads into B1 lezen (6 passages, 30 q)
    await scenario('badge switch A2→B1 reloads into B1 lezen', {
        seed: { 'rmd-level': 'a2' },
    }, async (page) => {
        await page.goto(`${BASE}/#lezen`);
        await waitForSelector(page, '.reading-text'); // A2 lezen up first
        await click(page, '#level-badge');
        await waitFor(page, () => sheetVisible(page), 'level sheet');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
            // chooseLevel reloads synchronously — the click's own evaluation
            // context can be torn down mid-call, which is expected here.
            click(page, '#level-choice-b1').catch(() => {}),
        ]);
        await waitForSelector(page, '.reading-text');
        assert((await storedLevel(page)) === 'b1', 'level switched to b1');
        const sidebar = await textOf(page, '#exam-sidebar');
        const names = Object.values(b1Lezen.exams.exam1.sectionNames);
        assert(names.length === 6, '6 passages in data');
        for (const n of names) assert(sidebar.includes(n), `passage "${n}" listed`);
        const items = await page.$$eval('#exam-sidebar .exercise-item', (l) => l.length);
        assert(items === 30, `30 questions listed (got ${items})`);
    });

    // 13. A2 lezen renders exam1 + answering works (Check → feedback → Next)
    await scenario('A2 lezen exam1 answer flow', {
        seed: { 'rmd-level': 'a2' },
    }, async (page) => {
        await page.goto(BASE);
        await click(page, '.mode-btn.lezen');
        await waitForSelector(page, '.reading-text');
        const sidebar = await textOf(page, '#exam-sidebar');
        for (const n of Object.values(a2Lezen.exams.exam1.sectionNames).slice(0, 3)) {
            assert(sidebar.includes(n), `A2 passage "${n}" listed`);
        }
        assert(sidebar.includes(`${a2Lezen.exams.exam1.name} (${a2Lezen.exams.exam1.questions.length} questions)`), 'exam selector label');
        await click(page, '.option[data-index="0"]');
        await click(page, '#check-btn');
        await waitForSelector(page, '#feedback-area .feedback');
        const nextVisible = await page.$eval('#next-btn', (el) => el.style.display !== 'none');
        assert(nextVisible, 'Next appears after checking');
    });

    // 14. A2 luisteren: options render + audio src under /audio/luisteren/
    await scenario('A2 luisteren q1 audio src', {
        seed: { 'rmd-level': 'a2' },
        fakeClock: true,
    }, async (page) => {
        await page.goto(BASE);
        await click(page, '.mode-btn.luisteren');
        await waitForText(page, '#exam-sidebar', 'Luisteren Vragen');
        await click(page, '#exam-sidebar .exercise-item');
        await waitForText(page, '#question-content', 'Vraag 1 / 10');
        const options = await page.$$eval('.option-btn', (l) => l.length);
        assert(options === a2Luisteren.exams.exam1.questions[0].options.length, `options rendered (got ${options})`);
        // reading-time countdown gates audio creation — fast-forward it
        await page.clock.runFor((a2Luisteren.exams.exam1.questions[0].readingTime + 2) * 1000);
        await waitFor(
            page,
            () => page.evaluate(() => window.__audioSrcs.length > 0),
            'Audio constructed'
        );
        const srcs = await page.evaluate(() => window.__audioSrcs);
        assert(srcs.some((s) => s === '/audio/luisteren/exam1/q1.mp3'), `A2 audio src (got ${srcs.join(',')})`);
    });

    // 15. A2 spreken: exam1 part 1 renders, exercise opens with prep timer
    await scenario('A2 spreken part 1 renders', {
        seed: { 'rmd-level': 'a2' },
    }, async (page) => {
        await page.goto(BASE);
        await click(page, '.mode-btn.spreken');
        await waitForText(page, '#exam-sidebar', 'Deel 1: Vragen beantwoorden (4)');
        await click(page, '#exam-sidebar .exercise-item');
        await waitForText(page, '#question-content', 'Deel 1: Vragen beantwoorden — Oefening 1');
        const content = await textOf(page, '#question-content');
        assert(content.includes('Voorbereidingstijd'), 'prep timer shown');
        assert(content.includes('Begin opname'), 'record button shown');
    });

    // 16. A2 schrijven q1 renders with level pre-set (no sheet)
    await scenario('A2 schrijven q1 renders without sheet', {
        seed: { 'rmd-level': 'a2' },
    }, async (page) => {
        await page.goto(BASE);
        await click(page, '.mode-btn.schrijven');
        await waitForText(page, '.prompt', A2_Q1_SNIPPET);
        assert(!(await sheetVisible(page)), 'no level sheet');
        const items = await page.$$eval('#exam-sidebar .exercise-item', (l) => l.length);
        assert(items === a2Schrijven.questions.length, `${a2Schrijven.questions.length} A2 prompts listed (got ${items})`);
    });

    // 17. KNM is level-free: fresh visitor, no sheet, questions render
    await scenario('KNM untouched: no sheet, questions render', {}, async (page) => {
        await page.goto(BASE);
        await click(page, '.mode-btn.knm');
        await waitForText(page, '#question-content', knm.exams.exam1.title);
        assert(!(await sheetVisible(page)), 'no level sheet for KNM');
        assert((await storedLevel(page)) === null, 'KNM sets no level');
        const items = await page.$$eval('#exam-sidebar .exercise-item', (l) => l.length);
        assert(items === knm.exams.exam1.questions.length, `KNM ${knm.exams.exam1.questions.length}q listed (got ${items})`);
    });

    // 17b. Visual refresh: every mode renders its scene illustration and it loads
    await scenario('scene illustrations render + load in all 5 modes', { seed: { 'rmd-level': 'a2' } }, async (page) => {
        const loaded = (sel) => page.$eval(sel, (img) => img.complete && img.naturalWidth > 0).catch(() => false);
        const expectScene = async (label, sel, src) => {
            await waitFor(page, () => loaded(sel), `${label} image loaded`, 10000);
            const got = await page.$eval(sel, (img) => img.getAttribute('src'));
            assert(got === `/images/${src}`, `${label} src ${got} === /images/${src}`);
            const alt = await page.$eval(sel, (img) => img.alt);
            assert(alt && alt.length > 3, `${label} has alt text`);
        };
        await page.goto(BASE);
        await click(page, '.mode-btn.lezen');
        await waitForSelector(page, '.reading-text');
        await expectScene('lezen', '#question-content .scene-card img', a2Lezen.exams.exam1.questions[0].image);
        await click(page, '.mode-btn.schrijven');
        await waitForText(page, '.prompt', A2_Q1_SNIPPET);
        await expectScene('schrijven', '#question-content .scene-card img', a2Schrijven.questions[0].image);
        await click(page, '.mode-btn.luisteren');
        await waitForSelector(page, '#exam-sidebar .exercise-item');
        await page.evaluate(() => window.luisterenStart(0));
        await expectScene('luisteren', '#question-content .scene-card img', a2Luisteren.exams.exam1.questions[0].image);
        await click(page, '.mode-btn.knm');
        await waitForSelector(page, '#exam-sidebar .exercise-item');
        await page.evaluate(() => window.knmStart(0));
        await expectScene('knm', '.scenario-block .scene-card img', knm.exams.exam1.questions[0].image);
        await click(page, '.mode-btn.spreken');
        await waitForSelector(page, '#exam-sidebar .exercise-item');
        await page.evaluate(() => window.sprekenStart(1, 0)); // part 2: picture exercise
        await waitFor(page, () => loaded('.exercise-image img'), 'spreken picture loaded', 10000);
        const pic = await page.$eval('.exercise-image img', (img) => img.getAttribute('src'));
        assert(/^\/images\/scenes\/.+\.webp$/.test(pic), `spreken picture is an illustration (${pic})`);
        const broken = await page.$$eval('img', (l) => l.filter((i) => i.complete && i.naturalWidth === 0).length);
        assert(broken === 0, `no broken images (got ${broken})`);
    });

    // 17c. Luisteren end-of-set result: score + count-up target rendered
    await scenario('luisteren last question shows a result summary', { seed: { 'rmd-level': 'a2' } }, async (page) => {
        await page.goto(BASE);
        await click(page, '.mode-btn.luisteren');
        await waitForSelector(page, '#exam-sidebar .exercise-item');
        const last = a2Luisteren.exams.exam1.questions.length - 1;
        await page.evaluate((i) => window.luisterenStart(i), last);
        // skip the reading/audio phase: enable options the way the module does
        await page.evaluate(() => document.querySelectorAll('.option-btn').forEach((b) => { b.disabled = false; }));
        await page.evaluate(() => { document.getElementById('action-area').innerHTML = '<button class="btn btn-primary" id="check-btn" onclick="window.luisterenCheck()">x</button>'; });
        const q = a2Luisteren.exams.exam1.questions[last];
        await page.evaluate((c) => { window.luisterenSelect(c); window.luisterenCheck(); window.luisterenNext(); }, q.correctAnswer);
        await waitForSelector(page, '.rmd-result');
        const total = await page.$eval('.rmd-result', (el) => el.dataset.total);
        const correct = await page.$eval('.rmd-result', (el) => el.dataset.correct);
        assert(total === '1' && correct === '1', `result 1/1 (got ${correct}/${total})`);
    });

    // 18. B1 lezen structure: 2 exams × 30 q / 6 passages + answer flow works
    await scenario('B1 lezen structure (2×30q, 6 passages) + answer flow', {
        seed: { 'rmd-level': 'b1' },
    }, async (page) => {
        await page.goto(BASE);
        await click(page, '.mode-btn.lezen');
        await waitForSelector(page, '.reading-text');
        for (const examKey of ['exam1', 'exam2']) {
            if (examKey === 'exam2') {
                await page.evaluate(() => window.switchLezenExam('exam2'));
                await waitForText(page, '#exam-sidebar', Object.values(b1Lezen.exams.exam2.sectionNames)[0]);
            }
            const exam = b1Lezen.exams[examKey];
            assert(exam.questions.length === 30, `${examKey} has 30 q in data`);
            const sidebar = await textOf(page, '#exam-sidebar');
            const names = Object.values(exam.sectionNames);
            assert(names.length === 6, `${examKey} 6 passages`);
            for (const n of names) assert(sidebar.includes(n), `${examKey} passage "${n}"`);
            const items = await page.$$eval('#exam-sidebar .exercise-item', (l) => l.length);
            assert(items === 30, `${examKey}: 30 listed (got ${items})`);
            assert(sidebar.includes(`${exam.name} (30 questions)`), `${examKey} selector label`);
        }
        // Answer flow regression (completion tracking must know B1 sections)
        await click(page, '.option[data-index="0"]');
        await click(page, '#check-btn');
        await waitForSelector(page, '#feedback-area .feedback');
        const nextVisible = await page.$eval('#next-btn', (el) => el.style.display !== 'none');
        assert(nextVisible, 'Next appears after checking B1 answer');
    });

    // 19. B1 luisteren: audio srcs under /audio/b1-luisteren/
    await scenario('B1 luisteren q1 audio src', {
        seed: { 'rmd-level': 'b1' },
        fakeClock: true,
    }, async (page) => {
        await page.goto(BASE);
        await click(page, '.mode-btn.luisteren');
        await waitForText(page, '#exam-sidebar', 'Luisteren Vragen');
        const items = await page.$$eval('#exam-sidebar .exercise-item', (l) => l.length);
        assert(items === b1Luisteren.exams.exam1.questions.length, `B1 luisteren ${b1Luisteren.exams.exam1.questions.length}q (got ${items})`);
        await click(page, '#exam-sidebar .exercise-item');
        await waitForText(page, '#question-content', 'Vraag 1 / 10');
        await page.clock.runFor((b1Luisteren.exams.exam1.questions[0].readingTime + 2) * 1000);
        await waitFor(
            page,
            () => page.evaluate(() => window.__audioSrcs.length > 0),
            'Audio constructed'
        );
        const srcs = await page.evaluate(() => window.__audioSrcs);
        assert(srcs.some((s) => s === '/audio/b1-luisteren/exam1/q1.mp3'), `B1 audio src (got ${srcs.join(',')})`);
        assert(b1Luisteren.exams.exam1.questions.every((q) => q.audioFile.startsWith('b1-luisteren/')), 'all B1 audioFiles under b1-luisteren/');
    });

    // 20. B1 spreken: 4 parts (4/4/2/2), 8 short + 4 long, parts 3-4 resp 75s
    await scenario('B1 spreken structure (4/4/2/2, long=75s)', {
        seed: { 'rmd-level': 'b1' },
    }, async (page) => {
        await page.goto(BASE);
        await click(page, '.mode-btn.spreken');
        const parts = b1Spreken.exams.exam1.parts;
        assert(parts.length === 4, '4 parts in data');
        await waitForText(page, '#exam-sidebar', `Deel 1: ${parts[0].title} (4)`);
        const sidebar = await textOf(page, '#exam-sidebar');
        const counts = parts.map((p) => p.exercises.length);
        assert(JSON.stringify(counts) === '[4,4,2,2]', `part sizes 4/4/2/2 (got ${counts})`);
        parts.forEach((p) => {
            assert(sidebar.includes(`Deel ${p.partNumber}: ${p.title} (${p.exercises.length})`), `sidebar: Deel ${p.partNumber}`);
        });
        const taskTypes = parts.flatMap((p) => p.exercises.map((e) => e.taskType));
        assert(taskTypes.filter((t) => t === 'short').length === 8, '8 short tasks');
        assert(taskTypes.filter((t) => t === 'long').length === 4, '4 long tasks');
        assert(parts[2].responseTime === 75 && parts[3].responseTime === 75, 'parts 3-4 responseTime 75');
        assert(parts[0].responseTime === 30 && parts[1].responseTime === 30, 'parts 1-2 responseTime 30');
        // An exercise opens with the shared prep-timer/record UI
        await click(page, '#exam-sidebar .exercise-item');
        await waitForText(page, '#question-content', 'Oefening 1');
        const content = await textOf(page, '#question-content');
        assert(content.includes('Begin opname'), 'record button shown');
    });

    // 21. Grading stub (B1): request carries level b1; UI shows B1 rubric badge
    await scenario('grade-writing stub: B1 rubric badge + Samenhang card', {
        seed: { 'rmd-level': 'b1' },
    }, async (page) => {
        let capturedBody = null;
        await page.route('**/api/grade-writing', async (route) => {
            capturedBody = JSON.parse(route.request().postData());
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    level: 'b1',
                    grading: {
                        total: 8,
                        scores: {
                            execution: { score: 3, justification: 'Alle punten behandeld.' },
                            grammar: { score: 2, justification: 'Goede zinsbouw.' },
                            spelling: { score: 1, justification: 'Één spelfout.' },
                            clearness: { score: 1, justification: 'Duidelijke alinea-opbouw.' },
                            vocabulary: { score: 1, justification: 'Passend register.' },
                        },
                        grammarErrors: [],
                        spellingErrors: [],
                        strengths: ['Goede opbouw'],
                        improvements: ['Meer verbindingswoorden'],
                        overallFeedback: 'Sterke formele brief.',
                    },
                }),
            });
        });
        await page.goto(BASE);
        await click(page, '.mode-btn.schrijven');
        await waitForText(page, '.prompt', B1_Q1_SNIPPET);
        await page.evaluate(() => {
            document.getElementById('user-answer').value =
                'Geachte heer/mevrouw, ik schrijf u omdat mijn wasmachine kapot is. Met vriendelijke groet.';
        });
        await click(page, '#ai-grade-btn');
        await waitForSelector(page, '.ai-grading-result');
        assert(capturedBody && capturedBody.level === 'b1', `request body level=b1 (got ${capturedBody && capturedBody.level})`);
        const badge = await textOf(page, '.rubric-level-badge');
        assert(badge.includes('Graded against B1 (Staatsexamen Nt2 Programma I) criteria'), `B1 rubric badge (got "${badge.trim()}")`);
        const cards = await page.$$eval('.ai-score-card h5', (l) => l.map((e) => e.textContent));
        assert(cards.includes('Organization / Coherence (Samenhang)'), `Samenhang card (got ${cards.join(' | ')})`);
        assert(!cards.includes('Clearness'), 'no A2 Clearness card at B1');
    });

    // 22. Grading stub (A2): request carries level a2; UI shows A2 rubric badge
    await scenario('grade-writing stub: A2 rubric badge + Clearness card', {
        seed: { 'rmd-level': 'a2' },
    }, async (page) => {
        let capturedBody = null;
        await page.route('**/api/grade-writing', async (route) => {
            capturedBody = JSON.parse(route.request().postData());
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    level: 'a2',
                    grading: {
                        total: 9,
                        scores: {
                            execution: { score: 3, justification: 'Volledig.' },
                            grammar: { score: 2, justification: 'Prima.' },
                            spelling: { score: 2, justification: 'Foutloos.' },
                            clearness: { score: 1, justification: 'Duidelijk.' },
                            vocabulary: { score: 1, justification: 'Voldoende.' },
                        },
                    },
                }),
            });
        });
        await page.goto(BASE);
        await click(page, '.mode-btn.schrijven');
        await waitForText(page, '.prompt', A2_Q1_SNIPPET);
        await page.evaluate(() => {
            document.getElementById('user-answer').value = 'Beste meneer, ik ben ziek vandaag. Groeten, Youssef.';
        });
        await click(page, '#ai-grade-btn');
        await waitForSelector(page, '.ai-grading-result');
        assert(capturedBody && capturedBody.level === 'a2', `request body level=a2 (got ${capturedBody && capturedBody.level})`);
        const badge = await textOf(page, '.rubric-level-badge');
        assert(badge.includes('Graded against A2 (inburgeringsexamen) criteria'), `A2 rubric badge (got "${badge.trim()}")`);
        const cards = await page.$$eval('.ai-score-card h5', (l) => l.map((e) => e.textContent));
        assert(cards.includes('Clearness'), 'Clearness card at A2');
        assert(!cards.includes('Organization / Coherence (Samenhang)'), 'no Samenhang card at A2');
    });
}

// ---- main ------------------------------------------------------------------
const server = await startServer();
const browser = await launchBrowser();
try {
    await run(browser, { width: 390, height: 844 }, '390px');
    await run(browser, { width: 1280, height: 800 }, 'desktop');
} finally {
    await browser.close();
    server.kill();
}

console.log('');
if (failed > 0) {
    console.log(`${failed} CHECK(S) FAILED, ${passed} passed:`);
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
}
console.log(`ALL ${passed} CHECKS PASSED (390px + desktop)`);
