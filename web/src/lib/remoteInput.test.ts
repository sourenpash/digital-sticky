import { describe, expect, it } from 'vitest';
import type { RemoteCommand } from '../../../shared/remote.ts';
import { queueCommand, typingChange, websiteUrl } from './remoteInput.ts';

describe('queueCommand', () => {
  it('adds up moves and scrolls, joins typing and keeps everything else in order', () => {
    const queue: RemoteCommand[] = [];
    queueCommand(queue, { type: 'move', dx: 3, dy: 4 });
    queueCommand(queue, { type: 'move', dx: -1, dy: 2 });
    queueCommand(queue, { type: 'click' });
    queueCommand(queue, { type: 'text', text: 'he' });
    queueCommand(queue, { type: 'text', text: 'llo' });
    queueCommand(queue, { type: 'key', key: 'Backspace' });
    queueCommand(queue, { type: 'key', key: 'Backspace' });
    queueCommand(queue, { type: 'scroll', dx: 0, dy: 10 });
    queueCommand(queue, { type: 'scroll', dx: 0, dy: 5 });
    expect(queue).toEqual([
      { type: 'move', dx: 2, dy: 6 },
      { type: 'click' },
      { type: 'text', text: 'hello' },
      { type: 'key', key: 'Backspace' },
      { type: 'key', key: 'Backspace' },
      { type: 'scroll', dx: 0, dy: 15 },
    ]);
  });

  it('does not change the command it was given', () => {
    const queue: RemoteCommand[] = [];
    const first = { type: 'move' as const, dx: 1, dy: 1 };
    queueCommand(queue, first);
    queueCommand(queue, { type: 'move', dx: 1, dy: 1 });
    expect(first).toEqual({ type: 'move', dx: 1, dy: 1 });
  });

  it('starts a new piece of text when one would get too long', () => {
    const queue: RemoteCommand[] = [];
    queueCommand(queue, { type: 'text', text: 'a'.repeat(1990) });
    queueCommand(queue, { type: 'text', text: 'b'.repeat(20) });
    expect(queue).toHaveLength(2);
  });
});

describe('typingChange', () => {
  it('sends new letters as they are typed, and Backspaces for deleted ones', () => {
    expect(typingChange('', 'h')).toEqual({ backspaces: 0, text: 'h' });
    expect(typingChange('hel', 'hello')).toEqual({ backspaces: 0, text: 'lo' });
    expect(typingChange('hello', 'hell')).toEqual({ backspaces: 1, text: '' });
    expect(typingChange('hello', '')).toEqual({ backspaces: 5, text: '' });
  });

  it('handles autocorrect and predictive text, which replace a word', () => {
    expect(typingChange('see teh ', 'see the ')).toEqual({ backspaces: 3, text: 'he ' });
    expect(typingChange('I love th', 'I love this ')).toEqual({ backspaces: 0, text: 'is ' });
  });

  it('counts an emoji as one character', () => {
    expect(typingChange('hi 👋🏽', 'hi ')).toEqual({ backspaces: 1, text: '' });
    expect(typingChange('hi', 'hi 👨‍👩‍👧')).toEqual({ backspaces: 0, text: ' 👨‍👩‍👧' });
  });
});

describe('websiteUrl', () => {
  it('adds https:// to website names and http:// to home-network addresses', () => {
    expect(websiteUrl('youtube.com')).toBe('https://youtube.com/');
    expect(websiteUrl('  news.ycombinator.com/best ')).toBe('https://news.ycombinator.com/best');
    expect(websiteUrl('192.168.1.5:8123')).toBe('http://192.168.1.5:8123/');
    expect(websiteUrl('localhost:3000')).toBe('http://localhost:3000/');
    expect(websiteUrl('nas.local')).toBe('http://nas.local/');
    expect(websiteUrl('homeassistant:8123/lovelace')).toBe('http://homeassistant:8123/lovelace');
  });

  it('keeps an address typed in full, and refuses anything that is not a web page', () => {
    expect(websiteUrl('http://example.com/a?b=1')).toBe('http://example.com/a?b=1');
    expect(websiteUrl('')).toBeNull();
    expect(websiteUrl('javascript:alert(1)')).toBeNull();
    expect(websiteUrl('file:///etc/passwd')).toBeNull();
  });
});
