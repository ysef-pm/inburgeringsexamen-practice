# B1 Mode — Design

**Date:** 2026-09-15
**Status:** Approved (brainstormed with Youssef, all sections validated)

## Purpose

Users preparing for the inburgeringsexamen fall under one of two laws. Those who
became inburgeringsplichtig **before 1 Jan 2022** (Wet inburgering 2013) need
**A2** language exams — everything the app offers today. Those inburgeringsplichtig
**on or after 1 Jan 2022** (Wet inburgering 2021) normally follow the **B1-route**
and sit the **Staatsexamen Nt2 Programma I** exams. The app currently serves only
A2; B1 users get the wrong level. This feature adds a B1 practice mode, a level
chooser at the start, and a decision helper for people who don't know which they need.

## Decisions (validated)

| Decision | Choice |
|---|---|
| Content sourcing | Original questions authored in official DUO/Nt2 style — never copied from official exams (copyright) |
| Scope | Practice app only; scorecard funnel untouched |
| Volume | Match A2 volume (see table below) |
| Pricing | Same €24 lifetime product; level is a practice setting, not an entitlement |
| Architecture | Unified level-keyed JSON; A2 lezen/schrijven extracted from index.html |
| UI language | Chooser/helper UI in English (content stays Dutch) |

## Official B1 exam formats (research, inburgeren.nl)

B1 under Wi2021 = Staatsexamen Nt2 Programma I — structurally different from A2:

| Skill | A2 (Wi2013) | B1 (Nt2 Programma I) |
|---|---|---|
| Lezen | 25 MC, 65 min | 35 MC over 6 texts, 110 min |
| Luisteren | 25 MC, 45 min | 30 MC in 6 parts, 90 min |
| Schrijven | 4 short tasks, 40 min | 3 longer assignments, 100 min |
| Spreken | 12 short tasks, 35 min | 12 tasks: 8 short + 4 long, ~30 min |

KNM is the same exam for both routes — stays shared and unchanged.

### Classification rule (for the decision helper)

The date the **inburgeringsplicht started** decides the law: before 1 Jan 2022 →
Wi2013/A2; on or after → Wi2021, normally B1-route. Exceptions: onderwijsroute
(B1 or B2), Z-route (no language exam at this level), and "afschalen" to A2 with
gemeente permission after ≥600 course hours. **Mijn Inburgering** (inburgeren.nl,
DigiD login) shows the start date and the exact exams required — that is the
authoritative fallback we point users to.

## Content model

```
public/data/
  a2/lezen.json  a2/schrijven.json  a2/luisteren.json  a2/spreken.json
  b1/lezen.json  b1/schrijven.json  b1/luisteren.json  b1/spreken.json
  knm-exercises.json          (unchanged, shared)
```

- A2 files are a **pure extraction**: `lezenQuestions`/`lezenQuestions2` and
  `schrijvenQuestions` move out of index.html byte-for-byte; existing
  luisteren/spreken JSONs move under `a2/`.
- A loader (`public/js/content.js`) resolves `data/{level}/{mode}.json` from the
  stored level, defaulting to `a2`.
- B1 schemas extend the A2 shapes: lezen uses `passage` groups (6 texts/exam),
  spreken parts carry `taskType: "short" | "long"` with longer `responseTime`,
  schrijven items get `wordGuidance` and B1 assignment framing.
- Audio under `public/audio/b1-luisteren/{exam}/q{n}.mp3`.

### B1 volume (v1)

| Skill | Volume |
|---|---|
| Lezen | 2 exams × 30 questions (6 texts × 5) |
| Luisteren | 3 exams × 10 questions |
| Spreken | 3 exams × 12 tasks (8 short + 4 long) |
| Schrijven | 20 full assignments |

## Level selection UX (English UI)

- **First mode-start with no stored level:** bottom-sheet chooser (same pattern
  as signup sheet): "A2 — Wet inburgering 2013 (obligation started before
  1 Jan 2022)", "B1 — Wet inburgering 2021 (on/after 1 Jan 2022)", "I'm not
  sure — help me decide".
- **Decision helper:** one question — when did your inburgering obligation
  start? Before / on-or-after 1 Jan 2022 / not sure. First two set the level
  with a one-line why. "Not sure" → card: log in to **Mijn Inburgering** with
  DigiD to see your start date and required exams. Footnotes: onderwijsroute
  may need B2 (not covered — say so honestly); afschalen permission → pick A2.
- **Persistence:** `localStorage['rmd-level']` = `'a2'` | `'b1'`. No Firestore
  sync in v1.
- **Header badge** (`A2 ▾` / `B1 ▾`) shows active level, reopens chooser.
- **Existing users** (practice history, no stored level): silently default to
  A2, no modal; badge makes switching discoverable.

## Grading

`POST /api/grade-writing` and `POST /api/grade-speaking` gain optional
`level` in the body: validated against `['a2','b1']`, **default `'a2'`**
(backward compatible). Prompt selected by level; A2 prompts stay byte-identical.
B1 prompts follow the Nt2 Programma I assessment model: task fulfillment,
organization/coherence (connectors, paragraphs), vocabulary range, grammatical
accuracy, calibrated to B1 CEFR descriptors; speaking prompts know short vs
long task types. Same JSON response shape as A2. Feedback header states which
rubric graded ("Graded against B1 (Nt2 Programma I) criteria").

**Unchanged:** paywall middleware (one free grade total, level-independent),
Stripe/webhook, scorecard endpoints.

## Content authoring pipeline

1. Pull official B1 oefenexamens (inburgeren.nl) as **format reference only**
   → `docs/reference/` (gitignored if bulky). Study format, topics, lengths,
   question styles — never the questions.
2. Author original items at B1: topics shift to work, education, society,
   opinion (workplace policy email, municipality announcement, complaint
   letter, plans with reasons). Every item carries explanations / model
   answers / tips, like A2.
3. Review pass per exam against a format checklist (question counts, text
   length ranges, single-correct-answer MC, B1 CEFR descriptors).
4. Content conforms to a JSON schema enforced by a CI test.
5. Audio: `scripts/generate-assets.js` gains `--level b1`; OpenAI tts-1;
   B1 clips are longer-form (45–90s). Spreken images only where needed.

## Regression testing (four layers)

1. **Extraction fidelity:** script diffs `a2/*.json` against the original
   inline consts/old files — field-for-field equality; kept as a CI fixture
   test after originals are deleted.
2. **Existing 46 tests pass unmodified.** A breaking test = refactor bug, not
   a test to update (except explicit content-location assertions, called out).
3. **New tests:** JSON schema validation over all 8 content files; loader
   level→path resolution with a2 default; grade endpoints accept b1 / reject
   junk / default a2; B1 prompt actually selected.
4. **Headless E2E sweep** (existing 390px pattern + desktop, local server,
   then prod smoke): chooser on first mode-start; A2/B1 pick persists and
   loads right content; helper paths land correctly; badge switches; no-level
   existing user defaults silently to A2; every A2 mode completes end-to-end;
   every B1 mode renders its structure (6-text lezen, 8+4 spreken).

## Out of scope (v1)

B2/onderwijsroute content, Z-route guidance, Firestore level sync, scorecard
level-awareness, TikTok/Meta ad changes, KNM changes.
