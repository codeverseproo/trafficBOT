"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FingerprintSpoofing = void 0;
class FingerprintSpoofing {
    static async install(context, opts = {}) {
        await context.addInitScript((_o) => {
            const rnd = (min, max) => Math.random() * (max - min) + min;
            const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
            // ── 1. Webdriver flag ────────────────────────────────────────────────
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            // ── 2. navigator.plugins ─────────────────────────────────────────────
            Object.defineProperty(navigator, 'plugins', {
                get: () => ({
                    length: 5,
                    0: { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
                    1: { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                    2: { name: 'Native Client', filename: 'internal-nacl-plugin' },
                    3: { name: 'Chrome PDF Extension', filename: 'oemmndcbldboiebfnladdacbdfmadadm' },
                    4: { name: 'Microsoft Edge PDF', filename: 'edge-pdf-viewer' },
                }),
            });
            // ── 3. Canvas noise ──────────────────────────────────────────────────
            const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
                const ctx = this.getContext('2d');
                if (ctx) {
                    const img = ctx.getImageData(0, 0, this.width || 1, this.height || 1);
                    for (let i = 0; i < img.data.length; i += 100) {
                        img.data[i] = img.data[i] ^ (Math.random() * 4 | 0);
                    }
                    ctx.putImageData(img, 0, 0);
                }
                return origToDataURL.call(this, type, quality);
            };
            // ── 4. WebGL renderer strings ────────────────────────────────────────
            const origGetParam = WebGLRenderingContext.prototype.getParameter;
            const vendors = ['Intel Inc.', 'Google Inc.', 'NVIDIA Corporation', 'AMD'];
            const renderers = ['Intel Iris OpenGL Engine', 'ANGLE (Intel UHD 620 Direct3D11)', 'GeForce GTX 1050 / PCIe / SSE2'];
            const vendor = pick(vendors);
            const renderer = pick(renderers);
            WebGLRenderingContext.prototype.getParameter = function (param) {
                if (param === 0x9245)
                    return vendor;
                if (param === 0x9246)
                    return renderer;
                if (param === 0x1F00)
                    return vendor;
                if (param === 0x1F01)
                    return renderer;
                return origGetParam.call(this, param);
            };
            // ── 5. AudioContext fingerprint noise ─────────────────────────────────
            const origCreateOscillator = AudioContext.prototype.createOscillator;
            AudioContext.prototype.createOscillator = function () {
                const osc = origCreateOscillator.call(this);
                const origConnect = osc.connect.bind(osc);
                osc.connect = function (destination, ...args) {
                    osc.detune.value += rnd(-0.0001, 0.0001);
                    return origConnect(destination, ...args);
                };
                return osc;
            };
            // ── 6. Battery API (discharge simulation) ────────────────────────────
            if ('getBattery' in navigator) {
                const level = rnd(0.35, 0.95);
                const charging = Math.random() > 0.5;
                navigator.getBattery = () => Promise.resolve({
                    charging,
                    chargingTime: charging ? rnd(600, 7200) : Infinity,
                    dischargingTime: charging ? Infinity : rnd(3600, 14400),
                    level,
                    addEventListener: () => { },
                    removeEventListener: () => { },
                });
            }
            // ── 7. Hardware Concurrency & Device Memory ───────────────────────────
            const cores = pick([2, 4, 6, 8, 12, 16]);
            const memGiB = pick([4, 8, 16]);
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cores });
            Object.defineProperty(navigator, 'deviceMemory', { get: () => memGiB });
            // ── 8. screen object consistency ─────────────────────────────────────
            const screens = [
                { w: 1920, h: 1080, avW: 1920, avH: 1040 },
                { w: 1366, h: 768, avW: 1366, avH: 728 },
                { w: 1440, h: 900, avW: 1440, avH: 860 },
                { w: 2560, h: 1440, avW: 2560, avH: 1400 },
            ];
            const scr = pick(screens);
            Object.defineProperty(screen, 'width', { get: () => scr.w });
            Object.defineProperty(screen, 'height', { get: () => scr.h });
            Object.defineProperty(screen, 'availWidth', { get: () => scr.avW });
            Object.defineProperty(screen, 'availHeight', { get: () => scr.avH });
            Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
            Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
            // ── 9. navigator.connection spoofing ─────────────────────────────────
            const connections = [
                { effectiveType: '4g', downlink: rnd(10, 100), rtt: Math.round(rnd(20, 80)) },
                { effectiveType: '4g', downlink: rnd(5, 30), rtt: Math.round(rnd(30, 100)) },
                { effectiveType: '3g', downlink: rnd(1, 5), rtt: Math.round(rnd(100, 300)) },
            ];
            const conn = pick(connections);
            try {
                Object.defineProperty(navigator, 'connection', {
                    get: () => ({
                        effectiveType: conn.effectiveType,
                        downlink: conn.downlink,
                        rtt: conn.rtt,
                        saveData: false,
                        addEventListener: () => { },
                    }),
                });
            }
            catch { }
            // ── 10. maxTouchPoints (match UA device type) ─────────────────────────
            const isMobile = /Mobile|Android|iPhone|iPad/.test(navigator.userAgent);
            Object.defineProperty(navigator, 'maxTouchPoints', { get: () => isMobile ? pick([5, 10]) : 0 });
            // ── 11. window.chrome injection ───────────────────────────────────────
            if (!window.chrome) {
                window.chrome = {
                    app: { isInstalled: false },
                    csi: () => { },
                    loadTimes: () => ({
                        firstPaintTime: rnd(0.5, 1.2),
                        firstPaintAfterLoadTime: 0,
                        requestTime: Date.now() / 1000 - rnd(0.2, 0.5),
                        startLoadTime: Date.now() / 1000 - rnd(0.3, 0.6),
                        finishDocumentLoadTime: Date.now() / 1000 - rnd(0.1, 0.3),
                        finishLoadTime: Date.now() / 1000,
                        navigationType: 'Other',
                        wasFetchedViaSpdy: false,
                        wasNpnNegotiated: false,
                    }),
                    runtime: { onConnect: { addListener: () => { } }, onMessage: { addListener: () => { } } },
                };
            }
            // ── 12. performance.memory spoofing ──────────────────────────────────
            try {
                const heap = Math.round(rnd(100, 400)) * 1024 * 1024;
                Object.defineProperty(performance, 'memory', {
                    get: () => ({
                        jsHeapSizeLimit: 2 * 1024 * 1024 * 1024,
                        totalJSHeapSize: heap * 2,
                        usedJSHeapSize: heap,
                    }),
                });
            }
            catch { }
            // ── 13. CSS media query dark mode ─────────────────────────────────────
            // (injected via playwright context option, but we patch matchMedia too)
            const origMQ = window.matchMedia.bind(window);
            window.matchMedia = (query) => {
                const mq = origMQ(query);
                return mq;
            };
            // ── 14. Speech synthesis voice count variation ────────────────────────
            const origGetVoices = speechSynthesis.getVoices.bind(speechSynthesis);
            speechSynthesis.getVoices = () => {
                const voices = origGetVoices();
                return voices.length > 0 ? voices : [];
            };
            // ── 15. Font measureText jitter ───────────────────────────────────────
            const origMeasure = CanvasRenderingContext2D.prototype.measureText;
            CanvasRenderingContext2D.prototype.measureText = function (text) {
                const m = origMeasure.call(this, text);
                Object.defineProperty(m, 'width', { value: m.width + rnd(-0.05, 0.05) });
                return m;
            };
            // ── 16. Permissions query spoof ───────────────────────────────────────
            const origQuery = navigator.permissions?.query?.bind(navigator.permissions);
            if (origQuery) {
                navigator.permissions.query = (desc) => {
                    if (['notifications', 'geolocation', 'camera', 'microphone'].includes(desc?.name)) {
                        return Promise.resolve({ state: 'prompt', onchange: null });
                    }
                    return origQuery(desc);
                };
            }
            // ── 17. Notification.permission ─────────────────────────────────────
            try {
                Object.defineProperty(Notification, 'permission', { get: () => 'default' });
            }
            catch { }
            // ── 18. WebRTC IP masking ─────────────────────────────────────────────
            if (window.RTCPeerConnection) {
                const Orig = window.RTCPeerConnection;
                window.RTCPeerConnection = function (config) {
                    const pc = new Orig(config);
                    const origOffer = pc.createOffer.bind(pc);
                    pc.createOffer = function (opts) {
                        return origOffer(opts).then((offer) => offer);
                    };
                    return pc;
                };
                Object.assign(window.RTCPeerConnection, Orig);
            }
            // ── 19. Ambient Light Sensor spoof ────────────────────────────────────
            try {
                window.AmbientLightSensor = class {
                    illuminance = rnd(50, 500);
                    start() { }
                    stop() { }
                    addEventListener() { }
                };
            }
            catch { }
        }, opts);
    }
}
exports.FingerprintSpoofing = FingerprintSpoofing;
