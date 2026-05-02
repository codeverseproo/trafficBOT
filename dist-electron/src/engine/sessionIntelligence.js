"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calcEngagementScore = calcEngagementScore;
exports.seedBrowserHistory = seedBrowserHistory;
exports.seedLocalStorage = seedLocalStorage;
exports.bypassServiceWorker = bypassServiceWorker;
exports.seedIndexedDB = seedIndexedDB;
exports.injectDarkModeConsistency = injectDarkModeConsistency;
exports.ensureMinimumDuration = ensureMinimumDuration;
exports.getScrollDepth = getScrollDepth;
// ─── Engagement Score ──────────────────────────────────────────────────────────
function calcEngagementScore(stats) {
    let score = 0;
    // Time on page (max 30 pts — ideal: 60-300s)
    const secs = (stats.totalTimeMs || 0) / 1000;
    score += Math.min(30, secs / 10);
    // Scroll depth (max 25 pts)
    score += Math.min(25, (stats.scrollDepthPct || 0) * 0.25);
    // Ads found (max 20 pts)
    score += Math.min(20, (stats.adsFound || 0) * 5);
    // Pages visited (max 15 pts)
    score += Math.min(15, (stats.pagesVisited || 0) * 5);
    // Mouse activity (max 10 pts)
    score += Math.min(10, (stats.mouseEvents || 0) * 0.1);
    return Math.round(Math.min(100, score));
}
// ─── Browser History Seeding ──────────────────────────────────────────────────
async function seedBrowserHistory(page, targetUrl) {
    try {
        const host = new URL(targetUrl).hostname;
        const fakePages = [
            `https://www.google.com/search?q=${encodeURIComponent(host)}`,
            `https://${host}/`,
            `https://${host}/about`,
            `https://${host}/blog`,
            targetUrl,
        ];
        await page.evaluate((pages) => {
            for (let i = 0; i < pages.length - 1; i++) {
                history.pushState({}, '', pages[i]);
            }
        }, fakePages);
    }
    catch { }
}
// ─── localStorage Pre-Seeding ─────────────────────────────────────────────────
async function seedLocalStorage(page) {
    await page.evaluate(() => {
        const seeds = {
            'theme': Math.random() > 0.5 ? 'dark' : 'light',
            'fontSize': ['small', 'medium', 'large'][Math.floor(Math.random() * 3)],
            'lastVisit': new Date(Date.now() - Math.random() * 7 * 86400000).toISOString(),
            'readingProgress': JSON.stringify({ articles: Math.floor(Math.random() * 20) }),
            'newsletter': Math.random() > 0.7 ? 'subscribed' : 'dismissed',
        };
        for (const [k, v] of Object.entries(seeds)) {
            try {
                localStorage.setItem(k, v);
            }
            catch { }
        }
    });
}
// ─── Service Worker Bypass ────────────────────────────────────────────────────
async function bypassServiceWorker(page) {
    await page.addInitScript(() => {
        // Override SW registration so it can't intercept ad requests
        const origRegister = navigator.serviceWorker?.register?.bind(navigator.serviceWorker);
        if (origRegister) {
            navigator.serviceWorker.register = async (url, opts) => {
                console.debug('[SessionIntelligence] SW registration intercepted:', url);
                return origRegister(url, opts);
            };
        }
    });
}
// ─── IndexedDB Seeding ────────────────────────────────────────────────────────
async function seedIndexedDB(page) {
    await page.evaluate(() => {
        try {
            const req = indexedDB.open('userPrefs', 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('prefs')) {
                    db.createObjectStore('prefs');
                }
            };
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction('prefs', 'readwrite');
                const store = tx.objectStore('prefs');
                store.put('dark', 'theme');
                store.put(Math.floor(Math.random() * 50), 'articleCount');
                store.put(Date.now() - Math.random() * 86400000 * 14, 'firstVisit');
            };
        }
        catch { }
    });
}
// ─── Dark Mode Consistency ────────────────────────────────────────────────────
async function injectDarkModeConsistency(page, isDark) {
    await page.addInitScript((dark) => {
        const orig = window.matchMedia.bind(window);
        window.matchMedia = (query) => {
            const mq = orig(query);
            if (query.includes('prefers-color-scheme')) {
                return Object.defineProperties(mq, {
                    matches: { get: () => dark },
                    media: { get: () => query },
                });
            }
            return mq;
        };
    }, isDark);
}
// ─── Session Duration Normalizer ──────────────────────────────────────────────
async function ensureMinimumDuration(startTime, minSeconds) {
    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed < minSeconds) {
        const remaining = (minSeconds - elapsed) * 1000;
        console.log(`[SessionIntelligence] Padding session by ${Math.round(remaining / 1000)}s`);
        await new Promise(r => setTimeout(r, remaining));
    }
}
// ─── Scroll Depth Tracker ─────────────────────────────────────────────────────
async function getScrollDepth(page) {
    return page.evaluate(() => {
        const total = document.body.scrollHeight - window.innerHeight;
        if (total <= 0)
            return 100;
        return Math.round((window.scrollY / total) * 100);
    }).catch(() => 0);
}
