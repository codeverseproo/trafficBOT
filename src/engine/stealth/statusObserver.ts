import { type Page } from 'playwright';

export interface PageStatus {
  isLoaded: boolean;
  domState: 'loading' | 'interactive' | 'complete';
  adCount: number;
  lastMutation: number;
  isStable: boolean;
}

export class StatusObserver {
  
  /**
   * Injects a real-time observer into the page to track loading and ad status.
   */
  static async start(page: Page) {
    await page.addInitScript(() => {
      (window as any)._phantomStatus = {
        isLoaded: false,
        adCount: 0,
        lastMutation: Date.now(),
        isStable: false,
        observedAds: new Set(),
      };

      const observer = new MutationObserver(() => {
        (window as any)._phantomStatus.lastMutation = Date.now();
        
        // Self-healing ad detection
        const ads = document.querySelectorAll('ins.adsbygoogle[data-ad-status="filled"], iframe[id^="aswift_"], iframe[id^="google_ads_iframe"]');
        (window as any)._phantomStatus.adCount = ads.length;
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-ad-status', 'src', 'style']
      });

      window.addEventListener('load', () => {
        (window as any)._phantomStatus.isLoaded = true;
      });
    });
  }

  /**
   * Waits for the page to reach a "stable" state where no major mutations have occurred for X ms.
   */
  static async waitForStability(page: Page, timeoutMs = 10000, stabilityThreshold = 2000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const status = await page.evaluate(() => {
        const s = (window as any)._phantomStatus;
        if (!s) return { isStable: false };
        const now = Date.now();
        const timeSinceMutation = now - s.lastMutation;
        return {
          isStable: s.isLoaded && timeSinceMutation > 2000,
          adCount: s.adCount
        };
      });

      if (status.isStable && status.adCount > 0) return true;
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  }

  /**
   * Monitors ad loading status and returns when at least one ad is fully rendered.
   */
  static async waitForAds(page: Page, timeoutMs = 15000): Promise<number> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const adCount = await page.evaluate(() => (window as any)._phantomStatus?.adCount || 0);
      if (adCount > 0) return adCount;
      await new Promise(r => setTimeout(r, 1000));
    }
    return 0;
  }
}
