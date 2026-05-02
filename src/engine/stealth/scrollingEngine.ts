import { type Page } from 'playwright';
import type { BehaviorProfile, ScrollFatigueModel } from '../behaviorProfiles';

export class ScrollingEngine {

  private static easeOutQuint(t: number) { return 1 - Math.pow(1 - t, 5); }

  // ─── Inertial humanScroll (mouse wheel) ──────────────────────────────────
  static async humanScroll(page: Page, distance: number, _profile?: any) {
    const steps = Math.floor(Math.random() * 20) + 10;
    let cur = 0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const target = distance * this.easeOutQuint(t);
      await page.mouse.wheel(0, target - cur);
      cur = target;
      await new Promise(r => setTimeout(r, Math.random() * 15 + 5));
    }
  }

  // ─── Keyboard scroll variation (Page Down / Space / Arrow) ───────────────
  private static async keyScroll(page: Page) {
    const keys = ['PageDown', 'Space', 'ArrowDown', 'ArrowDown', 'ArrowDown'];
    const key  = keys[Math.floor(Math.random() * keys.length)];
    await page.keyboard.press(key);
    await new Promise(r => setTimeout(r, Math.random() * 300 + 100));
  }

  // ─── Content-aware reading pace ───────────────────────────────────────────
  private static async readingDwell(page: Page, profile: BehaviorProfile, fatigue: ScrollFatigueModel): Promise<void> {
    const wordCount = await page.evaluate(() => {
      const texts = Array.from(document.querySelectorAll<HTMLElement>('p, li, blockquote'))
        .filter(el => {
          const r = el.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= window.innerHeight;
        })
        .map(el => el.innerText)
        .join(' ');
      return texts.trim().split(/\s+/).filter(Boolean).length;
    }).catch(() => 80);

    const baseMs = (wordCount / profile.wpm) * 60000;
    const fatigueMult = fatigue.dwellMultiplier();
    const dwell = Math.max(
      profile.dwellMin,
      Math.min(profile.dwellMax * fatigueMult, baseMs * fatigueMult)
    );
    await new Promise(r => setTimeout(r, dwell));
  }

  // ─── Image / media focus pause ────────────────────────────────────────────
  private static async imagesPause(page: Page, profile: BehaviorProfile) {
    const imgCount = await page.evaluate(() => {
      return Array.from(document.querySelectorAll<HTMLElement>('img, figure, video'))
        .filter(el => {
          const r = el.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= window.innerHeight && r.width > 50;
        }).length;
    }).catch(() => 0);
    if (imgCount > 0) {
      const extra = imgCount * profile.imagePauseMultiplier * (Math.random() * 1500 + 800);
      await new Promise(r => setTimeout(r, extra));
    }
  }

  // ─── Code / Technical Content pause ───────────────────────────────────────
  private static async codePause(page: Page) {
    const hasCode = await page.evaluate(() => {
      return Array.from(document.querySelectorAll<HTMLElement>('pre, code'))
        .some(el => {
          const r = el.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= window.innerHeight;
        });
    }).catch(() => false);
    if (hasCode) {
      const extra = 2000 + Math.random() * 3000;
      await new Promise(r => setTimeout(r, extra));
    }
  }

  // ─── Sticky header height ─────────────────────────────────────────────────
  // (Removed stickyOffset as it is no longer used)

  // ─── Infinite scroll handler ──────────────────────────────────────────────
  private static async handleInfiniteScroll(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      const sentinel = document.querySelector('[class*="sentinel"], [class*="load-more"], [class*="infinite"]');
      if (sentinel) {
        sentinel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
      }
      return false;
    }).catch(() => false);
  }

  // ─── Full page read ───────────────────────────────────────────────────────
  static async readPage(page: Page, profile?: BehaviorProfile, fatigue?: ScrollFatigueModel, maxTimeMs = 25000, adPositions: number[] = []): Promise<number> {
    const prof = profile ?? {
      wpm: 238, dwellMin: 1200, dwellMax: 4000,
      reverseScrollChance: 0.2, earlyStopChance: 0.05,
      imagePauseMultiplier: 1.0,
    } as any;
    const fat = fatigue ?? { dwellMultiplier: () => 1, speedMultiplier: () => 1 } as any;

    const bodyHeight = await page.evaluate(() => document.body.scrollHeight).catch(() => 1000);
    const vpHeight   = await page.evaluate(() => window.innerHeight).catch(() => 768);

    if (bodyHeight <= vpHeight) {
      await this.readingDwell(page, prof, fat);
      return 100;
    }

    // Approach Randomizer
    const approaches = ['scanner', 'reader', 'skimmer', 'researcher'];
    const approach = approaches[Math.floor(Math.random() * approaches.length)];
    console.log(`[ScrollingEngine] Ultra-Humanistic Mode: ${approach.toUpperCase()} approach`);

    let scrolled = 0;
    let useKeyboard = Math.random() > 0.8; 
    const readStart = Date.now();
    const seenAds = new Set<number>();

    while (scrolled + vpHeight < bodyHeight) {
      const elapsed = Date.now() - readStart;
      if (elapsed > maxTimeMs) break; 

      const speedMult = fat.speedMultiplier() * (approach === 'scanner' ? 1.5 : approach === 'reader' ? 0.8 : 1.0);
      let scrollAmt = (vpHeight * (Math.random() * 0.4 + 0.2)) * speedMult;

      // Ad Viewability Injection
      const nextAd = adPositions.find(pos => pos > scrolled && pos < scrolled + vpHeight + 300);
      if (nextAd && !seenAds.has(nextAd)) {
        // Slow down to center the ad
        scrollAmt = (nextAd - scrolled) - (vpHeight / 2) + (Math.random() * 50 - 25);
        if (scrollAmt < 0) scrollAmt = 50; 
        
        await this.humanScroll(page, scrollAmt, prof);
        scrolled += scrollAmt;
        
        // High Viewability Dwell (IAS requirement: 1s, we do 2-4s for premium score)
        const adDwell = approach === 'scanner' ? 1500 : 3000 + Math.random() * 2000;
        console.log(`[ScrollingEngine] Ad in view — Dwelling for ${Math.round(adDwell)}ms`);
        await new Promise(r => setTimeout(r, adDwell));
        seenAds.add(nextAd);
        
        // Micro-engagement near ad
        if (Math.random() > 0.5) {
          const cx = (vpHeight / 2) + (Math.random() * 200 - 100);
          await page.mouse.move(cx, cx / 2);
        }
      } else {
        // Normal scroll
        if (useKeyboard && Math.random() > 0.6) {
          await this.keyScroll(page);
          scrolled += vpHeight * 0.4;
        } else {
          await this.humanScroll(page, scrollAmt, prof);
          scrolled += scrollAmt;
        }
      }

      // Approach-based Dwell
      if (approach === 'reader' || Math.random() > 0.5) {
        await this.readingDwell(page, prof, fat);
      }
      
      if (approach !== 'scanner') {
        await this.imagesPause(page, prof);
        await this.codePause(page);
      }

      // Fatigue-based reverse scroll
      if (Math.random() < prof.reverseScrollChance * (approach === 'researcher' ? 2 : 1)) {
        const back = -(vpHeight * (Math.random() * 0.2 + 0.05));
        await this.humanScroll(page, back, prof);
        scrolled += back;
        await new Promise(r => setTimeout(r, Math.random() * 1000 + 500));
      }

      if (Math.random() > 0.9) useKeyboard = !useKeyboard;

      // Infinite scroll check
      if (scrolled + vpHeight >= bodyHeight) {
        const triggered = await ScrollingEngine.handleInfiniteScroll(page);
        if (triggered) await new Promise(r => setTimeout(r, 1500));
      }

      if (Math.random() < prof.earlyStopChance) break;
    }

    // End of read — 30% chance of scrolling back to top slowly
    if (Math.random() < 0.3 && scrolled > 1000) {
      console.log('[ScrollingEngine] Done reading — scrolling back to top...');
      await this.humanScroll(page, -scrolled, prof);
      await new Promise(r => setTimeout(r, 1000));
    }

    const depth = await page.evaluate(() => {
      const total = document.body.scrollHeight - window.innerHeight;
      return total > 0 ? Math.round((window.scrollY / total) * 100) : 100;
    }).catch(() => 0);

    return depth;
  }
}
