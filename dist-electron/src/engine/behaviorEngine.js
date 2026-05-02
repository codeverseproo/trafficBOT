"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BehaviorEngine = void 0;
class BehaviorEngine {
    static async randomSleep(min, max) {
        const ms = Math.floor(Math.random() * (max - min + 1)) + min;
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    static async humanScroll(page) {
        // Scroll down in small, randomized chunks
        const scrolls = Math.floor(Math.random() * 5) + 3;
        for (let i = 0; i < scrolls; i++) {
            const scrollAmount = Math.floor(Math.random() * 300) + 100;
            await page.mouse.wheel(0, scrollAmount);
            await this.randomSleep(500, 1500); // Read pause
        }
        // Sometimes scroll back up slightly
        if (Math.random() > 0.7) {
            await page.mouse.wheel(0, -Math.floor(Math.random() * 200));
            await this.randomSleep(300, 800);
        }
    }
    static async humanMoveMouse(page) {
        // Move to a random position on the screen
        const x = Math.floor(Math.random() * 800) + 100;
        const y = Math.floor(Math.random() * 600) + 100;
        // Playwright mouse movement with steps to simulate curve
        await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
        await this.randomSleep(200, 500);
    }
    static async smartWait(page, selector) {
        // Wait for network idle, then element to be visible
        await page.waitForLoadState('domcontentloaded');
        try {
            await page.waitForSelector(selector, { state: 'visible', timeout: 15000 });
            await this.randomSleep(1000, 2500); // Reaction time
            return true;
        }
        catch {
            return false;
        }
    }
}
exports.BehaviorEngine = BehaviorEngine;
