"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClickRateLimiter = exports.ScrollFatigueModel = exports.BEHAVIOR_PROFILES = void 0;
exports.randomProfile = randomProfile;
exports.getQuantumSeed = getQuantumSeed;
exports.simulateTabIdle = simulateTabIdle;
exports.simulateCopyText = simulateCopyText;
exports.simulateBookmark = simulateBookmark;
exports.injectUTM = injectUTM;
exports.randomReferrer = randomReferrer;
exports.BEHAVIOR_PROFILES = [
    {
        type: 'speed-reader', name: 'Speed Reader',
        wpm: 450, dwellMin: 400, dwellMax: 1200,
        reverseScrollChance: 0.08, earlyStopChance: 0.15,
        tabSwitchChance: 0.05, copyTextChance: 0.02, bookmarkChance: 0.01,
        imagePauseMultiplier: 0.4, jitterProfile: 'gaming-mouse',
    },
    {
        type: 'casual', name: 'Casual Browser',
        wpm: 238, dwellMin: 1500, dwellMax: 4000,
        reverseScrollChance: 0.2, earlyStopChance: 0.05,
        tabSwitchChance: 0.15, copyTextChance: 0.08, bookmarkChance: 0.03,
        imagePauseMultiplier: 1.0, jitterProfile: 'slight-tremor',
    },
    {
        type: 'deep-reader', name: 'Deep Reader',
        wpm: 150, dwellMin: 3000, dwellMax: 8000,
        reverseScrollChance: 0.4, earlyStopChance: 0.02,
        tabSwitchChance: 0.08, copyTextChance: 0.2, bookmarkChance: 0.1,
        imagePauseMultiplier: 2.5, jitterProfile: 'steady',
    },
    {
        type: 'skimmer', name: 'Skimmer',
        wpm: 600, dwellMin: 200, dwellMax: 700,
        reverseScrollChance: 0.05, earlyStopChance: 0.35,
        tabSwitchChance: 0.2, copyTextChance: 0.01, bookmarkChance: 0.005,
        imagePauseMultiplier: 0.3, jitterProfile: 'gaming-mouse',
    },
];
function randomProfile() {
    const r = Math.random();
    if (r < 0.10)
        return exports.BEHAVIOR_PROFILES[0]; // 10% speed
    if (r < 0.50)
        return exports.BEHAVIOR_PROFILES[1]; // 40% casual
    if (r < 0.75)
        return exports.BEHAVIOR_PROFILES[2]; // 25% deep
    return exports.BEHAVIOR_PROFILES[3]; // 25% skimmer
}
// ─── Quantum Random Seed ──────────────────────────────────────────────────────
let _seed = null;
async function getQuantumSeed() {
    if (_seed !== null)
        return _seed;
    try {
        const r = await fetch('https://www.random.org/integers/?num=1&min=1&max=1000000000&col=1&base=10&format=plain&rnd=new', { signal: AbortSignal.timeout(3000) });
        _seed = parseInt((await r.text()).trim(), 10);
        console.log(`[BehaviorProfile] Quantum seed: ${_seed}`);
    }
    catch {
        _seed = Math.floor(Math.random() * 1_000_000_000);
    }
    return _seed;
}
// ─── Scroll Fatigue Model ─────────────────────────────────────────────────────
class ScrollFatigueModel {
    startTime = Date.now();
    dwellMultiplier() {
        const s = (Date.now() - this.startTime) / 1000;
        if (s > 240)
            return 2.5;
        if (s > 120)
            return 1.7;
        if (s > 60)
            return 1.2;
        return 1.0;
    }
    speedMultiplier() {
        const s = (Date.now() - this.startTime) / 1000;
        if (s > 240)
            return 0.5;
        if (s > 120)
            return 0.7;
        return 1.0;
    }
}
exports.ScrollFatigueModel = ScrollFatigueModel;
// ─── Tab Idle Simulation ──────────────────────────────────────────────────────
async function simulateTabIdle(page, profile) {
    if (Math.random() > profile.tabSwitchChance)
        return;
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    const ms = Math.floor(Math.random() * 15000) + 3000;
    console.log(`[BehaviorProfile] Tab idle ${Math.round(ms / 1000)}s`);
    await new Promise(r => setTimeout(r, ms));
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
}
// ─── Copy-Text Simulation ─────────────────────────────────────────────────────
async function simulateCopyText(page, profile) {
    if (Math.random() > profile.copyTextChance)
        return;
    try {
        const paras = await page.evaluate(() => Array.from(document.querySelectorAll('p'))
            .filter(p => p.innerText.trim().length > 50)
            .map(p => p.getBoundingClientRect().top + window.scrollY)
            .slice(0, 10));
        if (!paras.length)
            return;
        const y = paras[Math.floor(Math.random() * paras.length)];
        await page.evaluate(y => window.scrollTo({ top: y - 200, behavior: 'smooth' }), y);
        await new Promise(r => setTimeout(r, 800));
        const vp = page.viewportSize() ?? { width: 1366, height: 768 };
        await page.mouse.click(vp.width / 2, vp.height / 2, { clickCount: 3 });
        await new Promise(r => setTimeout(r, 600));
        await page.keyboard.press('Control+c');
        await new Promise(r => setTimeout(r, 200));
        await page.keyboard.press('Escape');
        console.log('[BehaviorProfile] Simulated text copy');
    }
    catch { }
}
// ─── Bookmark Gesture ─────────────────────────────────────────────────────────
async function simulateBookmark(page, profile) {
    if (Math.random() > profile.bookmarkChance)
        return;
    try {
        await page.keyboard.press('Control+d');
        await new Promise(r => setTimeout(r, 1500));
        await page.keyboard.press('Escape');
        console.log('[BehaviorProfile] Simulated bookmark');
    }
    catch { }
}
// ─── Click Rate Limiter ───────────────────────────────────────────────────────
class ClickRateLimiter {
    last = 0;
    min = 800;
    async throttle() {
        const wait = this.min - (Date.now() - this.last);
        if (wait > 0)
            await new Promise(r => setTimeout(r, wait));
        this.last = Date.now();
    }
}
exports.ClickRateLimiter = ClickRateLimiter;
// ─── UTM Parameter Injection ──────────────────────────────────────────────────
function injectUTM(url) {
    if (Math.random() > 0.35)
        return url;
    const sources = [
        { s: 'google', m: 'organic', c: '' },
        { s: 'newsletter', m: 'email', c: 'weekly-digest' },
        { s: 'twitter', m: 'social', c: '' },
        { s: 'facebook', m: 'social', c: 'post' },
        { s: 'bing', m: 'organic', c: '' },
    ];
    const { s, m, c } = sources[Math.floor(Math.random() * sources.length)];
    try {
        const u = new URL(url);
        u.searchParams.set('utm_source', s);
        if (m)
            u.searchParams.set('utm_medium', m);
        if (c)
            u.searchParams.set('utm_campaign', c);
        return u.toString();
    }
    catch {
        return url;
    }
}
// ─── Referrer Diversity ───────────────────────────────────────────────────────
function randomReferrer(targetUrl) {
    const host = (() => { try {
        return new URL(targetUrl).hostname;
    }
    catch {
        return '';
    } })();
    const list = [
        `https://www.google.com/search?q=${encodeURIComponent(host)}`,
        `https://www.bing.com/search?q=${encodeURIComponent(host)}`,
        'https://www.facebook.com/',
        'https://t.co/',
        'https://www.reddit.com/',
        undefined, undefined, undefined, // direct weighted 3x
    ];
    return list[Math.floor(Math.random() * list.length)];
}
