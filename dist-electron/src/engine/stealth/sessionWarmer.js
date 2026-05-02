"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionWarmer = void 0;
const scrollingEngine_1 = require("./scrollingEngine");
const WARM_SITES = [
    'https://www.wikipedia.org',
    'https://www.youtube.com',
    'https://weather.com',
    'https://www.reddit.com',
    'https://www.bbc.com',
];
const SEARCH_QUERIES = [
    'latest news today',
    'best products 2026',
    'how to improve productivity',
    'weather forecast',
    'trending topics',
];
class SessionWarmer {
    /**
     * Visit 1-2 benign sites to build up a cookie/session history before hitting the target.
     * This makes the browser context look organic and not cold-started.
     */
    static async warmSession(context, mousePos) {
        const count = Math.floor(Math.random() * 2) + 1; // visit 1 or 2 sites
        const selected = [...WARM_SITES].sort(() => Math.random() - 0.5).slice(0, count);
        for (const site of selected) {
            const page = await context.newPage();
            try {
                console.log(`[SessionWarmer] Warming on ${site}...`);
                await page.goto(site, { waitUntil: 'load', timeout: 20000 });
                await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { });
                await new Promise(r => setTimeout(r, Math.random() * 1500 + 500));
                await scrollingEngine_1.ScrollingEngine.humanScroll(page, 300 + Math.random() * 200);
                await new Promise(r => setTimeout(r, Math.random() * 1000 + 500));
            }
            catch {
                // Silently skip if warming site fails (proxy restriction, etc.)
            }
            finally {
                await page.close();
            }
        }
        return mousePos;
    }
    /**
     * Simulate arriving via Google search: visit google.com -> search -> click result.
     * Produces a valid HTTP Referer header so the target sees organic traffic.
     */
    static async warmViaSearch(context, _targetUrl) {
        const page = await context.newPage();
        try {
            const query = SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
            console.log(`[SessionWarmer] Navigating via Google search: "${query}"`);
            // 1. Go to Google
            await page.goto('https://www.google.com', { waitUntil: 'load', timeout: 20000 });
            await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { });
            await new Promise(r => setTimeout(r, Math.random() * 1000 + 500));
            // 2. Type into the search box like a human
            const searchBox = 'textarea[name="q"], input[name="q"]';
            const boxExists = await page.$(searchBox);
            if (boxExists) {
                await boxExists.click();
                // Type the query character-by-character with variable delay
                for (const ch of query) {
                    await page.keyboard.type(ch, { delay: Math.floor(Math.random() * 80) + 40 });
                }
                await new Promise(r => setTimeout(r, Math.random() * 500 + 200));
                await page.keyboard.press('Enter');
                await page.waitForLoadState('load');
                await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { });
                await new Promise(r => setTimeout(r, Math.random() * 1500 + 1000));
            }
        }
        catch (err) {
            console.warn('[SessionWarmer] Search warm failed, falling back to direct nav.');
        }
        finally {
            await page.close();
        }
    }
}
exports.SessionWarmer = SessionWarmer;
