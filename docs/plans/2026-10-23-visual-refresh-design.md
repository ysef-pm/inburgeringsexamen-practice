# Visual Refresh — Design (2026-10-23)

## Why
The founder of Amsterdam language school Koentact called the app "a bit boring".
Goal: more visual interest plus tasteful polish, without breaking anything for
paying customers.

## Decisions (made by Youssef)
- **Style: warm illustration.** Flat/editorial, one consistent palette,
  Duolingo-lite but grown-up, never photoreal. Diverse people, Dutch settings,
  **no text or letters in images**.
- **Polish: "tasteful delight".** No gamification (no XP, streaks, mascot).
- **Scope: A2 + B1 + KNM, every section.** The 36 photoreal Spreken pictures
  (`public/images/spreken/*.jpg`) are regenerated in the house style too. Every
  Spreken picture must still show every detail its prompt/tip asks the learner
  to describe.
- **Ship straight to prod** once tests pass and screenshots are spot-checked.

## Work items
1. **Canal hero.** One wide illustrated Amsterdam canal scene (gables, bridge,
   bikes, water) behind the landing hero at ~12–18% opacity, gradient fade into
   the page background, slow Ken-Burns drift (off under
   `prefers-reduced-motion`). Text stays fully readable on desktop and mobile.
2. **Scene image per scenario** via `scripts/generate-scene-images.js`
   (OpenAI `gpt-image-1`, budget ceiling ~$15, running cost logged).
   One image per *scenario*: lezen passage (questions sharing a text share an
   image), KNM question, luisteren item, schrijven prompt, spreken exercise
   (picture parts keep their own pictures, regenerated).
   Prompt = fixed style prefix + scene description written by `gpt-4o-mini`
   from the **stem/situation only — never the options or correct answer**.
   Rule: *show the situation, never the answer* (e.g. "tell your boss you're
   sick" → person in bed with a tissue, phone in hand). MCQ scenes are
   double-checked for answer leakage.
   Output: ~1024px WebP (~60–120 KB) under
   `public/images/scenes/{level}/{section}/{id}.webp`; an `image` field is
   written back into the JSON. Idempotent (skips existing), `--force <id>`,
   `--only <section>`, concurrency ~4 with retries.
3. **Contact sheet** `docs/plans/scene-contact-sheet.html` — every image with
   its exercise id + stem, for review. Images with garbled text, broken
   anatomy, wrong scene or answer leakage are regenerated.
4. **Rendering.** One shared helper `renderSceneImage()` in
   `public/js/shared.js` (also exposed on `window` for the legacy inline
   schrijven/lezen JS): rounded illustration card above the prompt, lazy
   loaded, soft fade-in, fixed aspect ratio (no layout shift), meaningful alt,
   hides itself when the image is missing. Sized so the question stays above
   the fold on mobile.
5. **Polish layer** (plain CSS/JS, all honouring `prefers-reduced-motion`):
   staggered entrance on cards/mode tiles, hover lift on tiles, animated
   progress bar, score count-up on results, light hand-rolled confetti on a
   passing result, gentle shake on wrong / green pulse on right MCQ answers,
   smooth transitions between questions. No new runtime dependencies.
6. **Verify.** `npm test` (71 unit) + `node scripts/e2e-b1.mjs` (44 E2E) stay
   green; new check that every exercise in every JSON has an existing image
   file. Before/after screenshots (1440 + 390) of landing, one exercise per
   section and a results screen in `docs/plans/screenshots/`. Page weight
   checked (lazy loading).
7. Merge to main, push, confirm ratemydutch.com serves the new version.

## Constraints
- Never delete files: superseded images stay on disk, they are simply no
  longer referenced.
- No answer leakage, no text in images.
