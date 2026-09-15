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
