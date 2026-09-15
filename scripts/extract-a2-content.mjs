#!/usr/bin/env node
// Extract the A2 schrijven + lezen content embedded in index.html into
// public/data/a2/{schrijven,lezen}.json — with a fidelity check that runs
// BEFORE anything is written, so the JSON provably equals the inline data.
//
// The inline literals are plain data (the only functions live in the
// derived `sections` of lezenExams, which we re-derive at runtime instead
// of serializing). We isolate each literal by bracket matching (string- and
// comment-aware) and evaluate it in a sandboxed node:vm context.
//
// Usage: node scripts/extract-a2-content.mjs [--verify]
//   --verify: don't (re)write the JSON files, just check the ones on disk
//             against index.html (only works while the literals still exist).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const verifyOnly = process.argv.includes('--verify');

// ---------------------------------------------------------------------------
// Bracket-matching extraction (aware of strings, template literals, comments)
// ---------------------------------------------------------------------------
function extractLiteral(source, marker) {
    const start = source.indexOf(marker);
    if (start === -1) throw new Error(`marker not found: ${marker}`);
    let i = start + marker.length;
    while (i < source.length && source[i] !== '[' && source[i] !== '{') i++;
    if (i === source.length) throw new Error(`no opening bracket after: ${marker}`);
    const open = source[i];
    const close = open === '[' ? ']' : '}';
    const from = i;
    let depth = 0;
    let mode = null; // null | "'" | '"' | '`' | '//' | '/*'
    for (; i < source.length; i++) {
        const c = source[i];
        if (mode === "'" || mode === '"' || mode === '`') {
            if (c === '\\') { i++; continue; }
            if (c === mode) mode = null;
            continue;
        }
        if (mode === '//') { if (c === '\n') mode = null; continue; }
        if (mode === '/*') { if (c === '*' && source[i + 1] === '/') { mode = null; i++; } continue; }
        if (c === "'" || c === '"' || c === '`') { mode = c; continue; }
        if (c === '/' && source[i + 1] === '/') { mode = '//'; i++; continue; }
        if (c === '/' && source[i + 1] === '*') { mode = '/*'; i++; continue; }
        if (c === '[' || c === '{') depth++;
        else if (c === ']' || c === '}') {
            depth--;
            if (depth === 0) {
                if (c !== close) throw new Error(`bracket mismatch for ${marker}`);
                return source.slice(from, i + 1);
            }
        }
    }
    throw new Error(`unterminated literal for: ${marker}`);
}

const schrijvenSrc = extractLiteral(html, 'const schrijvenQuestions =');
const lezen1Src = extractLiteral(html, 'const lezenQuestions =');
const lezen2Src = extractLiteral(html, 'const lezenQuestions2 =');
const lezenExamsSrc = extractLiteral(html, 'const lezenExams =');

// ---------------------------------------------------------------------------
// Evaluate the literals via node:vm (own scope, nothing else in it; same
// realm so assert.deepStrictEqual prototype checks work). lezenExams needs
// the two arrays in scope for its derived `sections` filters — plain data
// otherwise.
// ---------------------------------------------------------------------------
const evaluated = runInThisContext(
    `(() => {
        const schrijvenQuestions = ${schrijvenSrc};
        const lezenQuestions = ${lezen1Src};
        const lezenQuestions2 = ${lezen2Src};
        const lezenExams = ${lezenExamsSrc};
        return { schrijvenQuestions, lezenQuestions, lezenQuestions2, lezenExams };
    })()`,
    { filename: 'extracted-a2-content.js' }
);

const { schrijvenQuestions, lezenQuestions, lezenQuestions2, lezenExams } = evaluated;

// ---------------------------------------------------------------------------
// Build the JSON payloads (sections are DERIVED at runtime — not serialized)
// ---------------------------------------------------------------------------
const schrijvenJson = { questions: schrijvenQuestions };
const lezenJson = {
    exams: Object.fromEntries(
        Object.entries(lezenExams).map(([id, exam]) => [
            id,
            { name: exam.name, questions: exam.questions, sectionNames: exam.sectionNames }
        ])
    )
};

