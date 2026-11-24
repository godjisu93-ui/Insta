// 사용설명서 PDF 만들기: docs/manual.html → docs/혈당노트_사용설명서.pdf
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const fontDir = path.join(path.dirname(require.resolve('pretendard/package.json')), 'dist/web/static/woff2');
const css = [[400, 'Regular'], [600, 'SemiBold'], [700, 'Bold'], [800, 'ExtraBold'], [900, 'Black']]
  .map(([w, f]) => `@font-face{font-family:'Pretendard';font-weight:${w};src:url('${pathToFileURL(path.join(fontDir, `Pretendard-${f}.woff2`)).href}') format('woff2');}`).join('');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(ROOT, 'docs/manual.html')).href);
await page.addStyleTag({ content: css });
await page.evaluate(() => document.fonts.ready);
const out = path.join(ROOT, 'docs', '혈당노트_사용설명서.pdf');
await page.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log('✓ ' + path.relative(ROOT, out));
