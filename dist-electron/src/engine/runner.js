"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaywrightRunner = void 0;
const playwright_1 = require("playwright");
const personaManager_1 = require("./personaManager");
const proxyManager_1 = require("./proxyManager");
const mouseEngine_1 = require("./stealth/mouseEngine");
const scrollingEngine_1 = require("./stealth/scrollingEngine");
const fingerprintSpoofing_1 = require("./stealth/fingerprintSpoofing");
const sessionWarmer_1 = require("./stealth/sessionWarmer");
const adEngine_1 = require("./adEngine");
const behaviorProfiles_1 = require("./behaviorProfiles");
const sessionIntelligence_1 = require("./sessionIntelligence");
// ─── Runner ──────────────────────────────────────────────────────────────────
class PlaywrightRunner {
    browsers = [];
    sessionHistory = [];
    proxyManager;
    personaManager;
    _stop = false;
    _paused = false;
    constructor(store) {
        this.store = store;
        this.personaManager = new personaManager_1.PersonaManager(store);
        this.proxyManager = new proxyManager_1.ProxyManager(store);
    }
    store;
    getHistory() { return this.sessionHistory; }
    gracefulStop() { this._stop = true; console.log('[Runner] Stop requested — draining queue.'); }
    pause() { this._paused = true; console.log('[Runner] ⏸ Paused.'); }
    resume() { this._paused = false; console.log('[Runner] ▶ Resumed.'); }
    /** Blocks execution until unpaused or stop requested */
    async waitIfPaused() {
        while (this._paused && !this._stop) {
            await new Promise(r => setTimeout(r, 500));
        }
    }
    async start(options) {
        this._stop = false;
        // ── Quantum seed fetch ──────────────────────────────────────────────────
        await (0, behaviorProfiles_1.getQuantumSeed)();
        console.log(`[Runner] Starting — ${options.urls.length} URL(s), mode=${options.runMode ?? 'headless'}`);
        const concurrency = options.concurrency || 1;
        const totalSessions = options.totalSessions || options.urls.length;
        const rotMode = options.proxyRotation ?? 'smart';
        const minSecs = options.minSessionSeconds ?? 30;
        const runMode = options.runMode ?? (options.headless === false ? 'headed' : 'headless');
        // Queue: spread totalSessions round-robin across URLs
        const queue = [];
        for (let i = 0; i < totalSessions; i++) {
            queue.push(options.urls[i % options.urls.length]);
        }
        queue.sort(() => Math.random() - 0.5);
        const allPersonas = this.personaManager.getPersonas();
        const fixedPersona = options.personaId
            ? allPersonas.find(p => p.id === options.personaId)
            : undefined;
        const uaPool = this.store.get('userAgents', []);
        const VIEWPORTS = [
            { width: 1920, height: 1080 }, { width: 1366, height: 768 },
            { width: 1440, height: 900 }, { width: 1536, height: 864 },
        ];
        const clickLimiter = new behaviorProfiles_1.ClickRateLimiter();
        const workers = Array(concurrency).fill(null).map(async (_, workerId) => {
            while (queue.length > 0 && !this._stop) {
                await this.waitIfPaused();
                if (this._stop)
                    break;
                const url = queue.shift();
                if (!url)
                    break;
                // ─── Behavior profile ──────────────────────────────────────────────
                const profile = (0, behaviorProfiles_1.randomProfile)();
                const fatigue = new behaviorProfiles_1.ScrollFatigueModel();
                // ─── Proxy selection ───────────────────────────────────────────────
                let proxy = null;
                if (options.useProxyPool) {
                    proxy = this.proxyManager.getNextProxy(rotMode, url);
                }
                // ─── Browser / headless mode ───────────────────────────────────────
                // In 'mixed' mode, alternate: even workers headless, odd workers headed
                const isHeadless = runMode === 'headless' ? true
                    : runMode === 'headed' ? false
                        : (workerId % 2 === 0); // mixed
                const browserEngine = options.engineBrowser ?? 'chromium';
                const launchFn = browserEngine === 'firefox' ? playwright_1.firefox : playwright_1.chromium;
                const browser = await launchFn.launch({
                    headless: options.manualAssistMode ? false : isHeadless,
                    args: isHeadless ? [
                        '--disable-blink-features=AutomationControlled',
                        '--disable-infobars',
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--window-size=1920,1080',
                        '--use-gl=egl', // GPU acceleration for better canvas fingerprints
                    ] : [
                        '--disable-blink-features=AutomationControlled',
                        '--disable-infobars',
                        '--no-sandbox',
                        '--window-size=1920,1080',
                    ],
                });
                this.browsers.push(browser);
                // ─── Context options ───────────────────────────────────────────────
                const contextOptions = {};
                if (proxy) {
                    const isSocks5 = proxy.server.toLowerCase().startsWith('socks5');
                    const hasAuth = !!(proxy.username && proxy.password);
                    if (isSocks5 && hasAuth) {
                        contextOptions.proxy = { server: proxy.server };
                    }
                    else if (hasAuth) {
                        contextOptions.proxy = { server: proxy.server, username: proxy.username, password: proxy.password };
                    }
                    else {
                        contextOptions.proxy = { server: proxy.server };
                    }
                }
                // ─── Identity selection ────────────────────────────────────────────
                let activePersona = fixedPersona;
                if (!activePersona && allPersonas.length > 0) {
                    activePersona = allPersonas[Math.floor(Math.random() * allPersonas.length)];
                }
                if (activePersona) {
                    contextOptions.userAgent = activePersona.userAgent;
                    contextOptions.locale = activePersona.locale;
                    contextOptions.timezoneId = activePersona.timezoneId;
                    contextOptions.viewport = activePersona.viewport;
                    try {
                        const fs = require('fs');
                        if (fs.existsSync(activePersona.statePath))
                            contextOptions.storageState = activePersona.statePath;
                    }
                    catch { }
                }
                else if (uaPool.length > 0) {
                    contextOptions.userAgent = uaPool[Math.floor(Math.random() * uaPool.length)];
                    contextOptions.viewport = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
                }
                // ─── Dark mode consistency ─────────────────────────────────────────
                const isDark = Math.random() > 0.5;
                // ─── Jitter between worker spawns ──────────────────────────────────
                await new Promise(r => setTimeout(r, Math.floor(Math.random() * 3000)));
                console.log(`[W${workerId}] ${url} | Proxy: ${proxy?.server || 'none'} | Profile: ${profile.name} | Mode: ${isHeadless ? 'headless' : 'headed'}`);
                // ─── Smart Sync: Geo & Timezone from Proxy ─────────────────────────
                // Always sync when a proxy is active — proxy IP geo must match browser
                // timezone/locale or ad servers can detect the mismatch.
                if (proxy) {
                    try {
                        const metaCtx = await browser.newContext({ proxy: contextOptions.proxy });
                        const metaPage = await metaCtx.newPage();
                        const metaRes = await metaPage.goto('http://ip-api.com/json', { timeout: 10000 });
                        if (metaRes?.ok()) {
                            const d = await metaRes.json();
                            if (d?.status === 'success') {
                                console.log(`[W${workerId}] SmartSync: ${d.city}, ${d.country} (${d.timezone}) | ISP: ${d.isp}`);
                                contextOptions.timezoneId = d.timezone;
                                contextOptions.geolocation = { latitude: d.lat, longitude: d.lon };
                                contextOptions.permissions = ['geolocation'];
                                contextOptions.locale = d.countryCode === 'US' ? 'en-US'
                                    : d.countryCode === 'GB' ? 'en-GB'
                                        : `en-${d.countryCode}`;
                                this.proxyManager.updateProxyGeo(proxy.id, {
                                    country: d.country, city: d.city, isp: d.isp,
                                });
                                if (this.proxyManager.classifyISP(d.isp || '')) {
                                    console.warn(`[W${workerId}] ⚠ Datacenter IP detected (${d.isp}) — may reduce trust score`);
                                }
                            }
                        }
                        await metaCtx.close();
                    }
                    catch {
                        console.warn(`[W${workerId}] SmartSync failed — proceeding with defaults`);
                    }
                }
                const context = await browser.newContext(contextOptions);
                // ─── Stealth init scripts ──────────────────────────────────────────
                await fingerprintSpoofing_1.FingerprintSpoofing.install(context, {
                    locale: contextOptions.locale,
                    timezoneId: contextOptions.timezoneId,
                    isDarkMode: isDark,
                });
                // ─── Session warming ───────────────────────────────────────────────
                let mousePos = { x: 640, y: 400 };
                if (options.sessionWarm)
                    await sessionWarmer_1.SessionWarmer.warmSession(context, mousePos);
                if (options.searchReferer)
                    await sessionWarmer_1.SessionWarmer.warmViaSearch(context, url);
                const page = await context.newPage();
                // ─── Referrer override ─────────────────────────────────────────────
                const referrer = (0, behaviorProfiles_1.randomReferrer)(url);
                if (referrer) {
                    await page.setExtraHTTPHeaders({ Referer: referrer });
                }
                // ─── SESSION FLOW ──────────────────────────────────────────────────
                let pageViewCount = 0;
                const MAX_PAGE_VIEWS = 4;
                let sessionActive = true;
                let currentUrl = (0, behaviorProfiles_1.injectUTM)(url);
                let totalAdsFound = 0;
                let totalMouseEvt = 0;
                let scrollDepth = 0;
                const sessionStart = Date.now();
                const triedProxies = proxy ? [proxy.id] : [];
                try {
                    while (sessionActive && pageViewCount < MAX_PAGE_VIEWS && !this._stop) {
                        await this.waitIfPaused();
                        if (this._stop) {
                            sessionActive = false;
                            break;
                        }
                        pageViewCount++;
                        console.log(`[W${workerId}] ── P${pageViewCount}/${MAX_PAGE_VIEWS}: ${currentUrl}`);
                        // ─ 1. Navigate ────────────────────────────────────────────────
                        const nav = await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 40000 })
                            .catch(async (err) => {
                            const m = err.message;
                            if (m.includes('ERR_SOCKS_CONNECTION_FAILED') ||
                                m.includes('ERR_PROXY_CONNECTION_FAILED') ||
                                m.includes('ERR_TUNNEL_CONNECTION_FAILED')) {
                                if (proxy) {
                                    console.warn(`[W${workerId}] Proxy dead → deleting ${proxy.server}`);
                                    this.proxyManager.deleteProxy(proxy.id);
                                    const fallback = this.proxyManager.getFailoverProxy(triedProxies);
                                    if (fallback) {
                                        console.log(`[W${workerId}] Failover → ${fallback.server}`);
                                        triedProxies.push(fallback.id);
                                        proxy = fallback;
                                    }
                                }
                                sessionActive = false;
                                return null;
                            }
                            throw err;
                        });
                        if (!sessionActive || !nav)
                            break;
                        // ─ 2. Full load → trigger lazy ads → refresh if needed ────────
                        // waitForLoad: waits networkidle, triggers, polls 10s,
                        // refreshes once if empty, waits again, triggers again, polls 10s.
                        // Returns true if ads found, false if still none after refresh.
                        await adEngine_1.AdEngine.waitForLoad(page, workerId);
                        // ─ 3. GDPR consent → triggers ad loading ─────────────────────
                        await adEngine_1.AdEngine.handleGDPRConsent(page, workerId);
                        // ─ 4. Check for ad blocker detection ─────────────────────────
                        const adBlocked = await adEngine_1.AdEngine.checkAdBlockerDetected(page);
                        if (adBlocked)
                            console.warn(`[W${workerId}] Ad blocker detected by publisher`);
                        // ─ 5. Handle Vignette ─────────────────────────────────────────
                        await adEngine_1.AdEngine.handleVignetteAd(page, workerId);
                        // ─ 6. Seed storage for returning-visitor look ─────────────────
                        await (0, sessionIntelligence_1.seedLocalStorage)(page);
                        await (0, sessionIntelligence_1.seedIndexedDB)(page);
                        await (0, sessionIntelligence_1.seedBrowserHistory)(page, currentUrl);
                        // ─ 7. Detect Google Ads ───────────────────────────────────────
                        const adStatus = await adEngine_1.AdEngine.detectGoogleAds(page);
                        totalAdsFound += adStatus.adsFound;
                        console.log(`[W${workerId}] Ads: ${adStatus.adsFound} | Sticky: ${adStatus.hasStickyAds} | Density: ${JSON.stringify(adStatus.adDensityMap)}`);
                        // ─ 8. Ad-Gate: no ads after full load + refresh → skip page ───
                        if (adStatus.adsFound === 0 && !adBlocked) {
                            if (pageViewCount < MAX_PAGE_VIEWS) {
                                console.log(`[W${workerId}] No ads on P${pageViewCount} — navigating to next /blogs/ post.`);
                                const next = await adEngine_1.AdEngine.findInternalContentLink(page);
                                if (next) {
                                    currentUrl = (0, behaviorProfiles_1.injectUTM)(next);
                                    await clickLimiter.throttle();
                                    continue;
                                }
                            }
                            console.log(`[W${workerId}] No ads and no further /blogs/ links — closing session.`);
                            sessionActive = false;
                            break;
                        }
                        const pageInteractStart = Date.now();
                        const MAX_PAGE_INTERACT_MS = 30000;
                        // ─ 10. Humanistic Reading ─────────────────────────────────────
                        const wX = 200 + Math.random() * 800;
                        const wY = 200 + Math.random() * 400;
                        mousePos = await mouseEngine_1.MouseEngine.move(page, mousePos.x, mousePos.y, wX, wY, profile);
                        totalMouseEvt++;
                        // Attention drift to content anchors
                        mousePos = await mouseEngine_1.MouseEngine.attentionDrift(page, mousePos, profile);
                        totalMouseEvt++;
                        // Full page read (content-aware, with fatigue)
                        // Limit readPage time to what's left of the 30s budget
                        const budgetUsed = Date.now() - pageInteractStart;
                        const readBudget = Math.max(5000, MAX_PAGE_INTERACT_MS - budgetUsed);
                        scrollDepth = await scrollingEngine_1.ScrollingEngine.readPage(page, profile, fatigue, readBudget, adStatus.adPositions);
                        // ─ 11. Dwell on sticky ads ────────────────────────────────────
                        if (adStatus.hasStickyAds && (Date.now() - pageInteractStart < MAX_PAGE_INTERACT_MS)) {
                            await adEngine_1.AdEngine.dwellOnStickyAds(page, 4);
                        }
                        // ─ 12. Check vignette again ───────────────────────────────────
                        await adEngine_1.AdEngine.handleVignetteAd(page, workerId);
                        // ─ 14. Humanistic behaviors ───────────────────────────────────
                        await (0, behaviorProfiles_1.simulateTabIdle)(page, profile);
                        await (0, behaviorProfiles_1.simulateCopyText)(page, profile);
                        await (0, behaviorProfiles_1.simulateBookmark)(page, profile);
                        // ─ 15. Random hover wander ────────────────────────────────────
                        if (Math.random() > 0.4) {
                            mousePos = await mouseEngine_1.MouseEngine.hoverRandom(page, mousePos);
                            totalMouseEvt++;
                        }
                        // ─ 16. Manual Assist ──────────────────────────────────────────
                        if (options.manualAssistMode) {
                            console.log(`[W${workerId}] Paused 30s — manual assist`);
                            await new Promise(r => setTimeout(r, 30000));
                        }
                        // ─ 17. Post-read dwell ────────────────────────────────────────
                        if (options.postReadDelay && options.postReadDelay > 0) {
                            await new Promise(r => setTimeout(r, (options.postReadDelay || 0) * 1000));
                        }
                        const title = await page.title();
                        console.log(`[W${workerId}] ✓ P${pageViewCount}: "${title}" | Ads: ${adStatus.adsFound} | Scroll: ${scrollDepth}%`);
                        // ─ 18. Navigate to next internal page ─────────────────────────
                        if (pageViewCount < MAX_PAGE_VIEWS) {
                            const nextLink = await adEngine_1.AdEngine.findInternalContentLink(page);
                            if (nextLink) {
                                currentUrl = (0, behaviorProfiles_1.injectUTM)(nextLink);
                                // Click rate limiting
                                await clickLimiter.throttle();
                            }
                            else {
                                sessionActive = false;
                            }
                        }
                    } // end while
                    // ─── Minimum session duration ────────────────────────────────────
                    await (0, sessionIntelligence_1.ensureMinimumDuration)(sessionStart, minSecs);
                    // Store history
                    this.sessionHistory.push({
                        url, pagesVisited: pageViewCount, adsFound: totalAdsFound,
                        totalTimeMs: Date.now() - sessionStart,
                        scrollDepthPct: scrollDepth, mouseEvents: totalMouseEvt,
                        engagementScore: (0, sessionIntelligence_1.calcEngagementScore)({
                            totalTimeMs: Date.now() - sessionStart,
                            pagesVisited: pageViewCount,
                            adsFound: totalAdsFound,
                            scrollDepthPct: scrollDepth,
                            mouseEvents: totalMouseEvt,
                        }), profile: profile.name,
                        proxy: proxy?.server || 'direct', timestamp: Date.now(),
                    });
                    // ─── Proxy cleanup ───────────────────────────────────────────────
                    if (proxy) {
                        console.log(`[W${workerId}] Deleting used proxy: ${proxy.server}`);
                        this.proxyManager.deleteProxy(proxy.id);
                    }
                    // ─── Persist persona state ───────────────────────────────────────
                    if (activePersona) {
                        await context.storageState({ path: activePersona.statePath }).catch(() => { });
                    }
                }
                catch (error) {
                    const msg = error?.message || String(error);
                    if (msg.includes('ERR_SOCKS_CONNECTION_FAILED') || msg.includes('ERR_PROXY_CONNECTION_FAILED') || msg.includes('ERR_TUNNEL_CONNECTION_FAILED')) {
                        console.error(`[W${workerId}] ✗ Proxy dead → deleting`);
                        if (proxy)
                            this.proxyManager.deleteProxy(proxy.id);
                    }
                    else if (msg.includes('Timeout') || msg.includes('timeout')) {
                        console.error(`[W${workerId}] ✗ Timeout — Deleting proxy`);
                        if (proxy)
                            this.proxyManager.deleteProxy(proxy.id);
                    }
                    else {
                        console.error(`[W${workerId}] ✗ ${msg.split('\n')[0]}`);
                        if (proxy)
                            this.proxyManager.deleteProxy(proxy.id);
                    }
                }
                finally {
                    await page.close().catch(() => { });
                    await context.close().catch(() => { });
                    await browser.close().catch(() => { });
                }
            }
        });
        await Promise.all(workers);
        console.log(`[Runner] All workers done. Total sessions: ${this.sessionHistory.length}`);
    }
    async close() {
        for (const b of this.browsers)
            await b.close().catch(() => { });
        this.browsers = [];
    }
}
exports.PlaywrightRunner = PlaywrightRunner;