// ---------------------------------------------------------------------------
// Fidelity verification — BEFORE any file is written
// ---------------------------------------------------------------------------
function roundTrip(value) {
    return JSON.parse(JSON.stringify(value));
}

const schrijvenRT = roundTrip(schrijvenJson);
const lezenRT = roundTrip(lezenJson);

// 1. JSON round-trip loses nothing from the original literals.
assert.deepStrictEqual(schrijvenRT.questions, schrijvenQuestions, 'schrijven questions round-trip mismatch');
assert.deepStrictEqual(lezenRT.exams.exam1.questions, lezenQuestions, 'exam1 questions round-trip mismatch');
assert.deepStrictEqual(lezenRT.exams.exam2.questions, lezenQuestions2, 'exam2 questions round-trip mismatch');
for (const id of Object.keys(lezenExams)) {
    assert.deepStrictEqual(lezenRT.exams[id].name, lezenExams[id].name, `${id} name mismatch`);
    assert.deepStrictEqual(lezenRT.exams[id].sectionNames, lezenExams[id].sectionNames, `${id} sectionNames mismatch`);
    assert.deepStrictEqual(lezenRT.exams[id].questions, lezenExams[id].questions, `${id} questions mismatch`);
}

// 2. Sections re-derived from the JSON equal the original derived sections.
for (const id of Object.keys(lezenExams)) {
    const derived = {};
    for (const key of Object.keys(lezenRT.exams[id].sectionNames)) {
        derived[key] = lezenRT.exams[id].questions.filter(q => q.passage === key);
    }
    assert.deepStrictEqual(derived, roundTrip(lezenExams[id].sections), `${id} derived sections mismatch`);
    // Same section keys, same order, none empty, and the union covers every question.
    assert.deepStrictEqual(Object.keys(derived), Object.keys(lezenExams[id].sections), `${id} section key order mismatch`);
    const union = Object.values(derived).flat();
    assert.strictEqual(union.length, lezenRT.exams[id].questions.length, `${id} sections do not cover all questions`);
}

// 3. Volumes.
assert.strictEqual(schrijvenQuestions.length, 44, `expected 44 schrijven, got ${schrijvenQuestions.length}`);
assert.strictEqual(lezenQuestions.length, 25, `expected 25 exam1 questions, got ${lezenQuestions.length}`);
assert.strictEqual(lezenQuestions2.length, 25, `expected 25 exam2 questions, got ${lezenQuestions2.length}`);
assert.deepStrictEqual(Object.keys(lezenExams), ['exam1', 'exam2'], 'expected exactly exam1+exam2');

// ---------------------------------------------------------------------------
// Emit (or verify against files already on disk)
// ---------------------------------------------------------------------------
const outDir = join(root, 'public', 'data', 'a2');
const schrijvenPath = join(outDir, 'schrijven.json');
const lezenPath = join(outDir, 'lezen.json');

if (verifyOnly) {
    for (const [path, expected] of [[schrijvenPath, schrijvenJson], [lezenPath, lezenJson]]) {
        if (!existsSync(path)) throw new Error(`--verify: missing ${path}`);
        assert.deepStrictEqual(JSON.parse(readFileSync(path, 'utf8')), roundTrip(expected), `on-disk mismatch: ${path}`);
    }
    console.log(`FIDELITY OK 44 schrijven / 25+25 lezen (verified existing ${schrijvenPath} and ${lezenPath})`);
} else {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(schrijvenPath, JSON.stringify(schrijvenJson, null, 2) + '\n');
    writeFileSync(lezenPath, JSON.stringify(lezenJson, null, 2) + '\n');
    console.log(`FIDELITY OK 44 schrijven / 25+25 lezen`);
    console.log(`wrote ${schrijvenPath}`);
    console.log(`wrote ${lezenPath}`);
}
