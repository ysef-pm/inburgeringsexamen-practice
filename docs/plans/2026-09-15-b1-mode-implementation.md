# B1 Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task.

**Goal:** Add a B1 practice level (Staatsexamen Nt2 Programma I format) alongside A2, with a level chooser + decision helper, level-aware AI grading, and full regression coverage.

**Architecture:** All four language skills load from level-keyed JSON (`public/data/{a2,b1}/{mode}.json`) through one loader keyed on `localStorage['rmd-level']` (default `'a2'`). A2 content is extracted from `index.html`/existing JSONs byte-for-byte. Grading endpoints take an optional `level` param selecting A2 or B1 rubric prompts from a new `lib/grading-prompts.js`. KNM, paywall, Stripe, and scorecard are untouched.

**Tech Stack:** Vanilla JS frontend (no framework), Express `server.js`, `node --test` for tests, standalone Playwright (via `npx playwright`, NOT the extension bridge) for E2E, OpenAI tts-1 for luisteren audio via existing `scripts/generate-assets.js`.

**Design doc:** `docs/plans/2026-09-15-b1-mode-design.md` — read it first; it contains the validated decisions, official B1 exam formats, and the classification rule for the decision helper.

**Working directory:** `.worktrees/b1-mode` (branch `feature/b1-mode`). Baseline: 46/46 tests pass via `npm test`.

**Commit after every task.** Configure git identity first if needed: `git config user.email "ysef95@gmail.com" && git config user.name "Youssef Hounat"`.

---

## Key existing-code facts (verified 2026-09-15)

- `index.html` (~3877 lines): `schrijvenQuestions` (44 items) at ~line 1825; `lezenQuestions` (25) at ~2056; `lezenQuestions2` (25) at ~2270; `lezenExams` object (exam1/exam2 with `sections`/`sectionNames` built by filtering on `q.passage`) at ~2485. Lezen passage text is embedded per-question (`passage`, `passageTitle`, `text` fields) — no separate passages const.
- Mode buttons call `startMode('schrijven'|'lezen'|'spreken'|'luisteren'|'knm')` (~line 1721).
- `public/js/luisteren.js:12` fetches `/data/luisteren-exercises.json`; `public/js/spreken.js:12` fetches `/data/spreken-exercises.json`; `public/js/knm.js:22` fetches `/data/knm-exercises.json` (knm stays).
- Grading calls: `index.html:3298` (`/api/grade-writing`, sometimes via `window.RMDAuth.authedFetch`), `public/js/inline-practice.js:406` (grade-writing — SCORECARD flow, DO NOT touch), `public/js/spreken.js:233` (`/api/grade-speaking`).
- `server.js` (612 lines): `POST /api/grade-writing` at ~257 with A2 system prompt inline at ~275; `POST /api/grade-speaking` at ~499 with A2 rubric at ~467–510. Middleware `requirePaidOrFreeGrade` / `requirePaid` — DO NOT modify.
- Tests: `test/*.test.js`, run `npm test` (`node --test "test/*.test.js"`). Style: unit tests over `lib/` modules, no HTTP server spin-up.
- A2 volumes: lezen 2×25, luisteren 3×10, spreken 3×10 (4 parts), schrijven 44, knm 1×20.

## B1 format specs (author content to these — from design doc research)

- **Lezen B1:** 2 exams × 30 MC questions = 6 texts × 5 questions each. Texts 150–350 words, B1 topics (work, education, official letters, society, opinion pieces). Fields per question: `passage`, `passageTitle`, `text` (full text, repeated per question of same passage — matches A2 shape), `question`, `options` (3–4), `correctAnswer` (index), `explanation`.
- **Luisteren B1:** 3 exams × 10 questions. Transcripts 60–150 words (45–90s spoken), monologues/announcements/dialogues on B1 topics. Fields: `id`, `questionText`, `audioFile` (`audio/b1-luisteren/exam{N}/q{n}.mp3`), `transcript`, `readingTime`, `options`, `correctAnswer`, `explanation`.
- **Spreken B1:** 3 exams × 12 tasks in parts: part 1–2 = 8 short tasks (`taskType:"short"`, prepTime 10s, responseTime 30s), part 3–4 = 4 long tasks (`taskType:"long"`, prepTime 20s, responseTime 60–90s; expect developed structured answers with reasons). Fields as A2 spreken (`id`, `prompt`, `images` (usually `[]`), `tipText`) + `taskType`.
- **Schrijven B1:** 20 assignments. Each: real Nt2-I task types (formal/informal letter or email, complaint, application, note with argumentation), `prompt` with bullet requirements, `wordGuidance` (e.g. "±100 woorden"), `modelAnswer` at B1 (connectors, paragraphs), `tipText`.
- All content **original** — DUO oefenexamens are format reference only, never copied. Dutch content, English UI labels.
- Every B1 item includes `explanation`/`modelAnswer`/`tipText` parity with A2.

