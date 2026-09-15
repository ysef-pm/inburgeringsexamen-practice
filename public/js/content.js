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
