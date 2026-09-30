import { describe, expect, it } from 'vitest';
import { charKey, openRefused } from './remote.ts';

describe('remote control', () => {
  it('never opens the wall browser’s own debugging port', () => {
    expect(openRefused('http://127.0.0.1:9222/json/list', 9222)).toBe(true);
    expect(openRefused('http://localhost:9222/', 9222)).toBe(true);
    expect(openRefused('http://[::1]:9222/', 9222)).toBe(true);
    expect(openRefused('https://example.com:9222/', 9222)).toBe(true);
    expect(openRefused('https://example.com/', 9222)).toBe(false);
    expect(openRefused('http://localhost:3000/#wall', 9222)).toBe(false);
    expect(openRefused('https://example.com/', 443)).toBe(true);
    expect(openRefused('not a url', 9222)).toBe(true);
  });

  it('types letters as key presses that websites understand', () => {
    expect(charKey('k')).toEqual({ key: 'k', code: 'KeyK', keyCode: 75, text: 'k' });
    expect(charKey('K')).toEqual({ key: 'K', code: 'KeyK', keyCode: 75, text: 'K' });
    expect(charKey('7')).toEqual({ key: '7', code: 'Digit7', keyCode: 55, text: '7' });
    expect(charKey(' ')).toEqual({ key: ' ', code: 'Space', keyCode: 32, text: ' ' });
    expect(charKey('é')).toEqual({ key: 'é', code: '', keyCode: 0, text: 'é' });
  });
});