---

### Task 1: Level store + content loader (`public/js/content.js`)

**Files:**
- Create: `public/js/content.js`
- Test: `test/content-loader.test.js`

**Step 1: Write the failing test** (`test/content-loader.test.js`):

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeLevel, contentPath } = require('../public/js/content.js');

test('normalizeLevel defaults to a2', () => {
    assert.equal(normalizeLevel(null), 'a2');
    assert.equal(normalizeLevel(undefined), 'a2');
    assert.equal(normalizeLevel('junk'), 'a2');
});

test('normalizeLevel accepts a2 and b1', () => {
    assert.equal(normalizeLevel('a2'), 'a2');
    assert.equal(normalizeLevel('b1'), 'b1');
    assert.equal(normalizeLevel('B1'), 'b1');
});

test('contentPath builds level-keyed data path', () => {
    assert.equal(contentPath('a2', 'lezen'), '/data/a2/lezen.json');
    assert.equal(contentPath('b1', 'luisteren'), '/data/b1/luisteren.json');
});

test('contentPath rejects unknown modes', () => {
    assert.throws(() => contentPath('a2', 'knm'));   // knm is NOT level-keyed
    assert.throws(() => contentPath('a2', 'hacks'));
});
```

**Step 2:** Run `npm test` → the 4 new tests FAIL (module not found).

**Step 3: Implement** `public/js/content.js` (browser + node dual-use):

```js
// Level-keyed content loading. Level lives in localStorage['rmd-level'];
// everything defaults to A2 so pre-B1 users and cached pages are unaffected.
(function () {
    const LEVELS = ['a2', 'b1'];
    const LEVEL_MODES = ['lezen', 'schrijven', 'luisteren', 'spreken'];
    const STORAGE_KEY = 'rmd-level';

    function normalizeLevel(level) {
        const l = String(level || '').toLowerCase();
        return LEVELS.includes(l) ? l : 'a2';
    }

    function contentPath(level, mode) {
        if (!LEVEL_MODES.includes(mode)) throw new Error('not a level-keyed mode: ' + mode);
        return '/data/' + normalizeLevel(level) + '/' + mode + '.json';
    }

    function getLevel() {
        try { return normalizeLevel(localStorage.getItem(STORAGE_KEY)); }
        catch (e) { return 'a2'; }
    }

    function hasChosenLevel() {
        try { return LEVELS.includes(localStorage.getItem(STORAGE_KEY)); }
        catch (e) { return false; }
    }

    function setLevel(level) {
        try { localStorage.setItem(STORAGE_KEY, normalizeLevel(level)); } catch (e) {}
    }

    const cache = {};
    async function loadContent(mode) {
        const path = contentPath(getLevel(), mode);
        if (!cache[path]) cache[path] = (await fetch(path)).json();
        return cache[path];
    }

    const api = { normalizeLevel, contentPath, getLevel, setLevel, hasChosenLevel, loadContent, LEVEL_MODES };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.RMDContent = api;
})();
```

**Step 4:** `npm test` → 50/50 pass.
**Step 5:** Commit: `feat: level store + level-keyed content loader`

---

### Task 2: Extract A2 lezen + schrijven from index.html into JSON

**Files:**
- Create: `scripts/extract-a2-content.mjs`, `public/data/a2/lezen.json`, `public/data/a2/schrijven.json`
- Modify: `index.html` (delete the three consts + `lezenExams` literal AFTER verification)

**Step 1:** Write `scripts/extract-a2-content.mjs`: reads `index.html`, isolates the `schrijvenQuestions`, `lezenQuestions`, `lezenQuestions2` array literals and the `sectionNames` objects of `lezenExams` (bracket-matching parse, then `eval` in a sandboxed `node:vm` context — the literals are plain data). Emits:
  - `public/data/a2/schrijven.json`: `{ "questions": [ ...44 items... ] }`
  - `public/data/a2/lezen.json`: `{ "exams": { "exam1": { "name": "DUO Lezen Exam 1", "questions": [...25], "sectionNames": {...} }, "exam2": { ... } } }` (sections are DERIVED by filtering on `q.passage` at runtime — do not serialize the filtered duplicates).

**Step 2: Verify fidelity BEFORE touching index.html.** In the same script, re-derive `sections` from the JSON and `assert.deepStrictEqual` against the originals evaluated from index.html (questions arrays, sectionNames, and each derived section list). Script exits non-zero on any mismatch. Run it: `node scripts/extract-a2-content.mjs` → prints `FIDELITY OK 44 schrijven / 25+25 lezen`.

**Step 3:** Modify `index.html`: delete the three consts and replace the `lezenExams` literal with runtime construction from loaded JSON. Add near the top of the main script (before `startMode` is usable):

```js
let schrijvenQuestions = null, lezenExams = null;
async function ensureLevelContent(mode) {
    if (mode === 'schrijven') {
        const d = await window.RMDContent.loadContent('schrijven');
        schrijvenQuestions = d.questions;
    } else if (mode === 'lezen') {
        const d = await window.RMDContent.loadContent('lezen');
        lezenExams = {};
        for (const [id, exam] of Object.entries(d.exams)) {
            const sections = {};
            for (const key of Object.keys(exam.sectionNames)) {
                sections[key] = exam.questions.filter(q => q.passage === key);
            }
            lezenExams[id] = { name: exam.name, questions: exam.questions, sections, sectionNames: exam.sectionNames };
        }
    }
}
```

Make `startMode` async-safe for these two modes: `await ensureLevelContent(mode)` before rendering (find `function startMode` and prepend the call; it already handles async patterns for auth). Add `<script src="/js/content.js"></script>` before the main inline script.

**Step 4:** `npm test` → all pass. Manual check: `npm start`, open `http://localhost:3000` (or the port `server.js` prints), click Schrijven and Lezen — questions render identically. `curl -s localhost:PORT/data/a2/lezen.json | head -c 200` returns JSON.
**Step 5:** Commit: `refactor: extract A2 lezen/schrijven content to public/data/a2/`

