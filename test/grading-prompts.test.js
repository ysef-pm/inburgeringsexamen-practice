const { test } = require('node:test');
const assert = require('node:assert');
const gp = require('../lib/grading-prompts.js');

test('level defaults to a2 and rejects junk', () => {
    assert.equal(gp.normalizeLevel(undefined), 'a2');
    assert.equal(gp.normalizeLevel('B1'), 'b1');
    assert.equal(gp.normalizeLevel('c2'), 'a2');
});

test('normalizeLevel is case-insensitive and safe on non-strings', () => {
    assert.equal(gp.normalizeLevel('A2'), 'a2');
    assert.equal(gp.normalizeLevel('b1'), 'b1');
    assert.equal(gp.normalizeLevel(null), 'a2');
    assert.equal(gp.normalizeLevel(42), 'a2');
    assert.equal(gp.normalizeLevel({}), 'a2');
});

test('a2 prompts are the original prompts', () => {
    assert.match(gp.writingPrompt('a2'), /A2 writing test/);
    assert.match(gp.speakingPrompt('a2'), /A2 speaking test/);
});

test('a2 prompts carry the official DUO rubrics', () => {
    assert.match(gp.writingPrompt('a2'), /Official DUO Grading Rubric for Inburgeringsexamen Schrijven/);
    assert.match(gp.writingPrompt('a2'), /TOTAL MAXIMUM: 10 points \(3\+2\+2\+1\+2\)/);
    assert.match(gp.speakingPrompt('a2'), /Official Speaking Grading Rubric for Inburgeringsexamen Spreken \(A2\)/);
    assert.match(gp.speakingPrompt('a2'), /TOTAL MAXIMUM: 10 points \(2\+2\+2\+2\+2\)/);
});

test('a2 speaking prompt ignores taskType (byte-identical either way)', () => {
    assert.equal(gp.speakingPrompt('a2'), gp.speakingPrompt('a2', { taskType: 'long' }));
    assert.equal(gp.speakingPrompt('a2'), gp.speakingPrompt('a2', { taskType: 'short' }));
});

test('b1 prompts follow Nt2 Programma I', () => {
    assert.match(gp.writingPrompt('b1'), /Nt2.*Programma I/i);
    assert.match(gp.writingPrompt('b1'), /B1/);
    assert.match(gp.speakingPrompt('b1'), /B1/);
});

test('b1 writing prompt covers the four Nt2-I dimensions', () => {
    const p = gp.writingPrompt('b1');
    assert.match(p, /task fulfillment/i);
    assert.match(p, /coherence/i);
    assert.match(p, /connectors/i);
    assert.match(p, /vocabulary range/i);
    assert.match(p, /grammatical accuracy/i);
    assert.match(p, /connected text on familiar topics/i);
});

test('b1 prompts demand the exact same JSON response shape as a2', () => {
    // Writing: same five score keys, same top-level fields.
    for (const key of ['"execution"', '"grammar"', '"spelling"', '"clearness"', '"vocabulary"',
        '"total"', '"grammarErrors"', '"spellingErrors"', '"strengths"', '"improvements"', '"overallFeedback"']) {
        assert.ok(gp.writingPrompt('b1').includes(key), `b1 writing prompt missing ${key}`);
    }
    // Speaking: same five score keys.
    for (const key of ['"adequacy"', '"vocabulary"', '"grammar"', '"fluency"', '"pronunciation"',
        '"total"', '"grammarErrors"', '"strengths"', '"improvements"', '"overallFeedback"']) {
        assert.ok(gp.speakingPrompt('b1').includes(key), `b1 speaking prompt missing ${key}`);
    }
    // Verbatim: the a2 response-format block appears unchanged in the b1 prompts.
    const a2WritingFormat = gp.writingPrompt('a2').split('## Your Response Format')[1].split('CRITICAL')[0];
    assert.ok(gp.writingPrompt('b1').includes(a2WritingFormat), 'b1 writing response-format block differs from a2');
    const a2SpeakingFormat = gp.speakingPrompt('a2').split('You MUST respond with ONLY a valid JSON object')[1].split('IMPORTANT')[0];
    assert.ok(gp.speakingPrompt('b1').includes(a2SpeakingFormat), 'b1 speaking response-format block differs from a2');
});

test('b1 speaking prompt is taskType-aware', () => {
    const long = gp.speakingPrompt('b1', { taskType: 'long' });
    const short = gp.speakingPrompt('b1', { taskType: 'short' });
    const none = gp.speakingPrompt('b1');
    assert.match(long, /developed/i);
    assert.match(long, /structured/i);
    assert.match(long, /reasons/i);
    assert.equal(short, none);
    assert.ok(!short.includes('LONG TASK'), 'short task prompt must not carry the long-task expectation block');
});
