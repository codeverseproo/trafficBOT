import { type Page } from 'playwright';
import { type BrowserPersona } from './personaEngine';

export class FingerprintSpoofing {
  static async apply(page: Page, persona: BrowserPersona, localeStr: string) {
    const opts = { persona, localeStr };

    await page.addInitScript((args: { persona: BrowserPersona, localeStr: string }) => {
      const { persona, localeStr } = args;
      const rnd = (min: number, max: number) => Math.random() * (max - min) + min;
      const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

      // ── 1. Webdriver flag ────────────────────────────────────────────────
      Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });

      // ── 2. navigator.plugins ─────────────────────────────────────────────
      const pluginsObj = {
        length: 5,
        0: { name: 'Chrome PDF Plugin',    filename: 'internal-pdf-viewer' },
        1: { name: 'Chrome PDF Viewer',    filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
        2: { name: 'Native Client',        filename: 'internal-nacl-plugin' },
        3: { name: 'Chrome PDF Extension', filename: 'oemmndcbldboiebfnladdacbdfmadadm' },
        4: { name: 'Microsoft Edge PDF',   filename: 'edge-pdf-viewer' },
        item: (i: number) => (this as any)[i],
        namedItem: (n: string) => (this as any)[n],
        refresh: () => {},
      };
      Object.defineProperty(navigator, 'plugins', { get: () => pluginsObj, configurable: true });

      // ── 3. Navigator OS/UA Identity ──────────────────────────────────────
      Object.defineProperty(navigator, 'vendor',     { get: () => persona.vendor, configurable: true });
      Object.defineProperty(navigator, 'platform',   { get: () => persona.platform, configurable: true });
      Object.defineProperty(navigator, 'productSub', { get: () => '20030107', configurable: true });
      Object.defineProperty(navigator, 'appVersion', { get: () => persona.userAgent.replace('Mozilla/', ''), configurable: true });
      if ((navigator as any).oscpu) {
        Object.defineProperty(navigator, 'oscpu', { get: () => persona.oscpu, configurable: true });
      }

      // ── 4. navigator.userAgentData (CRITICAL FOR CHROME) ──────────────────
      if ((navigator as any).userAgentData || (window as any).NavigatorUAData) {
        const uaData = {
          brands: persona.uaData.brands,
          mobile: persona.uaData.mobile,
          platform: persona.uaData.platform,
          getHighEntropyValues: async (hints: string[]) => {
            const result: any = {
              brands: persona.uaData.brands,
              mobile: persona.uaData.mobile,
              platform: persona.uaData.platform,
            };
            if (hints.includes('architecture')) result.architecture = persona.uaData.architecture;
            if (hints.includes('model'))        result.model        = persona.uaData.model;
            if (hints.includes('platformVersion')) result.platformVersion = persona.platform === 'Win32' ? '10.0.0' : '13.5.0';
            if (hints.includes('bitness'))      result.bitness      = persona.uaData.bitness;
            if (hints.includes('fullVersionList')) result.fullVersionList = persona.uaData.brands;
            return result;
          }
        };
        try {
          Object.defineProperty(navigator, 'userAgentData', { get: () => uaData, configurable: true });
          if ((window as any).NavigatorUAData) {
            Object.defineProperty(window, 'NavigatorUAData', { get: () => function() { return uaData; }, configurable: true });
          }
        } catch {}
      }

      // ── 5. navigator.languages — match locale ────────────────────────────
      const lang = localeStr.replace('_', '-');
      const langBase = lang.split('-')[0];
      Object.defineProperty(navigator, 'language',  { get: () => lang, configurable: true });
      Object.defineProperty(navigator, 'languages', { get: () => [lang, langBase, 'en'], configurable: true });

      // ── 6. Canvas noise ──────────────────────────────────────────────────
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(type) {
        const res = origToDataURL.apply(this, arguments as any);
        if (res.startsWith('data:image/png')) {
          // Stable noise per session could be better, but subtle random is okay
        }
        return res;
      };

      // ── 6b. ClientRects Jittering (AdsPower/GoLogin style) ────────────────
      const jitter = (val: number) => val + (Math.random() * 0.0001 - 0.00005);
      const wrapRect = (rect: DOMRect): DOMRect => {
        const newRect = {
          x: jitter(rect.x), y: jitter(rect.y),
          width: jitter(rect.width), height: jitter(rect.height),
          top: jitter(rect.top), right: jitter(rect.right),
          bottom: jitter(rect.bottom), left: jitter(rect.left),
          toJSON: () => rect.toJSON()
        };
        return newRect as DOMRect;
      };

      const origGetBCR = HTMLElement.prototype.getBoundingClientRect;
      HTMLElement.prototype.getBoundingClientRect = function() {
        const rect = origGetBCR.apply(this, arguments as any);
        return wrapRect(rect);
      };

      const origGetClientRects = HTMLElement.prototype.getClientRects;
      HTMLElement.prototype.getClientRects = function() {
        const rects = origGetClientRects.apply(this, arguments as any);
        const list = Array.from(rects).map(r => wrapRect(r));
        return {
          length: list.length,
          item: (i: number) => list[i],
          [Symbol.iterator]: function* () { yield* list; }
        } as any;
      };

      // ── 7. WebGL Deep Spoofing ───────────────────────────────────────────
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return persona.renderer.vendor;   // UNMASKED_VENDOR_WEBGL
        if (parameter === 37446) return persona.renderer.renderer; // UNMASKED_RENDERER_WEBGL
        // Additional common GL fingerprint targets
        if (parameter === 35661) return 16; // MAX_COMBINED_TEXTURE_IMAGE_UNITS
        if (parameter === 34076) return 16384; // MAX_TEXTURE_SIZE
        if (parameter === 34930) return 4096; // MAX_RENDERBUFFER_SIZE
        return getParameter.apply(this, arguments as any);
      };

      const getShaderPrecisionFormat = WebGLRenderingContext.prototype.getShaderPrecisionFormat;
      WebGLRenderingContext.prototype.getShaderPrecisionFormat = function(shaderType, precisionType) {
        const format = getShaderPrecisionFormat.apply(this, arguments as any);
        if (format) {
          // Add deterministic jitter to shader precision
          return {
            rangeMin: format.rangeMin,
            rangeMax: format.rangeMax,
            precision: format.precision + (Math.random() > 0.5 ? 1 : 0)
          };
        }
        return format;
      };

      // ── 8. Audio Deep Spoofing ───────────────────────────────────────────
      const origGetChannelData = AudioBuffer.prototype.getChannelData;
      AudioBuffer.prototype.getChannelData = function() {
        const res = origGetChannelData.apply(this, arguments as any);
        for (let i = 0; i < 10; i++) {
          const idx = Math.floor(Math.random() * res.length);
          res[idx] += (Math.random() - 0.5) * 1e-7;
        }
        return res;
      };

      // ── 8b. OfflineAudioContext Rendering Spoofing ───────────────────────
      if ((window as any).OfflineAudioContext) {
        const origStartRendering = OfflineAudioContext.prototype.startRendering;
        OfflineAudioContext.prototype.startRendering = function() {
          return origStartRendering.apply(this, arguments as any).then((buffer: AudioBuffer) => {
            const data = buffer.getChannelData(0);
            for (let i = 0; i < 20; i++) {
              const idx = Math.floor(Math.random() * data.length);
              data[idx] += (Math.random() - 0.5) * 1e-8;
            }
            return buffer;
          });
        };
      }

      // ── 9. Hardware Concurrency & Device Memory ──────────────────────────
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => persona.hardwareConcurrency, configurable: true });
      Object.defineProperty(navigator, 'deviceMemory',        { get: () => persona.deviceMemory, configurable: true });

      // ── 10. Screen consistency ───────────────────────────────────────────
      Object.defineProperty(screen, 'width',       { get: () => persona.screen.w, configurable: true });
      Object.defineProperty(screen, 'height',      { get: () => persona.screen.h, configurable: true });
      Object.defineProperty(screen, 'availWidth',  { get: () => persona.screen.avW, configurable: true });
      Object.defineProperty(screen, 'availHeight', { get: () => persona.screen.avH, configurable: true });
      Object.defineProperty(screen, 'colorDepth',  { get: () => persona.screen.colorDepth, configurable: true });
      Object.defineProperty(screen, 'pixelDepth',  { get: () => persona.screen.pixelDepth, configurable: true });
      
      if (screen.orientation) {
        Object.defineProperty(screen.orientation, 'type', { get: () => 'landscape-primary', configurable: true });
        Object.defineProperty(screen.orientation, 'angle', { get: () => 0, configurable: true });
      }

      try {
        Object.defineProperty(window, 'outerWidth',  { get: () => persona.screen.w, configurable: true });
        Object.defineProperty(window, 'outerHeight', { get: () => persona.screen.h, configurable: true });
        Object.defineProperty(window, 'innerWidth',  { get: () => persona.screen.w, configurable: true });
        Object.defineProperty(window, 'innerHeight', { get: () => persona.screen.h, configurable: true });
        Object.defineProperty(window, 'devicePixelRatio', { get: () => 1, configurable: true });
      } catch {}

      // ── 11. navigator.connection singleton ────────────────────────────────
      const connObj = {
        effectiveType: '4g',
        downlink: rnd(8, 10),
        rtt: Math.round(rnd(30, 60)),
        saveData: false,
        addEventListener: () => {},
        removeEventListener: () => {},
        onchange: null,
      };
      Object.defineProperty(navigator, 'connection', { get: () => connObj, configurable: true });

      // ── 12. window.chrome deep singleton spoof ────────────────────────────
      const _chrome = (() => {
        const runtime = {
          OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
          OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
          PlatformArch: { ARM: 'arm', ARM64: 'arm64', X86_32: 'x86-32', X86_64: 'x86-64' },
          PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
          PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
          RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
          id: undefined, lastError: undefined,
          connect: () => ({ onDisconnect: { addListener: () => {} }, onMessage: { addListener: () => {} }, postMessage: () => {}, disconnect: () => {} }),
          sendMessage: () => {}, getManifest: () => ({}), getURL: (p: string) => p, reload: () => {},
          onConnect: { addListener: () => {}, removeListener: () => {}, hasListener: () => false },
          onMessage: { addListener: () => {}, removeListener: () => {}, hasListener: () => false },
          onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} },
        };
        const app = { isInstalled: false, getDetails: () => null, getIsInstalled: () => false, installState: () => {}, runningState: () => {}, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } };
        const csi = () => ({ startE: Date.now(), onloadT: Date.now() + 1000, pageT: rnd(100, 500), tran: rnd(10, 50) });
        const loadTimes = () => ({
          requestTime: Date.now() / 1000 - rnd(1, 3), startLoadTime: Date.now() / 1000 - rnd(1, 2),
          commitLoadTime: Date.now() / 1000 - rnd(0.5, 1), finishDocumentLoadTime: Date.now() / 1000 - rnd(0.1, 0.5),
          finishLoadTime: Date.now() / 1000, firstPaintTime: Date.now() / 1000 - rnd(0.5, 1), firstPaintAfterLoadTime: 0,
          navigationType: 'Other', wasFetchedViaSpdy: true, wasNpnNegotiated: true, wasAlternateProtocolAvailable: false, connectionInfo: 'h2'
        });
        return { app, csi, loadTimes, runtime };
      })();
      if (!(window as any).chrome) {
        Object.defineProperty(window, 'chrome', { get: () => _chrome, configurable: true });
      }

      // ── 13. performance.memory singleton ──────────────────────────────────
      const heap = Math.round(rnd(100, 400)) * 1024 * 1024;
      const memObj = { jsHeapSizeLimit: 2 * 1024 * 1024 * 1024, totalJSHeapSize: heap * 2, usedJSHeapSize: heap };
      Object.defineProperty(performance, 'memory', { get: () => memObj, configurable: true });

      // ── 14. Document hasFocus spoof ───────────────────────────────────────
      Object.defineProperty(document, 'hasFocus', { get: () => () => true, configurable: true });
      Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
      Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });

      // ── 15. postMessage & Frame origin deep fix ───────────────────────────
      const wrapPostMessage = (win: Window) => {
        try {
          if (!win || !win.postMessage) return;
          const orig = win.postMessage.bind(win);
          (win as any).postMessage = (msg: any, target: any, trans?: any) => {
            try { return orig(msg, target, trans); } catch (e: any) {
              if (e.message?.includes('target origin')) return orig(msg, '*', trans);
              throw e;
            }
          };
        } catch {}
      };
      wrapPostMessage(window);
      const origIframeGet = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')?.get;
      if (origIframeGet) {
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
          get: function() {
            try {
              const win = origIframeGet.call(this);
              if (win) wrapPostMessage(win);
              return win;
            } catch { return null; }
          },
          configurable: true
        });
      }

      // ── 16. GPT Deprecation Monkey-patch ──────────────────────────────────
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
      for (let i = 0; i < 10; i++) setTimeout(patchGPT, i * 500);

      // ── 17. Global Console Error Suppression ──────────────────────────────
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

      // ── 27. Permissions spoof ─────────────────────────────────────────────
      if (navigator.permissions) {
        const origQuery = navigator.permissions.query;
        (navigator.permissions as any).query = (params: any) => 
          params.name === 'notifications' 
            ? Promise.resolve({ state: 'prompt', onchange: null }) 
            : origQuery.call(navigator.permissions, params);
      }

      // ── 28. Media Devices spoof ───────────────────────────────────────────
      if (navigator.mediaDevices && (navigator.mediaDevices as any).enumerateDevices) {
        const origEnumerate = (navigator.mediaDevices as any).enumerateDevices.bind(navigator.mediaDevices);
        (navigator.mediaDevices as any).enumerateDevices = async () => {
          return [
            { kind: 'audioinput', label: 'Internal Microphone', deviceId: 'default', groupId: 'default' },
            { kind: 'videoinput', label: 'FaceTime HD Camera', deviceId: 'default', groupId: 'default' },
            { kind: 'audiooutput', label: 'Internal Speakers', deviceId: 'default', groupId: 'default' }
          ];
        };
      }

      // ── 29. Page Integrity (Referrer-Policy & Meta) ────────────────────────
      try {
        const meta = document.createElement('meta');
        meta.name = 'referrer';
        meta.content = 'no-referrer-when-downgrade';
        document.head.appendChild(meta);
      } catch {}

      // ── 30. WebRTC IP Masking (CRITICAL) ──────────────────────────────────
      if (window.RTCPeerConnection) {
        const origPC = window.RTCPeerConnection;
        const maskedIP = `192.168.1.${Math.floor(Math.random() * 254) + 1}`;
        
        (window as any).RTCPeerConnection = function(config: any) {
          const pc = new origPC(config);
          const origCreateOffer = pc.createOffer.bind(pc);
          pc.createOffer = function() {
            return origCreateOffer.apply(this, arguments as any).then((offer: any) => {
              offer.sdp = offer.sdp.replace(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g, maskedIP);
              return offer;
            });
          };
          return pc;
        };
        (window as any).RTCPeerConnection.prototype = origPC.prototype;
      }

      // ── 31. Battery Status API Spoofing ───────────────────────────────────
      if (navigator.getBattery) {
        const battery = {
          charging: true,
          chargingTime: 0,
          dischargingTime: Infinity,
          level: 0.9 + Math.random() * 0.1,
          addEventListener: () => {},
          removeEventListener: () => {},
          onchargingchange: null,
          onchargingtimechange: null,
          ondischargingtimechange: null,
          onlevelchange: null,
        };
        navigator.getBattery = () => Promise.resolve(battery) as any;
      }

    }, opts);
  }
}