---

### Task 3: Move A2 luisteren/spreken JSONs under a2/ and route through the loader

**Files:**
- Move: `public/data/luisteren-exercises.json` → `public/data/a2/luisteren.json`; `public/data/spreken-exercises.json` → `public/data/a2/spreken.json` (`git mv`)
- Modify: `public/js/luisteren.js:12`, `public/js/spreken.js:12`

**Step 1:** `git mv` the two files. Replace the two fetches with `const data = await window.RMDContent.loadContent('luisteren')` (resp. `'spreken'`). Add `<script src="/js/content.js"></script>` load-order check: content.js must load before luisteren.js/spreken.js in index.html.
**Step 2:** Search the whole repo for the old paths (`grep -rn "luisteren-exercises\|spreken-exercises" --include="*.js" --include="*.html" .` excluding node_modules) and fix any other reference. KNM path stays `/data/knm-exercises.json`.
**Step 3:** `npm test` → pass. Manual: Luisteren and Spreken modes still work locally (audio plays — audio paths inside the JSON are absolute `/audio/...` and unchanged).
**Step 4:** Commit: `refactor: A2 luisteren/spreken content moves under data/a2/`

---

### Task 4: Content schema validation test (all level-keyed files)

**Files:**
- Create: `test/content-schema.test.js`

