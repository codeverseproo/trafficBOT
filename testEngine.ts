// Mock electron-store and electron for Node testing
import { PlaywrightRunner } from './src/engine/runner';

// Simple in-memory store mock
class MockStore {
  private data: Record<string, any> = {
    personas: [
      {
        id: 'test-persona',
        name: 'Test Persona',
        userAgent: 'Mozilla/5.0 (Test)',
        locale: 'en-US',
        timezoneId: 'America/New_York',
        viewport: { width: 1280, height: 720 },
        statePath: './test_persona.json'
      }
    ],
    proxies: [
      {
        id: 'test-proxy',
        server: 'http://127.0.0.1:8080',
        healthScore: 100,
        failures: 0
      }
    ]
  };

  get(key: string, defaultValue: any) {
    return this.data[key] !== undefined ? this.data[key] : defaultValue;
  }
  set(key: string, value: any) {
    this.data[key] = value;
  }
}

async function runTests() {
  console.log('--- STARTING ENGINE TESTS ---');
  
  const mockStore = new MockStore() as any;
  const runner = new PlaywrightRunner(mockStore);

  console.log('[TEST] Playwright Runner Initialized');

  // We won't actually hit external URLs to avoid proxy timeouts. We will hit a fast local or safe public URL like example.com
  // BUT we will omit proxy for this test so it doesn't fail due to bad proxy.
  try {
    await runner.start({
      urls: ['https://example.com'],
      headless: true,
      concurrency: 1,
      personaId: 'test-persona',
      useProxyPool: false, // Don't use the mock proxy to avoid real connection errors
      manualAssistMode: false
    });
    console.log('[TEST] Playwright Runner Execution SUCCESS');
  } catch (error) {
    console.error('[TEST] Playwright Runner Execution FAILED:', error);
    process.exit(1);
  }

  console.log('--- ALL TESTS PASSED ---');
}

runTests();
