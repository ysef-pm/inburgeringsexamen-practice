// Every exercise in every content JSON must have an illustration whose file
// exists (visual refresh, docs/plans/2026-10-23-visual-refresh-design.md).
// Spreken picture exercises are covered by their `images` instead.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'public', 'data');
const IMAGES = path.join(ROOT, 'public', 'images');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));
const pad = (n) => String(n).padStart(2, '0');
// Images a reviewer rejected (text, answer leakage, wrong scene) or that could
// not be generated yet live in scripts/scene-manifest.json `rejected` with a
// reason; those exercises render without a card until regenerated.
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'scene-manifest.json'), 'utf8'));
const PENDING = MANIFEST.rejected || {};
const MAX_PENDING = 16; // ratchet: lower this as pending images get regenerated

function exercises() {
    const out = [];
    for (const lv of ['a2', 'b1']) {
        for (const [ek, e] of Object.entries(read(`${lv}/lezen.json`).exams))
            e.questions.forEach((q, i) => out.push({ where: `${lv}/lezen ${ek}#${i}`, unit: `${lv}/lezen/${ek}-${q.passage}`, q }));
        for (const [ek, e] of Object.entries(read(`${lv}/luisteren.json`).exams))
            e.questions.forEach((q) => out.push({ where: `${lv}/luisteren ${ek} ${q.id}`, unit: `${lv}/luisteren/${q.id}`, q }));
        read(`${lv}/schrijven.json`).questions.forEach((q, i) => out.push({ where: `${lv}/schrijven #${i}`, unit: `${lv}/schrijven/q${pad(i + 1)}`, q }));
        for (const [ek, e] of Object.entries(read(`${lv}/spreken.json`).exams))
            for (const p of e.parts) for (const q of p.exercises) out.push({ where: `${lv}/spreken ${ek} ${q.id}`, unit: `${lv}/spreken/${q.id}`, q, spreken: true });
    }
    for (const [ek, e] of Object.entries(read('knm-exercises.json').exams))
        e.questions.forEach((q) => out.push({ where: `knm ${ek} ${q.id}`, unit: `knm/${q.id}`, q }));
    return out;
}

const exists = (rel) => fs.existsSync(path.join(IMAGES, rel));

test('every exercise has an existing illustration (scene image or spreken pictures)', () => {
    const problems = [];
    for (const { where, unit, q, spreken } of exercises()) {
        if (spreken && q.images && q.images.length) {
            q.images.forEach((img) => { if (!exists(img)) problems.push(`${where}: missing picture ${img}`); });
            continue;
        }
        if (PENDING[unit]) {
            if (q.image) problems.push(`${where}: rejected image ${unit} is still referenced`);
            continue;
        }
        if (typeof q.image !== 'string' || !q.image) { problems.push(`${where}: no image field`); continue; }
        if (!exists(q.image)) problems.push(`${where}: missing file ${q.image}`);
    }
    assert.deepStrictEqual(problems, []);
});

test('pending (rejected / not yet generated) images are few and documented', () => {
    const ids = Object.keys(PENDING);
    assert.ok(ids.length <= MAX_PENDING, `${ids.length} pending images > ${MAX_PENDING}`);
    for (const id of ids) assert.ok(String(PENDING[id]).trim().length > 5, `reason for ${id}`);
});

test('scene images are illustrated WebP files with alt text', () => {
    const problems = [];
    for (const { where, unit, q, spreken } of exercises()) {
        if (spreken && q.images && q.images.length) {
            if (!Array.isArray(q.imageAlts) || q.imageAlts.length !== q.images.length || q.imageAlts.some((a) => !a))
                problems.push(`${where}: imageAlts must parallel images`);
            q.images.forEach((img) => { if (!/^scenes\/.+\.webp$/.test(img)) problems.push(`${where}: picture not regenerated: ${img}`); });
            continue;
        }
        if (PENDING[unit]) continue;
        if (q.image && !/^scenes\/.+\.webp$/.test(q.image)) problems.push(`${where}: not a scene webp: ${q.image}`);
        if (!q.imageAlt || !String(q.imageAlt).trim()) problems.push(`${where}: empty imageAlt`);
    }
    assert.deepStrictEqual(problems, []);
});

test('scene image files stay small (<= 200 KB each)', () => {
    const big = [];
    (function walk(dir) {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, f.name);
            if (f.isDirectory()) walk(p);
            else if (f.name.endsWith('.webp') && fs.statSync(p).size > 200 * 1024) big.push(path.relative(IMAGES, p));
        }
    })(path.join(IMAGES, 'scenes'));
    assert.deepStrictEqual(big, []);
});