**Step 1:** Write the test. No external schema lib — plain assertions (matches repo style). For each `level` of `['a2','b1']` and mode file that EXISTS (b1 files land in later tasks; the test globs `public/data/{level}/*.json` so it automatically covers them when added):
- lezen: `exams` object; every exam has `name`, `questions` array, `sectionNames`; every question has `passage`, `passageTitle`, `text`, `question` (or A2's field name — inspect `a2/lezen.json` and assert the actual field set), `options` array (len 3–4), integer `correctAnswer` within bounds, `explanation`; every `passage` value appears in `sectionNames`.
- schrijven: `questions` array; each has `prompt`, `modelAnswer`; B1 items additionally `wordGuidance`.
- luisteren: `exams`; each question has `questionText`, `audioFile`, `transcript`, `options`, in-bounds `correctAnswer`.
- spreken: `exams`; each part has `partNumber`, `exercises`; each exercise has `id`, `prompt`; B1 exercises additionally `taskType` in `['short','long']`.
- B1 volume assertions (only when file exists): lezen 2 exams × 30 q with exactly 6 distinct passages × 5; luisteren 3 × 10; spreken 3 exams with 8 short + 4 long; schrijven ≥ 20.
**Step 2:** `npm test` → passes against the a2 files (b1 asserts skipped while absent).
**Step 3:** Commit: `test: schema validation for level-keyed content files`

---

### Task 5: Level-aware grading prompts module + server wiring

**Files:**
- Create: `lib/grading-prompts.js`
- Test: `test/grading-prompts.test.js`
- Modify: `server.js` (~257 grade-writing, ~499 grade-speaking)

**Step 1: Failing test:**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const gp = require('../lib/grading-prompts.js');

test('level defaults to a2 and rejects junk', () => {
    assert.equal(gp.normalizeLevel(undefined), 'a2');
    assert.equal(gp.normalizeLevel('B1'), 'b1');
    assert.equal(gp.normalizeLevel('c2'), 'a2');
});
test('a2 prompts are the original prompts', () => {
    assert.match(gp.writingPrompt('a2'), /A2 writing test/);
    assert.match(gp.speakingPrompt('a2'), /A2 speaking test/);
});
test('b1 prompts follow Nt2 Programma I', () => {
    assert.match(gp.writingPrompt('b1'), /Nt2.*Programma I/i);
    assert.match(gp.writingPrompt('b1'), /B1/);
    assert.match(gp.speakingPrompt('b1'), /B1/);
});
```

**Step 2:** `npm test` → FAIL.
**Step 3:** Create `lib/grading-prompts.js`: **move** the A2 writing system prompt (server.js ~275) and A2 speaking prompt (~467–510) into it **byte-identical** (template literal contents unchanged). Add B1 prompts: writing graded on task fulfillment, organization/coherence (connectors, paragraph structure), vocabulary range, grammatical accuracy per B1 CEFR / Staatsexamen Nt2 Programma I descriptors ("can write connected text on familiar topics"); speaking same four dimensions at B1, aware of `taskType` (long tasks expect developed, structured answers with reasons; short tasks do not) — accept an options arg `speakingPrompt(level, { taskType })`. **The B1 prompts MUST demand the exact same JSON response shape the A2 prompts demand** (copy the response-format section verbatim into the B1 prompts). Export `normalizeLevel`, `writingPrompt`, `speakingPrompt`.
**Step 4:** Wire `server.js`: both endpoints read `const level = gp.normalizeLevel(req.body.level)`, use `gp.writingPrompt(level)` / `gp.speakingPrompt(level, { taskType: req.body.taskType })`, and include `level` in the JSON response (`res.json({ ...existing, level })`). NO other behavior changes; middleware untouched.
**Step 5:** `npm test` → all pass (existing grading-related tests must pass unmodified). Commit: `feat: level-aware grading prompts (A2 unchanged, B1 = Nt2 Programma I rubric)`

---

### Task 6: Frontend sends level + shows rubric badge

**Files:**
- Modify: `index.html` (~3298 grade-writing call, feedback rendering), `public/js/spreken.js` (~233)

**Step 1:** Both grading fetch bodies gain `level: window.RMDContent.getLevel()`; spreken also sends `taskType: currentExercise.taskType || 'short'`. **Do NOT touch `public/js/inline-practice.js`** (scorecard funnel — always A2, revenue path).
**Step 2:** Where grade feedback renders (both writing and speaking), add one line: `Graded against ${level === 'b1' ? 'B1 (Staatsexamen Nt2 Programma I)' : 'A2 (inburgeringsexamen)'} criteria` — English, small muted text, using the `level` echoed in the API response.
**Step 3:** `npm test` → pass. Manual: local writing grade round-trip works at both levels (set `localStorage.setItem('rmd-level','b1')` in devtools console).
**Step 4:** Commit: `feat: frontend passes level to grading, shows rubric badge`

---

### Task 7: Level chooser sheet + decision helper + header badge (English UI)

**Files:**
- Modify: `index.html` (markup + styles + logic)

**Step 1:** Add a bottom-sheet (reuse the existing signup-sheet CSS pattern — classes near the `signup` sheet markup) with id `level-sheet`:
- Title: "Which exam are you preparing for?"
- Button 1: **"A2 — Wet inburgering 2013"**, subtitle "My integration obligation started before 1 Jan 2022"
- Button 2: **"B1 — Wet inburgering 2021"**, subtitle "My obligation started on or after 1 Jan 2022"
- Link: **"I'm not sure — help me decide"** → swaps sheet body to the helper:
  - Question: "When did your inburgering obligation start?" Buttons: "Before 1 January 2022" (→ sets a2, confirmation line "You fall under Wi2013 — the A2 exams are yours."), "On or after 1 January 2022" (→ sets b1, "You fall under Wi2021 — the B1-route exams are standard."), "I don't know".
  - "I don't know" card: "Log in to **Mijn Inburgering** on inburgeren.nl with your DigiD — it shows your start date and exactly which exams you must take." (link `https://www.inburgeren.nl`, `target="_blank" rel="noopener"`). Footnotes (small text): "On the onderwijsroute you may need B2 — we don't cover B2 yet." / "If your gemeente approved switching down (afschalen), choose A2."
- Choosing calls `RMDContent.setLevel(x)`, closes the sheet, re-runs the pending `startMode`.
**Step 2:** Trigger logic in `startMode(mode)`: for the four language modes (NOT knm), if `!RMDContent.hasChosenLevel()`: **existing users** (any prior practice signal in localStorage — inspect what exists, e.g. `rmd-inline-state`, previous grades keys; if any found, `setLevel('a2')` silently and continue) — otherwise show `level-sheet` first.
**Step 3:** Header badge: small button in the app header showing `A2 ▾`/`B1 ▾`, `onclick` reopens `level-sheet` (with a "switching level reloads practice content" note). After a switch, clear `RMDContent` cache (add `clearCache()` to content.js) and re-enter the current mode if one is active.
**Step 4:** `npm test` → pass. Manual at 390px viewport: fresh profile shows sheet; each path sets level; badge switches.
**Step 5:** Commit: `feat: level chooser, decision helper, header badge (English UI)`

---

### Tasks 8–11: Author B1 content (one task per skill — independent, parallelizable)

**Files:** Create `public/data/b1/lezen.json` (Task 8), `b1/schrijven.json` (Task 9), `b1/spreken.json` (Task 10), `b1/luisteren.json` (Task 11).

Each task: author ORIGINAL Dutch content to the **B1 format specs** section above, matching the field names the schema test (Task 4) asserts (mirror the a2 file field names exactly — read the a2 counterpart first). Topics at B1: workplace (contracts, rosters, complaints), education (course enrollment, exams), official bodies (gemeente, belastingdienst letters), society/opinion (environment, neighbours, media). Language: B1 CEFR — subordinate clauses, connectors (omdat, daarom, hoewel, terwijl), 1500–2500 word receptive vocabulary; clearly harder than the a2 files but not B2/academic.

Per-task checklist (the authoring subagent runs it before finishing):
- [ ] Counts match the volume spec exactly (schema test enforces)
- [ ] Every MC question: exactly one defensible correct answer; distractors plausible
- [ ] Every item has explanation / modelAnswer / tipText parity with A2
- [ ] No text copied or closely paraphrased from official oefenexamens
- [ ] `node --test test/content-schema.test.js` passes
- [ ] Spot-check 3 random items read as natural Dutch at B1

Luisteren (Task 11) additionally: transcripts written to be TTS-friendly (no stage directions; speaker turns as "Man: … Vrouw: …" like the a2 file); `audioFile` paths `audio/b1-luisteren/exam{N}/q{n}.mp3` (files generated in Task 12).

Commit per task: `content: B1 {lezen|schrijven|spreken|luisteren} exams (original, Nt2-I format)`

---

### Task 12: TTS audio for B1 luisteren

**Files:**
- Modify: `scripts/generate-assets.js` (add `--level b1`: read `public/data/b1/luisteren.json`, write `public/audio/b1-luisteren/...`)
- Create: 30 mp3 files under `public/audio/b1-luisteren/exam{1..3}/`

**Steps:** Add the flag (default keeps current behavior). Check key: `grep OPENAI_API_KEY .env.production.local` — if absent, STOP and report (Youssef must supply it). Run `OPENAI_API_KEY=... node scripts/generate-assets.js --tts --level b1`. Verify: 30 files exist, each > 20KB; play one spot-check via `afplay` locally if running interactively, else check duration with `afinfo`. Commit (audio files are committed like the existing a2 mp3s): `assets: B1 luisteren TTS audio`

---

### Task 13: E2E regression sweep (standalone Playwright)

**Files:**
- Create: `scripts/e2e-b1.mjs`

**Step 1:** Standalone headless Playwright (chromium is already cached for `npx playwright`; per project memory, do NOT use the extension bridge). Script starts `node server.js` on a spare port, then runs BOTH viewports (390×844 and 1280×800), asserting (≥25 checks):
1. Fresh context + Schrijven → level sheet appears (English strings present).
2. Pick A2 → sheet closes, A2 question 1 text matches a known `a2/schrijven.json` prompt; `localStorage['rmd-level'] === 'a2'`.
3. Fresh context, pick B1 → B1 schrijven assignment renders with `wordGuidance`.
4. Helper path: "I'm not sure" → "Before 1 January 2022" → level a2. Fresh context → "On or after" → b1. "I don't know" → Mijn Inburgering card with inburgeren.nl link.
5. Existing-user path: seed `rmd-inline-state` in localStorage, open Lezen → NO sheet, level silently a2.
6. Badge shows current level; clicking reopens sheet; switching to B1 loads B1 lezen (6 passage titles present, 30 questions).
7. Every A2 mode end-to-end: lezen renders exam1 sections; luisteren exam1 q1 shows options + audio element `src=/audio/luisteren/...`; spreken exam1 part 1 renders; schrijven prompt 1 renders; KNM untouched (no level sheet, questions render).
8. Every B1 mode structure: lezen 2 exams × 30/6 passages; luisteren audio src `/audio/b1-luisteren/...`; spreken shows 8 short + 4 long with `taskType` driving responseTime display; schrijven 20 assignments listed.
9. Grading stubs: intercept `/api/grade-writing` (route fulfill with fixture JSON) and assert the request body contains `level: 'b1'` when level is b1, and the rubric badge line renders "B1 (Staatsexamen Nt2 Programma I)".
**Step 2:** Run: `node scripts/e2e-b1.mjs` → `ALL N CHECKS PASSED` on both viewports.
**Step 3:** Commit: `test: B1/A2 E2E regression sweep`

---

### Task 14: Full regression gate + finish

**Steps:**
1. `npm test` → 46 original + all new tests pass, zero modified original tests (verify: `git diff main -- test/checkout.test.js test/paywall.test.js test/session-auth.test.js test/smoke.test.js test/stripe-webhook.test.js` is EMPTY).
2. `node scripts/extract-a2-content.mjs --verify` fidelity still OK if the script supports re-verification against JSON (else skip — schema test covers ongoing integrity).
3. `node scripts/e2e-b1.mjs` full sweep green.
4. `grep -rn "luisteren-exercises\|spreken-exercises" --include="*.js" --include="*.html" . | grep -v node_modules` → empty.
5. `git log --oneline main..HEAD` — coherent commit series.
6. Report ready for review + merge decision (superpowers:finishing-a-development-branch). Production deploy + prod smoke happen after Youssef merges (Vercel deploys from main).

---

## Subagent execution notes

- Tasks 1→7 are sequential (each builds on the previous). Tasks 8–11 are independent of each other and of 6–7 (they only need Task 4's schema test to exist) — run in parallel after Task 5. Task 12 needs Task 11. Task 13 needs everything. Task 14 last.
- Every subagent works in `.worktrees/b1-mode`, commits its own task, runs `npm test` before finishing.
- Content-authoring subagents (8–11) must read the matching `public/data/a2/*.json` first for exact field names, and the design doc's format specs.
