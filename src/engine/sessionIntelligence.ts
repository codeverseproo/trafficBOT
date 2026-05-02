import { type Page } from 'playwright';

export interface SessionStats {
  url: string;
  pagesVisited: number;
  adsFound: number;
  totalTimeMs: number;
  scrollDepthPct: number;
  mouseEvents: number;
  engagementScore: number; // 0-100
  profile: string;
  proxy: string;
  timestamp: number;
}

// ─── Engagement Score ──────────────────────────────────────────────────────────
export function calcEngagementScore(stats: Partial<SessionStats>): number {
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
export async function seedBrowserHistory(page: Page, targetUrl: string) {
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
  } catch {}
}

// ─── localStorage Pre-Seeding ─────────────────────────────────────────────────
export async function seedLocalStorage(page: Page) {
  await page.evaluate(() => {
    const seeds: Record<string, string> = {
      'theme': Math.random() > 0.5 ? 'dark' : 'light',
      'fontSize': ['small', 'medium', 'large'][Math.floor(Math.random() * 3)],
      'lastVisit': new Date(Date.now() - Math.random() * 7 * 86400000).toISOString(),
      'readingProgress': JSON.stringify({ articles: Math.floor(Math.random() * 20) }),
      'newsletter': Math.random() > 0.7 ? 'subscribed' : 'dismissed',
    };
    for (const [k, v] of Object.entries(seeds)) {
      try { localStorage.setItem(k, v); } catch {}
    }
  });
}

// ─── Service Worker Bypass ────────────────────────────────────────────────────
export async function bypassServiceWorker(page: Page) {
  await page.addInitScript(() => {
    // Override SW registration so it can't intercept ad requests
    const origRegister = navigator.serviceWorker?.register?.bind(navigator.serviceWorker);
    if (origRegister) {
      navigator.serviceWorker.register = async (url: string, opts?: any) => {
        console.debug('[SessionIntelligence] SW registration intercepted:', url);
        return origRegister(url, opts);
      };
    }
  });
}

// ─── IndexedDB Seeding ────────────────────────────────────────────────────────
export async function seedIndexedDB(page: Page) {
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
    } catch {}
  });
}

// ─── Dark Mode Consistency ────────────────────────────────────────────────────
export async function injectDarkModeConsistency(page: Page, isDark: boolean) {
  await page.addInitScript((dark) => {
    const orig = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      const mq = orig(query);
      if (query.includes('prefers-color-scheme')) {
        return Object.defineProperties(mq, {
          matches: { get: () => dark },
          media:   { get: () => query },
        }) as MediaQueryList;
      }
      return mq;
    };
  }, isDark);
}

// ─── Session Duration Normalizer ──────────────────────────────────────────────
export async function ensureMinimumDuration(startTime: number, minSeconds: number) {
  const elapsed = (Date.now() - startTime) / 1000;
  if (elapsed < minSeconds) {
    const remaining = (minSeconds - elapsed) * 1000;
    console.log(`[SessionIntelligence] Padding session by ${Math.round(remaining / 1000)}s`);
    await new Promise(r => setTimeout(r, remaining));
  }
}

// ─── Scroll Depth Tracker ─────────────────────────────────────────────────────
export async function getScrollDepth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const total = document.body.scrollHeight - window.innerHeight;
    if (total <= 0) return 100;
    return Math.round((window.scrollY / total) * 100);
  }).catch(() => 0);
}
