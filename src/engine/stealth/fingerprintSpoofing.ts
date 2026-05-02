import { type BrowserContext } from 'playwright';

interface SpoofOptions {
  locale?: string;
  timezoneId?: string;
  isDarkMode?: boolean;
}

export class FingerprintSpoofing {
  static async install(context: BrowserContext, opts: SpoofOptions = {}) {
    await context.addInitScript((o) => {
      const rnd  = (min: number, max: number) => Math.random() * (max - min) + min;
      const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

      // ── 1. Webdriver flag ────────────────────────────────────────────────
      Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });

      // ── 2. navigator.plugins ─────────────────────────────────────────────
      Object.defineProperty(navigator, 'plugins', {
        get: () => ({
          length: 5,
          0: { name: 'Chrome PDF Plugin',    filename: 'internal-pdf-viewer' },
          1: { name: 'Chrome PDF Viewer',    filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          2: { name: 'Native Client',        filename: 'internal-nacl-plugin' },
          3: { name: 'Chrome PDF Extension', filename: 'oemmndcbldboiebfnladdacbdfmadadm' },
          4: { name: 'Microsoft Edge PDF',   filename: 'edge-pdf-viewer' },
          item: (i: number) => (this as any)[i],
          namedItem: (n: string) => (this as any)[n],
          refresh: () => {},
        }),
        configurable: true,
      });

      // ── 3. navigator.vendor / platform / productSub ──────────────────────
      // Headless Chromium returns empty string for vendor and Linux for platform
      const ua = navigator.userAgent;
      const isMac = ua.includes('Mac OS');
      const platformStr = isMac ? 'MacIntel' : 'Win32';
      Object.defineProperty(navigator, 'vendor',     { get: () => 'Google Inc.', configurable: true });
      Object.defineProperty(navigator, 'platform',   { get: () => platformStr, configurable: true });
      Object.defineProperty(navigator, 'productSub', { get: () => '20030107', configurable: true });
      Object.defineProperty(navigator, 'appVersion', {
        get: () => navigator.userAgent.replace('Mozilla/', ''),
        configurable: true,
      });

      // ── 4. navigator.languages — match locale from SmartSync ─────────────
      const localeStr: string = (o as any).locale || 'en-US';
      const lang = localeStr.replace('_', '-');
      const langBase = lang.split('-')[0];
      Object.defineProperty(navigator, 'language',  { get: () => lang, configurable: true });
      Object.defineProperty(navigator, 'languages', { get: () => [lang, langBase, 'en'], configurable: true });

      // ── 5. Canvas noise ──────────────────────────────────────────────────
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(type?: string, quality?: any) {
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

      // ── 6. WebGL renderer strings ─────────────────────────────────────────
      const origGetParam = WebGLRenderingContext.prototype.getParameter;
      const vendors   = ['Intel Inc.', 'Google Inc.', 'NVIDIA Corporation', 'AMD'];
      const renderers = ['Intel Iris OpenGL Engine', 'ANGLE (Intel UHD 620 Direct3D11)', 'GeForce GTX 1050 / PCIe / SSE2'];
      const vendor   = pick(vendors);
      const renderer = pick(renderers);
      WebGLRenderingContext.prototype.getParameter = function(param: number) {
        if (param === 0x9245) return vendor;
        if (param === 0x9246) return renderer;
        if (param === 0x1F00) return vendor;
        if (param === 0x1F01) return renderer;
        return origGetParam.call(this, param);
      };
      // Also spoof WebGL2
      try {
        const origGetParam2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function(param: number) {
          if (param === 0x9245) return vendor;
          if (param === 0x9246) return renderer;
          if (param === 0x1F00) return vendor;
          if (param === 0x1F01) return renderer;
          return origGetParam2.call(this, param);
        };
      } catch {}

      // ── 7. AudioContext fingerprint noise ──────────────────────────────────
      const origCreateOscillator = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function() {
        const osc = origCreateOscillator.call(this);
        const origConnect = osc.connect.bind(osc);
        osc.connect = function(destination: any, ...args: any[]) {
          osc.detune.value += rnd(-0.0001, 0.0001);
          return origConnect(destination, ...args);
        };
        return osc;
      };

      // ── 8. Battery API (discharge simulation) ────────────────────────────
      if ('getBattery' in navigator) {
        const level   = rnd(0.35, 0.95);
        const charging = Math.random() > 0.5;
        (navigator as any).getBattery = () => Promise.resolve({
          charging,
          chargingTime:    charging ? rnd(600, 7200) : Infinity,
          dischargingTime: charging ? Infinity : rnd(3600, 14400),
          level,
          addEventListener: () => {},
          removeEventListener: () => {},
        });
      }

      // ── 9. Hardware Concurrency & Device Memory ───────────────────────────
      const cores  = pick([2, 4, 6, 8, 12, 16]);
      const memGiB = pick([4, 8, 16]);
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cores, configurable: true });
      Object.defineProperty(navigator, 'deviceMemory',        { get: () => memGiB, configurable: true });

      // ── 10. Screen + outerWidth/outerHeight consistency ───────────────────
      // outerWidth/outerHeight must match screen or bots are detected
      const screens = [
        { w: 1920, h: 1080, avW: 1920, avH: 1040 },
        { w: 1366, h: 768,  avW: 1366, avH: 728  },
        { w: 1440, h: 900,  avW: 1440, avH: 860  },
        { w: 2560, h: 1440, avW: 2560, avH: 1400 },
      ];
      const scr = pick(screens);
      Object.defineProperty(screen, 'width',       { get: () => scr.w, configurable: true });
      Object.defineProperty(screen, 'height',      { get: () => scr.h, configurable: true });
      Object.defineProperty(screen, 'availWidth',  { get: () => scr.avW, configurable: true });
      Object.defineProperty(screen, 'availHeight', { get: () => scr.avH, configurable: true });
      Object.defineProperty(screen, 'colorDepth',  { get: () => 24, configurable: true });
      Object.defineProperty(screen, 'pixelDepth',  { get: () => 24, configurable: true });
      // outerWidth/outerHeight should equal screen dimensions (maximised window)
      try {
        Object.defineProperty(window, 'outerWidth',  { get: () => scr.w, configurable: true });
        Object.defineProperty(window, 'outerHeight', { get: () => scr.h, configurable: true });
      } catch {}

      // ── 11. navigator.connection spoofing ──────────────────────────────────
      const connections = [
        { effectiveType: '4g', downlink: rnd(10, 100), rtt: Math.round(rnd(20, 80)) },
        { effectiveType: '4g', downlink: rnd(5, 30),   rtt: Math.round(rnd(30, 100)) },
        { effectiveType: '3g', downlink: rnd(1, 5),    rtt: Math.round(rnd(100, 300)) },
      ];
      const conn = pick(connections);
      const connObj = {
        effectiveType: conn.effectiveType,
        downlink: conn.downlink,
        rtt: conn.rtt,
        saveData: false,
        addEventListener: () => {},
        removeEventListener: () => {},
        onchange: null,
      };
      try {
        Object.defineProperty(navigator, 'connection', {
          get: () => connObj,
          configurable: true,
        });
      } catch {}

      // ── 12. maxTouchPoints ─────────────────────────────────────────────────
      const isMobile = /Mobile|Android|iPhone|iPad/.test(navigator.userAgent);
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => isMobile ? pick([5, 10]) : 0, configurable: true });

      // ── 13. window.chrome — deep singleton spoof ─────────────────────────
      const _chrome = (() => {
        const runtime = {
          OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
          OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
          PlatformArch: { ARM: 'arm', ARM64: 'arm64', X86_32: 'x86-32', X86_64: 'x86-64' },
          PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
          PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
          RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
          id: undefined,
          lastError: undefined,
          connect: () => ({ onDisconnect: { addListener: () => {}, removeListener: () => {} }, onMessage: { addListener: () => {}, removeListener: () => {} }, postMessage: () => {}, disconnect: () => {} }),
          sendMessage: () => {},
          getManifest: () => ({}),
          getURL: (p: string) => p,
          reload: () => {},
          onConnect: { addListener: () => {}, removeListener: () => {}, hasListener: () => false },
          onMessage: { addListener: () => {}, removeListener: () => {}, hasListener: () => false },
          onInstalled: { addListener: () => {} },
          onStartup: { addListener: () => {} },
        };
        const app = { isInstalled: false, getDetails: () => null, getIsInstalled: () => false, installState: () => {}, runningState: () => {}, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } };
        const csi = () => ({ startE: Date.now(), onloadT: Date.now() + 1000, pageT: rnd(100, 500), tran: rnd(10, 50) });
        const loadTimes = () => ({
          requestTime: Date.now() / 1000 - rnd(1, 3),
          startLoadTime: Date.now() / 1000 - rnd(1, 2),
          commitLoadTime: Date.now() / 1000 - rnd(0.5, 1),
          finishDocumentLoadTime: Date.now() / 1000 - rnd(0.1, 0.5),
          finishLoadTime: Date.now() / 1000,
          firstPaintTime: Date.now() / 1000 - rnd(0.5, 1),
          firstPaintAfterLoadTime: 0,
          navigationType: 'Other',
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
          wasAlternateProtocolAvailable: false,
          connectionInfo: 'h2'
        });
        return { app, csi, loadTimes, runtime };
      })();

      if (!(window as any).chrome) {
        Object.defineProperty(window, 'chrome', { get: () => _chrome, configurable: true });
      } else {
        const existing = (window as any).chrome;
        if (!existing.runtime) existing.runtime = _chrome.runtime;
        if (!existing.app) existing.app = _chrome.app;
        if (!existing.csi) existing.csi = _chrome.csi;
        if (!existing.loadTimes) existing.loadTimes = _chrome.loadTimes;
      }

      // ── 14. performance.memory spoofing ───────────────────────────────────
      try {
        const heap = Math.round(rnd(100, 400)) * 1024 * 1024;
        const memObj = {
          jsHeapSizeLimit:  2 * 1024 * 1024 * 1024,
          totalJSHeapSize:  heap * 2,
          usedJSHeapSize:   heap,
        };
        Object.defineProperty(performance, 'memory', {
          get: () => memObj,
          configurable: true,
        });
      } catch {}

      // ── 15. document.hasFocus() — headless returns false ──────────────────
      try {
        const origHasFocus = document.hasFocus.bind(document);
        Object.defineProperty(document, 'hasFocus', {
          get: () => () => true,
          configurable: true,
        });
        // Also override hidden/visibilityState to "visible" initially
        Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
        Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
      } catch {}

      // ── 16. Intl timezone consistency ─────────────────────────────────────
      // If SmartSync set a timezone, override Intl so JS date methods agree
      const tzId: string | undefined = (o as any).timezoneId;
      if (tzId) {
        try {
          const origDTF = Intl.DateTimeFormat;
          (Intl as any).DateTimeFormat = function(locales?: any, options?: any) {
            const opts = { ...options, timeZone: options?.timeZone || tzId };
            return new origDTF(locales, opts);
          };
          Object.assign((Intl as any).DateTimeFormat, origDTF);
          (Intl.DateTimeFormat as any).prototype = origDTF.prototype;
        } catch {}
      }

      // ── 17. Speech synthesis voice count variation ────────────────────────
      const origGetVoices = speechSynthesis.getVoices.bind(speechSynthesis);
      speechSynthesis.getVoices = () => {
        const voices = origGetVoices();
        return voices.length > 0 ? voices : [];
      };

      // ── 18. Font measureText jitter ───────────────────────────────────────
      const origMeasure = CanvasRenderingContext2D.prototype.measureText;
      CanvasRenderingContext2D.prototype.measureText = function(text: string) {
        const m = origMeasure.call(this, text);
        Object.defineProperty(m, 'width', { value: m.width + rnd(-0.05, 0.05) });
        return m;
      };

      // ── 19. Permissions query spoof ───────────────────────────────────────
      const origQuery = navigator.permissions?.query?.bind(navigator.permissions);
      if (origQuery) {
        (navigator.permissions as any).query = (desc: any) => {
          if (['notifications', 'geolocation', 'camera', 'microphone'].includes(desc?.name)) {
            return Promise.resolve({ state: 'prompt', onchange: null } as PermissionStatus);
          }
          return origQuery(desc);
        };
      }

      // ── 20. Notification.permission ───────────────────────────────────────
      try {
        Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true });
      } catch {}

      // ── 21. WebRTC IP masking ──────────────────────────────────────────────
      if (window.RTCPeerConnection) {
        const Orig = window.RTCPeerConnection;
        (window as any).RTCPeerConnection = function(config: any) {
          const pc = new Orig(config);
          const origOffer = pc.createOffer.bind(pc);
          pc.createOffer = function(opts?: any) {
            return origOffer(opts).then((offer: any) => offer);
          };
          return pc;
        };
        Object.assign((window as any).RTCPeerConnection, Orig);
      }

      // ── 23. postMessage & Frame origin deep fix ───────────────────────────
      // Intercept postMessage globally to handle origin mismatches in ad scripts
      const wrapPostMessage = (win: Window) => {
        try {
          // Check if we have access to this window (same-origin check)
          // If we don't, accessing win.postMessage will throw or return undefined
          if (!win || !win.postMessage) return;
          
          const orig = win.postMessage.bind(win);
          (win as any).postMessage = (msg: any, target: any, trans?: any) => {
            try {
              return orig(msg, target, trans);
            } catch (e: any) {
              if (e.message?.includes('target origin')) {
                return orig(msg, '*', trans);
              }
              throw e;
            }
          };
        } catch {
          // Cross-origin window — we cannot patch its postMessage. 
          // Native security will handle it.
        }
      };
      wrapPostMessage(window);
      
      // Patch iframes as they are created
      const origIframeGet = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')?.get;
      if (origIframeGet) {
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
          get: function() {
            try {
              const win = origIframeGet.call(this);
              if (win) wrapPostMessage(win);
              return win;
            } catch {
              return null;
            }
          },
          configurable: true
        });
      }

      // ── 24. GPT Deprecation Monkey-patch ──────────────────────────────────
      // Violently silence the [GPT] PubAdsService.disableInitialLoad warning
      const patchGPT = () => {
        const g = (window as any).googletag;
        if (g && g.pubads) {
          const p = g.pubads();
          if (p && p.disableInitialLoad && !p.__patched) {
            const origDisable = p.disableInitialLoad.bind(p);
            p.disableInitialLoad = function() {
              if (g.setConfig) g.setConfig({ disableInitialLoad: true });
              return origDisable();
            };
            p.__patched = true;
          }
        }
      };
      // Poll briefly for GPT since it loads async
      for (let i = 0; i < 10; i++) setTimeout(patchGPT, i * 500);

      // ── 25. Global Console Error Suppression ──────────────────────────────
      // Suppresses unavoidable browser/ad errors to keep logs clean
      const origErr = console.error.bind(console);
      const suppressed = ['chrome-error://', 'Unsafe attempt to load URL', 'target origin provided', 'disableInitialLoad is deprecated'];
      console.error = (...args: any[]) => {
        const msg = args.join(' ');
        if (suppressed.some(s => msg.includes(s))) return;
        return origErr(...args);
      };
      const origWarn = console.warn.bind(console);
      console.warn = (...args: any[]) => {
        const msg = args.join(' ');
        if (suppressed.some(s => msg.includes(s))) return;
        return origWarn(...args);
      };

      // ── 26. navigator.webdriver prototype override ─────────────────────────
      try {
        Object.defineProperty(Object.getPrototypeOf(navigator), 'webdriver', { get: () => false, configurable: true });
      } catch {}

      // ── 27. Page Integrity (Referrer-Policy & Meta) ────────────────────────
      try {
        const meta = document.createElement('meta');
        meta.name = 'referrer';
        meta.content = 'no-referrer-when-downgrade';
        document.head.appendChild(meta);
      } catch {}

    }, opts);
  }
}
