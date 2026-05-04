import { type Page } from 'playwright';
import { StatusObserver } from './stealth/statusObserver';

export interface AdStatus {
  adsFound: number;
  adTypes: string[];
  adPositions: number[];
  hasStickyAds: boolean;
  adDensityMap: { zone: string; count: number }[];
}

export class AdEngine {

  // ─── 1. Detect Google Ads on the Page ──────────────────────────────────────
  static async detectGoogleAds(page: Page): Promise<AdStatus> {
    const result = await page.evaluate(() => {
      const adTypes: string[] = [];
      const adPositions: number[] = [];

      // ── Helper: is this iframe a filled GPT/AdSense ad frame? ────────────
      // CRITICAL: GPT iframes (aswift_*, google_ads_iframe_*) are filled via
      // document.write() into the iframe's document — their `src` attribute
      // stays "about:blank" or "javascript:false" even when rendering a live ad.
      // So src-based detection MISSES all GPT ads.
      // The correct signal is: id prefix (aswift_* / google_ads_iframe_*) AND
      // offsetHeight > 50px. Unfilled placeholder frames collapse to 0px height.
      const isFilledAdIframe = (f: HTMLIFrameElement): boolean => {
        const id  = f.id  || '';
        const src = f.src || '';
        const h   = f.offsetHeight;
        const w   = f.offsetWidth;
        if (h < 10 || w < 10) return false; // collapsed = unfilled

        // Case 1: GPT frame identified by id (src stays blank when filled via doc.write)
        if (id.startsWith('aswift_') || id.startsWith('google_ads_iframe')) return true;

        // Case 2: AdSense/DFP frame that does carry a real src URL
        if (src.includes('googlesyndication.com')        ||
            src.includes('doubleclick.net')               ||
            src.includes('googleads.g.doubleclick.net')   ||
            src.includes('pagead2.googlesyndication'))    return true;

        return false;
      };

      // ── AdSense ins elements ─────────────────────────────────────────────
      // Primary signal: data-ad-status === 'filled' (set by AdSense push tags).
      // Fallback: contains a filled aswift_* child iframe (GPT inside ins wrapper).
      // Do NOT use dimension-only check — publishers set CSS height on empty containers.
      document.querySelectorAll<HTMLElement>('ins.adsbygoogle').forEach(el => {
        const status = el.getAttribute('data-ad-status');
        const hasFilled = status === 'filled' ||
          Array.from(el.querySelectorAll<HTMLIFrameElement>('iframe')).some(isFilledAdIframe);
        if (hasFilled) {
          const rect = el.getBoundingClientRect();
          adPositions.push(rect.top + window.scrollY);
          adTypes.push('AdSense');
        }
      });

      // ── GPT/DFP/AdManager iframes (standalone, not inside ins) ───────────
      document.querySelectorAll<HTMLIFrameElement>('iframe').forEach(f => {
        // Skip iframes that are children of ins.adsbygoogle (already counted above)
        if (f.closest('ins.adsbygoogle')) return;
        if (isFilledAdIframe(f)) {
          const rect = f.getBoundingClientRect();
          adPositions.push(rect.top + window.scrollY);
          adTypes.push('GPT');
        }
      });

      // ── Named AdManager slot divs ─────────────────────────────────────────
      // Only count a slot div if it contains a filled ins OR a filled ad iframe.
      // Removed [class*="adsbygoogle"] — matches same ins elements already counted.
      document.querySelectorAll<HTMLElement>('[id*="google_ads"], [id*="gpt-ad"], [id*="div-gpt-ad"]')
        .forEach(el => {
          if (el.offsetHeight < 10 || el.offsetWidth < 10) return;
          const hasFilledIns    = el.querySelector('ins.adsbygoogle[data-ad-status="filled"]') !== null;
          const hasFilledIframe = Array.from(el.querySelectorAll<HTMLIFrameElement>('iframe')).some(isFilledAdIframe);
          if (hasFilledIns || hasFilledIframe) {
            const rect = el.getBoundingClientRect();
            adPositions.push(rect.top + window.scrollY);
            adTypes.push('AdSlot');
          }
        });

      const unique = (arr: string[]) => [...new Set(arr)];
      const uniquePos = [...new Set(adPositions)].sort((a, b) => a - b);

      // Sticky ad detection
      const hasStickyAds = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe')).some(f => {
        const s = window.getComputedStyle(f);
        return (s.position === 'sticky' || s.position === 'fixed') && f.offsetHeight > 0
          && ((f.src || '').includes('doubleclick') || (f.src || '').includes('googlesyndication'));
      });

      // Ad density map (above/mid/below fold)
      const pageH = document.body.scrollHeight;
      const adDensityMap = [
        { zone: 'above-fold',  count: uniquePos.filter(y => y < window.innerHeight).length },
        { zone: 'mid-page',    count: uniquePos.filter(y => y >= window.innerHeight && y < pageH * 0.66).length },
        { zone: 'below-fold',  count: uniquePos.filter(y => y >= pageH * 0.66).length },
      ];

      return { adsFound: uniquePos.length, adTypes: unique(adTypes), adPositions: uniquePos, hasStickyAds, adDensityMap };
    });

    return result;
  }

  // ─── 1b. Trigger lazy-loaded ad units (IMPROVED) ───────────────────────────
  // Strategy:
  //  Pass 1 — fast scan to fire IntersectionObservers (tells ad network viewports)
  //  Pass 2 — trigger googletag.pubads().refresh() if GPT is loaded
  //  Pass 3 — scroll each ad container into view + dispatchEvent('scroll')
  //  Then poll 3s for ad fill before returning
  static async triggerLazyAds(page: Page, workerId?: number) {
    const tag = workerId !== undefined ? `[W${workerId}]` : '[AdEngine]';
    console.log(`${tag} Triggering lazy ads — multi-pass scan...`);

    try {
      // ── Pass 1: fast scroll sweep to activate IntersectionObservers ────────
      await page.evaluate(async () => {
        const step     = 400;   // px per jump
        const delay    = 80;    // ms between jumps (fast enough to not count as dwell)
        const maxDepth = 6000;  // don't go deeper than 6000px on first pass
        let y = 0;
        while (y < Math.min(document.documentElement.scrollHeight, maxDepth)) {
          window.scrollTo({ top: y, behavior: 'instant' });
          // Force layout/repaint to trigger IntersectionObservers in headless
          document.body.offsetHeight;
          window.dispatchEvent(new Event('scroll'));
          window.dispatchEvent(new Event('resize'));
          await new Promise(r => setTimeout(r, delay));
          y += step;
        }
        window.scrollTo({ top: 0, behavior: 'instant' });
      });

      // ── Pass 2: call googletag.pubads().refresh() if GPT is on the page ───
      await page.evaluate(() => {
        try {
          const g = (window as any).googletag;
          if (g && g.apiReady) {
            g.cmd = g.cmd || [];
            g.cmd.push(() => {
              // Use modern config for disabling initial load if not already set
              if (g.setConfig) {
                g.setConfig({ disableInitialLoad: true });
              }
              
              const slots = g.pubads().getSlots ? g.pubads().getSlots() : [];
              const unfilled = slots.filter((s: any) => {
                const div = document.getElementById(s.getSlotElementId());
                return div && div.offsetHeight < 5;
              });
              
              if (unfilled.length > 0) {
                g.pubads().refresh(unfilled);
              } else if (slots.length > 0) {
                g.pubads().refresh();
              }
            });
          }
        } catch {}
      });

      // ── Pass 3: scroll each known ad container directly into view ──────────
      await page.evaluate(async () => {
        const adSelectors = [
          'ins.adsbygoogle',
          '[id*="google_ads"]',
          '[id*="gpt-ad"]',
          '[id*="div-gpt-ad"]',
          '[class*="adsbygoogle"]',
          'iframe[id^="aswift_"]',
          'iframe[id^="google_ads_iframe"]',
        ];
        const containers: HTMLElement[] = [];
        adSelectors.forEach(sel => {
          document.querySelectorAll<HTMLElement>(sel).forEach(el => {
            containers.push(el);
          });
        });

        // Deduplicate and scroll into view
        const seen = new Set<HTMLElement>();
        for (const el of containers) {
          if (seen.has(el)) continue;
          seen.add(el);
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
          window.dispatchEvent(new Event('scroll'));
          await new Promise(r => setTimeout(r, 120));
        }
        window.scrollTo({ top: 0, behavior: 'instant' });
      });

      // ── Wait for ad fill ───────────────────────────────────────────────────
      await new Promise(r => setTimeout(r, 2000));
      console.log(`${tag} Lazy ad trigger complete.`);

    } catch (e: any) {
      console.warn(`${tag} triggerLazyAds error: ${e?.message}`);
    }
  }

  // ─── 1c. GDPR / Cookie Consent Handler ─────────────────────────────────────
  static async handleGDPRConsent(page: Page, workerId: number): Promise<boolean> {
    const selectors = [
      '#onetrust-accept-btn-handler',
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
      '.qc-cmp2-summary-buttons button:last-child',
      '[aria-label*="Accept all"]',
      '[aria-label*="Accept All"]',
      'button:has-text("Accept all")',
      'button:has-text("Accept All")',
      'button:has-text("Allow all")',
      'button:has-text("I Accept")',
      'button:has-text("Agree")',
      '#acceptAll',
      '.accept-all',
      '[data-action="accept"]',
      '[data-testid="accept-all"]',
      'button:has-text("Allow cookies")',
    ];
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el && await el.isVisible()) {
          await el.click();
          console.log(`[W${workerId}] [AdEngine] GDPR consent accepted (${sel})`);
          await new Promise(r => setTimeout(r, 1500));
          return true;
        }
      } catch {}
    }
    return false;
  }

  // ─── 1d. Dwell on sticky/anchor ads ────────────────────────────────────────
  static async dwellOnStickyAds(page: Page, seconds = 5) {
    const hasSticky = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe')).some(f => {
        const s = window.getComputedStyle(f);
        return (s.position === 'fixed' || s.position === 'sticky') && f.offsetHeight > 0;
      })
    ).catch(() => false);
    if (hasSticky) {
      console.log(`[AdEngine] Sticky ad visible — dwelling ${seconds}s`);
      await new Promise(r => setTimeout(r, seconds * 1000));
    }
  }

  // ─── 2. Scroll to ad positions and dwell for viewability (STRATEGIC) ──────
  static async scrollToAdsAndDwell(page: Page, adPositions: number[]) {
    const viewport = page.viewportSize() ?? { width: 1366, height: 768 };
    
    // Diversity Selection: Pick Top, Middle, and Bottom ads for a realistic profile
    const sorted = [...adPositions].sort((a, b) => a - b);
    const selection = [];
    if (sorted.length > 0) selection.push(sorted[0]); // Top
    if (sorted.length > 2) selection.push(sorted[Math.floor(sorted.length / 2)]); // Middle
    if (sorted.length > 1) selection.push(sorted[sorted.length - 1]); // Bottom
    while (selection.length < Math.min(sorted.length, 5)) {
      const p = sorted[Math.floor(Math.random() * sorted.length)];
      if (!selection.includes(p)) selection.push(p);
    }
    selection.sort((a, b) => a - b);

    console.log(`[AdEngine] Engaging with ${selection.length} strategic ad zones...`);

    for (const adY of selection) {
      // ── Step 1: Center ad in the "Attention Sweet Spot" (Top 30-40% of viewport)
      const targetY = Math.max(0, adY - (viewport.height * 0.3) + (Math.random() * 60 - 30));
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), targetY);
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 500));

      // ── Step 2: High Viewability Dwell with ActiveView Pulse
      const adX = viewport.width / 2 + (Math.random() * 160 - 80);
      const adVpY = adY - targetY; 
      
      const dwell = 3000 + Math.random() * 4000;
      const start = Date.now();
      while (Date.now() - start < dwell) {
        // Micro-scroll & Mouse shift to keep "ActiveView" and "IAS" beacons active
        const micro = (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 2);
        await page.mouse.wheel(0, micro);
        await page.mouse.move(adX + (Math.random() * 30 - 15), (adVpY + 60) + (Math.random() * 20 - 10), { steps: 5 });
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 500));
      }
    }
  }

  // ─── 1e. Check ad blocker detection ────────────────────────────────────────
  static async checkAdBlockerDetected(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      const bait = document.createElement('div');
      bait.className = 'ad-banner ad ads adsbox doubleclick iad adsbygoogle';
      bait.style.cssText = 'width:1px;height:1px;position:absolute;left:-9999px';
      document.body.appendChild(bait);
      const blocked = bait.offsetHeight === 0 || bait.offsetParent === null;
      document.body.removeChild(bait);
      return blocked;
    }).catch(() => false);
  }

  // ─── 3. Detect & Dismiss Vignette / Interstitial Ads ──────────────────────
  static async handleVignetteAd(page: Page, workerId: number): Promise<boolean> {
    try {
      const vignetteFound = await page.evaluate(() => {
        const iframes = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'));
        return iframes.some(f => {
          const style = window.getComputedStyle(f);
          const isFixed = style.position === 'fixed';
          const isBig   = f.offsetWidth  > window.innerWidth  * 0.6;
          const isTall  = f.offsetHeight > window.innerHeight * 0.6;
          const isAd    = f.id.startsWith('aswift_') ||
                          f.id.includes('google_ads') ||
                          (f.src && (
                            f.src.includes('googlesyndication') ||
                            f.src.includes('doubleclick') ||
                            f.src.includes('google.com/vignette')
                          ));
          return isFixed && isBig && isTall && isAd;
        });
      });

      if (!vignetteFound) return false;

      console.log(`[W${workerId}] [AdEngine] Vignette detected — dwelling 5s for viewability...`);
      await new Promise(r => setTimeout(r, 5000));
      await page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 500));

      const stillVisible = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe')).some(f => {
          const style = window.getComputedStyle(f);
          return style.position === 'fixed' && f.offsetWidth > window.innerWidth * 0.6;
        })
      );

      if (stillVisible) {
        await page.mouse.click(10, 10);
        await new Promise(r => setTimeout(r, 800));
      }

      console.log(`[W${workerId}] [AdEngine] Vignette dismissed.`);
      return true;
    } catch {
      return false;
    }
  }

  // ─── 4. Find Internal Blog/Article Link ────────────────────────────────────
  // Strictly navigates to /blogs/ paths only — avoids category/tag/archive pages
  // that have no ad slots and waste session time.
  static async findInternalContentLink(page: Page): Promise<string | null> {
    return page.evaluate(() => {
      const host = window.location.hostname;
      const seen = new Set<string>();
      const currentPath = window.location.pathname;

      const candidates = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'))
        .map(a => ({ href: a.href, text: (a.innerText || '').trim() }))
        .filter(({ href, text }) => {
          if (!href || seen.has(href)) return false;
          seen.add(href);
          try {
            const u = new URL(href);
            if (u.hostname !== host)    return false;
            if (u.hash)                 return false;
            if (u.pathname === currentPath) return false; // don't re-visit same page
            // STRICT: only /blogs/ paths — no categories, tags, or generic deep paths
            return u.pathname.includes('/blogs/') && text.length > 2;
          } catch {
            return false;
          }
        });

      if (candidates.length === 0) return null;
      // Pick randomly from up to 8 candidates for variety
      return candidates[Math.floor(Math.random() * Math.min(candidates.length, 8))].href;
    });
  }

  // ─── 5. Full-Load-First Ad Strategy ────────────────────────────────────────
  // Flow:
  //   Step 1 — Wait for FULL page load (networkidle / load event)
  //   Step 2 — Trigger lazy ads, poll up to 10s for fills
  //   Step 3 — If still no ads: reload page, wait for full load again
  //   Step 4 — Re-trigger lazy ads, poll up to 10s again
  //   Step 5 — Return whether any ads were found (caller skips page if false)
  static async waitForLoad(page: Page, workerId: number): Promise<boolean> {
    const tag = `[W${workerId}] [AdEngine]`;

    // ── Helper: wait for page to be fully loaded ──────────────────────────
    const waitFullLoad = async (label: string) => {
      console.log(`${tag} Waiting for full page load (${label})...`);
      
      // Start real-time observation
      await StatusObserver.start(page);
      
      // Wait for network/DOM stability
      const stable = await StatusObserver.waitForStability(page);
      if (stable) {
        console.log(`${tag} Page reached stable state (${label}).`);
      } else {
        // Fallback to traditional load state
        await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      }
      
      await new Promise(r => setTimeout(r, 1000));
    };

    // ── Helper: trigger lazy ads then poll for fills ────────────────────
    const triggerAndPoll = async (label: string): Promise<boolean> => {
      console.log(`${tag} Triggering lazy ads (${label})...`);
      await this.triggerLazyAds(page, workerId);

      // Use StatusObserver to wait for ads to render
      const adCount = await StatusObserver.waitForAds(page, 10000);
      if (adCount > 0) {
        console.log(`${tag} ✓ ${adCount} ads visible via MutationObserver (${label})`);
        return true;
      }
      return false;
    };

    // ── Step 1 & 2: Full load → trigger → poll ────────────────────────────
    await waitFullLoad('initial');
    const foundOnFirst = await triggerAndPoll('attempt 1');
    if (foundOnFirst) return true;

    // ── Step 3: Refresh once ──────────────────────────────────────────────
    console.log(`${tag} No ads after first attempt — refreshing page...`);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

    // ── Step 4: Full load again → trigger → poll ──────────────────────────
    await waitFullLoad('after refresh');
    const foundOnRetry = await triggerAndPoll('attempt 2 (post-refresh)');

    if (!foundOnRetry) {
      console.warn(`${tag} No ads after refresh — will skip this page.`);
    }
    return foundOnRetry;
  }
}
