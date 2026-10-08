import { readFile, rename, writeFile } from 'node:fs/promises';
import type { z } from 'zod';
import { newId } from './store.ts';

// A JSON file in the data folder that only this user can read (it holds keys or
// passwords). Written to a temp file first and renamed over the old one, one write at
// a time, so it's never half written.

export class PrivateFile<T> {
  private writing: Promise<void> = Promise.resolve();
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  /** The saved value, or `fallback()` when there's none yet (or it can't be read: then `onDamaged` says why). */
  async read(schema: z.ZodType<T>, fallback: () => T, onDamaged: (why: string) => void = () => {}): Promise<T> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') onDamaged(String(error));
      return fallback();
    }
    try {
      const parsed = schema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
      onDamaged('it doesn’t look right');
    } catch {
      onDamaged('it isn’t valid JSON');
    }
    return fallback();
  }

  /** Saves `value` (after any write still going). */
  write(value: T): Promise<void> {
    const data = `${JSON.stringify(value, null, 2)}\n`;
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        const temp = `${this.path}.${process.pid}.${newId()}.tmp`;
        await writeFile(temp, data, { mode: 0o600 });
        await rename(temp, this.path);
      });
    return this.writing;
  }

  /** Waits for any write in progress. */
  flush(): Promise<void> {
    return this.writing.catch(() => {});
  }
}
