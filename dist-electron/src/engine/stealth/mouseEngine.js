"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MouseEngine = void 0;
class MouseEngine {
    // ─── Jitter config per profile ────────────────────────────────────────────
    static jitterConfig = {
        'steady': { tremor: 0.02, hesitation: 0.005, overshoot: 0.3 },
        'slight-tremor': { tremor: 0.08, hesitation: 0.02, overshoot: 0.5 },
        'elderly': { tremor: 0.15, hesitation: 0.08, overshoot: 0.7 },
        'gaming-mouse': { tremor: 0.01, hesitation: 0.001, overshoot: 0.15 },
    };
    // ─── Gaussian distribution ────────────────────────────────────────────────
    static gaussian(mean, sd) {
        let u = 0, v = 0;
        while (u === 0)
            u = Math.random();
        while (v === 0)
            v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sd + mean;
    }
    // ─── Gravity-Assisted Bezier with momentum ────────────────────────────────
    static buildPath(start, end) {
        const dist = Math.hypot(end.x - start.x, end.y - start.y);
        const steps = Math.max(20, Math.floor(dist / 8) + Math.floor(Math.random() * 10));
        const gravity = 0.3; // downward pull mid-arc
        const mid = {
            x: (start.x + end.x) / 2 + (Math.random() * 80 - 40),
            y: (start.y + end.y) / 2 + (Math.random() * 60 - 30) + dist * gravity * 0.2,
        };
        const cp1 = { x: start.x + (mid.x - start.x) * 0.5 + (Math.random() * 60 - 30), y: mid.y - Math.random() * 40 };
        const cp2 = { x: end.x - (end.x - mid.x) * 0.5 + (Math.random() * 60 - 30), y: mid.y + Math.random() * 40 };
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const mt = 1 - t;
            pts.push({
                x: mt ** 3 * start.x + 3 * mt ** 2 * t * cp1.x + 3 * mt * t ** 2 * cp2.x + t ** 3 * end.x,
                y: mt ** 3 * start.y + 3 * mt ** 2 * t * cp1.y + 3 * mt * t ** 2 * cp2.y + t ** 3 * end.y,
            });
        }
        return pts;
    }
    // ─── Saccade movement (eye-tracking style) ────────────────────────────────
    static buildSaccadePath(start, end) {
        // Fast jump to ~80% of target, then slow fixation correction
        const jump = { x: start.x + (end.x - start.x) * 0.82, y: start.y + (end.y - start.y) * 0.82 };
        const jumpPts = [];
        for (let i = 0; i <= 6; i++) {
            const t = i / 6;
            jumpPts.push({ x: start.x + (jump.x - start.x) * t, y: start.y + (jump.y - start.y) * t });
        }
        const fixPts = [];
        for (let i = 0; i <= 12; i++) {
            const t = i / 12;
            fixPts.push({ x: jump.x + (end.x - jump.x) * t, y: jump.y + (end.y - jump.y) * t });
        }
        return [...jumpPts, ...fixPts];
    }
    // ─── Main move ────────────────────────────────────────────────────────────
    static async move(page, x0, y0, x1, y1, profile) {
        const jp = profile?.jitterProfile ?? 'slight-tremor';
        const cfg = this.jitterConfig[jp];
        const dist = Math.hypot(x1 - x0, y1 - y0);
        // Use saccade for long distances (>400px), bezier otherwise
        const pts = dist > 400 ? this.buildSaccadePath({ x: x0, y: y0 }, { x: x1, y: y1 })
            : this.buildPath({ x: x0, y: y0 }, { x: x1, y: y1 });
        for (const pt of pts) {
            // Hand tremor
            const jx = Math.random() < cfg.tremor ? pt.x + this.gaussian(0, 1.2) : pt.x;
            const jy = Math.random() < cfg.tremor ? pt.y + this.gaussian(0, 1.2) : pt.y;
            await page.mouse.move(jx, jy);
            // Cognitive hesitation
            if (Math.random() < cfg.hesitation) {
                await new Promise(r => setTimeout(r, this.gaussian(120, 40)));
            }
            await new Promise(r => setTimeout(r, Math.random() * 5 + 2));
        }
        // Momentum drift — slight overshoot then correct
        if (Math.random() < cfg.overshoot) {
            const dir = Math.atan2(y1 - y0, x1 - x0);
            const drift = this.gaussian(4, 2);
            await page.mouse.move(x1 + Math.cos(dir) * drift, y1 + Math.sin(dir) * drift);
            await new Promise(r => setTimeout(r, this.gaussian(40, 15)));
            await page.mouse.move(x1, y1);
        }
        return { x: x1, y: y1 };
    }
    // ─── Hover without clicking ───────────────────────────────────────────────
    static async hoverRandom(page, pos) {
        const vp = page.viewportSize() ?? { width: 1366, height: 768 };
        const tx = 100 + Math.random() * (vp.width - 200);
        const ty = 100 + Math.random() * (vp.height - 200);
        const newPos = await this.move(page, pos.x, pos.y, tx, ty);
        await new Promise(r => setTimeout(r, Math.random() * 600 + 200));
        return newPos;
    }
    // ─── Context-Aware Move — slow near elements ──────────────────────────────
    static async moveToElement(page, selector, pos, profile) {
        const el = await page.$(selector);
        if (!el)
            throw new Error(`Element not found: ${selector}`);
        const box = await el.boundingBox();
        if (!box)
            throw new Error(`Element not visible: ${selector}`);
        const tx = this.gaussian(box.x + box.width / 2, (box.width - 4) / 4);
        const ty = this.gaussian(box.y + box.height / 2, (box.height - 4) / 4);
        const cx = Math.max(box.x + 2, Math.min(box.x + box.width - 2, tx));
        const cy = Math.max(box.y + 2, Math.min(box.y + box.height - 2, ty));
        const newPos = await this.move(page, pos.x, pos.y, cx, cy, profile);
        await new Promise(r => setTimeout(r, this.gaussian(70, 25)));
        await page.mouse.down();
        await new Promise(r => setTimeout(r, this.gaussian(80, 25)));
        await page.mouse.up();
        return newPos;
    }
    // ─── humanClickElement (legacy compat) ───────────────────────────────────
    static async humanClickElement(page, selector, pos, profile) {
        return this.moveToElement(page, selector, pos, profile);
    }
    // ─── Attention Heatmap — drift toward content anchors ────────────────────
    static async attentionDrift(page, pos, profile) {
        // Find headings/images that attract attention
        const anchors = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('h2, h3, h4, strong, img, figure'))
                .map(el => {
                const r = el.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            })
                .filter(p => p.y > 50 && p.y < window.innerHeight - 50 && p.x > 0)
                .slice(0, 5);
        }).catch(() => []);
        if (anchors.length === 0)
            return pos;
        const target = anchors[Math.floor(Math.random() * anchors.length)];
        const newPos = await this.move(page, pos.x, pos.y, target.x, target.y, profile);
        await new Promise(r => setTimeout(r, Math.random() * 1000 + 400));
        return newPos;
    }
}
exports.MouseEngine = MouseEngine;
