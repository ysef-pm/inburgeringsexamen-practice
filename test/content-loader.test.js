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

// loadContent behavior: fresh module instance per test so the module-level
// cache doesn't leak between tests.
function freshContent() {
    const modPath = require.resolve('../public/js/content.js');
    delete require.cache[modPath];
    return require(modPath);
}

test('loadContent rejects with path + status on HTTP failure and does not cache the failure', async () => {
    const content = freshContent();
    let calls = 0;
    global.fetch = async () => {
        calls++;
        if (calls === 1) return { ok: false, status: 404, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ questions: ['fine'] }) };
    };
    try {
        await assert.rejects(
            () => content.loadContent('schrijven'),
            /content load failed: \/data\/a2\/schrijven\.json \(404\)/
        );
        // The failed load must NOT be cached: the retry hits fetch again and succeeds.
        const data = await content.loadContent('schrijven');
        assert.deepEqual(data, { questions: ['fine'] });
        assert.equal(calls, 2);
    } finally {
        delete global.fetch;
    }
});

test('loadContent caches successful loads (one fetch for repeat calls)', async () => {
    const content = freshContent();
    let calls = 0;
    global.fetch = async () => {
        calls++;
        return { ok: true, status: 200, json: async () => ({ exams: {} }) };
    };
    try {
        const a = await content.loadContent('lezen');
        const b = await content.loadContent('lezen');
        assert.deepEqual(a, { exams: {} });
        assert.equal(a, b);
        assert.equal(calls, 1);
    } finally {
        delete global.fetch;
    }
});

test('loadContent network error (fetch rejects) is not cached either', async () => {
    const content = freshContent();
    let calls = 0;
    global.fetch = async () => {
        calls++;
        if (calls === 1) throw new Error('network down');
        return { ok: true, status: 200, json: async () => ({ exams: {} }) };
    };
    try {
        await assert.rejects(() => content.loadContent('luisteren'), /network down/);
        const data = await content.loadContent('luisteren');
        assert.deepEqual(data, { exams: {} });
        assert.equal(calls, 2);
    } finally {
        delete global.fetch;
    }
});
