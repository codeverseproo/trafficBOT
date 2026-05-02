export interface BrowserPersona {
  userAgent: string;
  platform: 'Win32' | 'MacIntel';
  oscpu: string;
  vendor: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  screen: {
    w: number;
    h: number;
    avW: number;
    avH: number;
    pixelDepth: number;
    colorDepth: number;
  };
  uaData: {
    brands: { brand: string; version: string }[];
    mobile: boolean;
    platform: string;
    architecture: string;
    model: string;
    bitness: string;
  };
  renderer: {
    vendor: string;
    renderer: string;
  };
}

const CHROME_VERSIONS = ['124.0.0.0', '125.0.0.0', '126.0.0.0'];

const WIN_SCREENS = [
  { w: 1920, h: 1080, avW: 1920, avH: 1040 },
  { w: 2560, h: 1440, avW: 2560, avH: 1400 },
  { w: 1366, h: 768,  avW: 1366, avH: 728 },
];

const MAC_SCREENS = [
  { w: 1440, h: 900,  avW: 1440, avH: 850 },
  { w: 1792, h: 1120, avW: 1792, avH: 1080 },
  { w: 2560, h: 1600, avW: 2560, avH: 1550 },
];

export class PersonaEngine {
  static generate(): BrowserPersona {
    const isWin = Math.random() > 0.4;
    const version = CHROME_VERSIONS[Math.floor(Math.random() * CHROME_VERSIONS.length)];
    const major = version.split('.')[0];

    if (isWin) {
      const scr = WIN_SCREENS[Math.floor(Math.random() * WIN_SCREENS.length)];
      return {
        userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,
        platform: 'Win32',
        oscpu: 'Windows NT 10.0; Win64; x64',
        vendor: 'Google Inc.',
        hardwareConcurrency: this.pick([4, 6, 8, 12, 16]),
        deviceMemory: this.pick([8, 16, 32]),
        screen: { ...scr, pixelDepth: 24, colorDepth: 24 },
        uaData: {
          brands: [
            { brand: 'Not-A.Brand', version: '99' },
            { brand: 'Chromium', version: major },
            { brand: 'Google Chrome', version: major }
          ],
          mobile: false,
          platform: 'Windows',
          architecture: 'x86',
          model: '',
          bitness: '64'
        },
        renderer: {
          vendor: 'Google Inc. (Intel)',
          renderer: 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0)'
        }
      };
    } else {
      const scr = MAC_SCREENS[Math.floor(Math.random() * MAC_SCREENS.length)];
      return {
        userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,
        platform: 'MacIntel',
        oscpu: 'Intel Mac OS X 10_15_7',
        vendor: 'Google Inc.',
        hardwareConcurrency: this.pick([8, 10]),
        deviceMemory: this.pick([8, 16]),
        screen: { ...scr, pixelDepth: 24, colorDepth: 24 },
        uaData: {
          brands: [
            { brand: 'Not-A.Brand', version: '99' },
            { brand: 'Chromium', version: major },
            { brand: 'Google Chrome', version: major }
          ],
          mobile: false,
          platform: 'macOS',
          architecture: 'arm', // Mostly M1/M2/M3 now
          model: '',
          bitness: '64'
        },
        renderer: {
          vendor: 'Apple Inc.',
          renderer: 'Apple M2'
        }
      };
    }
  }

  private static pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }
}
