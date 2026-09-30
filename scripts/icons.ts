// Renders the Home Screen icons (PNG) into web/public: `node scripts/icons.ts`.
// Same design as favicon.svg, but square and opaque to the edges: iPhones round the
// corners themselves and would show transparent corners as black.
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#1b1916"/>
  <rect x="15" y="13" width="34" height="34" rx="2" fill="#ffe680" transform="rotate(-6 32 30)"/>
  <path d="M22.5 26h19M22.5 33h13" stroke="#2a2723" stroke-width="3.4" stroke-linecap="round" transform="rotate(-6 32 30)"/>
</svg>`;

const SIZES: Array<[file: string, size: number]> = [
  ['web/public/apple-touch-icon.png', 180],
  ['web/public/icon-192.png', 192],
  ['web/public/icon-512.png', 512],
];

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' });
for (const [file, size] of SIZES) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0">${ICON.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  await writeFile(file, await page.screenshot({ type: 'png' }));
  await page.close();
  console.log(`wrote ${file}`);
}
await browser.close();
