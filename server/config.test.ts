import { describe, expect, it } from 'vitest';
import { readConfig } from './config.ts';

describe('readConfig', () => {
  it('has defaults for an empty .env', () => {
    expect(readConfig({}, [])).toMatchObject({ port: 3000, host: '0.0.0.0', dataDir: 'data', demo: false, pin: null, trustLocalhost: true, allowedHosts: [], kioskDebugPort: 9222 });
  });

  it('checks the PIN', () => {
    expect(readConfig({ BOARD_PIN: ' 123456 ' }, []).pin).toBe('123456');
    expect(() => readConfig({ BOARD_PIN: '1234' }, [])).toThrow(/6 to 12 digits/);
    expect(() => readConfig({ BOARD_PIN: '12345a' }, [])).toThrow(/6 to 12 digits/);
  });

  it('reads the wall browser’s debugging port, or turns the remote off', () => {
    expect(readConfig({ KIOSK_DEBUG_PORT: '9333' }, []).kioskDebugPort).toBe(9333);
    expect(readConfig({ KIOSK_DEBUG_PORT: 'off' }, []).kioskDebugPort).toBeNull();
    expect(readConfig({ KIOSK_DEBUG_PORT: '0' }, []).kioskDebugPort).toBeNull();
    expect(() => readConfig({ KIOSK_DEBUG_PORT: 'lots' }, [])).toThrow(/KIOSK_DEBUG_PORT/);
    expect(() => readConfig({ KIOSK_DEBUG_PORT: '3000' }, [])).toThrow(/other than PORT/);
  });

  it('answers to the PUBLIC_URL name and ALLOWED_HOSTS', () => {
    const config = readConfig({ PUBLIC_URL: 'https://wall.tail1234.ts.net/', ALLOWED_HOSTS: 'Wall.Example , other.test' }, []);
    expect(config.publicUrl).toBe('https://wall.tail1234.ts.net');
    expect(config.allowedHosts).toEqual(['wall.example', 'other.test', 'wall.tail1234.ts.net']);
  });
});
