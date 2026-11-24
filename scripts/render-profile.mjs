// 프로필 사진 렌더러: profile/*.svg → profile/*.png (1080x1080) + profile/preview.png
// 사용법: node scripts/render-profile.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'profile');
const require = createRequire(import.meta.url);
const fontDir = path.join(path.dirname(require.resolve('pretendard/package.json')), 'dist/web/static/woff2');
const font = (w, f) => `@font-face{font-family:'Pretendard';font-weight:${w};src:url('${pathToFileURL(path.join(fontDir, `Pretendard-${f}.woff2`)).href}') format('woff2');}`;
const fonts = font(400, 'Regular') + font(600, 'SemiBold') + font(700, 'Bold') + font(900, 'Black');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const options = JSON.parse(fs.readFileSync(path.join(DIR, 'bio.json'), 'utf8'));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
const tmp = path.join(DIR, '.tmp.html');
const show = async (html, out) => {
  fs.writeFileSync(tmp, `<!doctype html><meta charset="utf-8"><style>${fonts}*{margin:0;padding:0;box-sizing:border-box}body{font-family:Pretendard,sans-serif}</style>${html}`);
  await page.goto(pathToFileURL(tmp).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out, fullPage: true });
};

for (const o of options) {
  const svg = fs.readFileSync(path.join(DIR, `${o.image}.svg`), 'utf8');
  await show(`<div style="width:1080px;height:1080px">${svg}</div>`, path.join(DIR, `${o.image}.png`));
  console.log(`✓ profile/${o.image}.png`);
}

// 인스타그램 프로필 화면처럼 보이는 비교 미리보기
await page.setViewportSize({ width: 1260, height: 480 });
const card = (o) => {
  const img = pathToFileURL(path.join(DIR, `${o.image}.png`)).href;
  return `<div style="width:400px;background:#fff;border-radius:24px;padding:28px;box-shadow:0 2px 12px #0001">
    <div style="font-size:15px;font-weight:700;color:#0E5E57;margin-bottom:16px">${o.key.toUpperCase()}안 · ${esc(o.concept)}</div>
    <div style="display:flex;align-items:center;gap:22px;margin-bottom:16px">
      <img src="${img}" style="width:110px;height:110px;border-radius:50%">
      <div style="display:flex;gap:14px;text-align:center;font-size:13px;color:#333"><div><b style="font-size:17px">31</b><br>게시물</div><div><b style="font-size:17px">0</b><br>팔로워</div><div><b style="font-size:17px">0</b><br>팔로잉</div></div>
    </div>
    <div style="font-size:15px;font-weight:700;margin-bottom:4px">${esc(o.name)}</div>
    <div style="font-size:15px;line-height:1.5;white-space:pre-line;color:#111">${esc(o.bio)}</div>
    <div style="display:flex;gap:12px;align-items:flex-end;margin-top:22px;padding-top:16px;border-top:1px solid #eee">
      <img src="${img}" style="width:44px;height:44px;border-radius:50%"><img src="${img}" style="width:32px;height:32px;border-radius:50%">
      <span style="font-size:12px;color:#888">← 피드·댓글에서 보이는 작은 크기</span>
    </div></div>`;
};
await show(`<div style="background:#F2F2F2;padding:30px;display:flex;gap:20px;width:1260px">${options.map(card).join('')}</div>`, path.join(DIR, 'preview.png'));
console.log('✓ profile/preview.png');
fs.rmSync(tmp, { force: true });
await browser.close();
