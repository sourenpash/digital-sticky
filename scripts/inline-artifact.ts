// Turns the `--mode artifact` build into one self-contained HTML fragment
// (styles, script and fonts inlined) for a shareable preview page.
// Usage: npm run build:preview-page [-- output.html]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const BUILD = 'dist/artifact-build';
const out = process.argv[2] ?? 'dist/preview-page/digital-sticky.html';

const html = await readFile(join(BUILD, 'index.html'), 'utf8');
const scriptSrc = html.match(/<script[^>]*src="\.\/([^"]+\.js)"[^>]*><\/script>/)?.[1];
const styleHref = html.match(/<link[^>]*rel="stylesheet"[^>]*href="\.\/([^"]+\.css)"[^>]*>/)?.[1];
if (!scriptSrc || !styleHref) throw new Error('Could not find the built script and stylesheet in index.html');

const js = (await readFile(join(BUILD, scriptSrc), 'utf8')).replaceAll('</script', '<\\/script');
const css = (await readFile(join(BUILD, styleHref), 'utf8')).replaceAll('</style', '<\\/style');

const page = `<title>Digital Sticky</title>
<meta name="description" content="Clickable prototype of a sticky-note wall for funding deadlines, sources and reminders.">
<style>${css}</style>
<div id="root"></div>
<script type="module">${js}</script>
`;

await mkdir(dirname(out), { recursive: true });
await writeFile(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
