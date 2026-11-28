// 릴스 변환기: output/<id>/NN.png 카드 → output/<id>/reel.mp4 (1080x1920 세로 영상, 소리 없음)
// 사용법:
//   npm run reels                 모든 원고를 릴스로
//   npm run reels -- day01 day02  특정 원고만
// 음악은 인스타그램 앱에서 올릴 때 넣으세요(저작권 걱정 없음).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'output');
const require = createRequire(import.meta.url);
const brand = JSON.parse(fs.readFileSync(path.join(ROOT, 'brand.json'), 'utf8'));
const c = brand.colors;
const fontDir = path.join(path.dirname(require.resolve('pretendard/package.json')), 'dist/web/static/woff2');
let FFMPEG = 'ffmpeg';
try { const p = require('ffmpeg-static'); if (p && fs.existsSync(p)) FFMPEG = p; } catch {}

// 장당 보여 주는 시간(초)
const SEC = { cover: 2.5, end: 3.5, poster: 9.0, quiz: 4.0, default: 5.0 }; // 본문은 장당 5초 (읽을 시간 확보)
const FADE = 0.45;

// 원고 목록 (render.mjs와 같은 방식으로 읽기)
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p) : e.name.endsWith('.json') && !e.name.startsWith('_') ? [p] : [];
});
const posts = walk(path.join(ROOT, 'content')).flatMap((f) => { const d = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(d) ? d : [d]; });
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const targets = only.length ? posts.filter((p) => only.includes(p.id)) : posts;
if (!targets.length) { console.error('해당 id의 원고를 찾지 못했습니다:', only.join(', ')); process.exit(1); }

// 카드 이미지가 없거나 원고보다 오래됐으면 먼저 만들기
const missing = targets.filter((p) => !fs.existsSync(path.join(OUT_DIR, p.id, '01.png')));
if (missing.length) {
  console.log(`카드 이미지가 없어 먼저 만듭니다: ${missing.map((p) => p.id).join(', ')}`);
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/render.mjs'), ...missing.map((p) => p.id)], { stdio: 'inherit' });
}

const font = (w, f) => `@font-face{font-family:'Pretendard';font-weight:${w};src:url('${pathToFileURL(path.join(fontDir, `Pretendard-${f}.woff2`)).href}') format('woff2');}`;
const frameHtml = (post, i, n) => {
  const card = pathToFileURL(path.join(OUT_DIR, post.id, `${String(i + 1).padStart(2, '0')}.png`)).href;
  const bars = Array.from({ length: n }, (_, k) => `<div class="bar ${k <= i ? 'on' : ''}"></div>`).join('');
  return `<!doctype html><meta charset="utf-8"><style>${font(600, 'SemiBold')}${font(800, 'ExtraBold')}
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1080px;height:1920px;background:${c.primaryDeep};font-family:Pretendard,sans-serif;position:relative;overflow:hidden}
  .blob{position:absolute;border-radius:50%;background:${c.primary}}
  .bars{position:absolute;top:150px;left:70px;right:70px;display:flex;gap:10px}
  .bar{flex:1;height:10px;border-radius:5px;background:rgba(255,255,255,.22)}
  .bar.on{background:${c.highlightOnDark}}
  .top{position:absolute;top:190px;left:70px;right:70px;display:flex;justify-content:space-between;color:rgba(255,255,255,.85);font-size:34px;font-weight:600}
  .top b{color:#fff;font-weight:800}
  .card{position:absolute;top:270px;left:70px;width:940px;height:1175px;border-radius:36px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.35);border:4px solid rgba(255,255,255,.25)}
  .card img{width:100%;height:100%;display:block}
  .bottom{position:absolute;top:1490px;left:70px;right:70px;color:#fff;font-size:38px;font-weight:800}
  .bottom span{color:${c.highlightOnDark}}
  </style>
  <div class="blob" style="width:700px;height:700px;right:-300px;top:-250px"></div>
  <div class="blob" style="width:600px;height:600px;left:-280px;bottom:-200px;opacity:.6"></div>
  <div class="bars">${bars}</div>
  <div class="top"><b>${brand.accountName}</b><span>${post.series || ''}</span></div>
  <div class="card"><img src="${card}"></div>
  <div class="bottom">${i === n - 1 ? '<span>저장</span>하고 가족에게 <span>공유</span>해 주세요' : '<span>저장</span>해 두면 언제든 다시 볼 수 있어요'}</div>`;
};

// 릴스 표지: 크림색 배경 (피드에서 카드뉴스의 진한 초록 표지와 번갈아 보여 체크무늬가 됨)
// 피드 격자에서는 가운데 3:4(1080x1440, 위아래 240px 잘림)만 보이므로 글자는 그 안에 둔다.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, `<em>$1</em>`).replace(/\n/g, '<br>');
const coverHtml = (post) => {
  const cover = post.slides.find((s) => s.type === 'cover') || {};
  const secs = post.slides.reduce((a, s) => a + (SEC[s.type] ?? SEC.default), 0);
  return `<!doctype html><meta charset="utf-8"><style>${font(600, 'SemiBold')}${font(800, 'ExtraBold')}${font(900, 'Black')}
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1080px;height:1920px;background:${c.bg};font-family:Pretendard,sans-serif;position:relative;overflow:hidden;color:${c.ink};word-break:keep-all}
  .b1{position:absolute;width:760px;height:760px;border-radius:50%;background:${c.primary};opacity:.10;right:-300px;top:120px}
  .b2{position:absolute;width:560px;height:560px;border-radius:50%;background:${c.highlightOnDark};opacity:.35;left:-240px;bottom:180px}
  .safe{position:absolute;top:240px;left:0;right:0;height:1440px;padding:110px 96px;display:flex;flex-direction:column;justify-content:center}
  .chip{align-self:flex-start;display:flex;gap:14px;align-items:center;font-size:34px;font-weight:800;color:#fff;background:${c.primary};padding:14px 30px;border-radius:99px;margin-bottom:56px}
  h1{font-size:112px;line-height:1.2;font-weight:900;letter-spacing:-.035em;margin-bottom:44px}
  em{font-style:normal;color:${c.accent}}
  p{font-size:42px;line-height:1.5;font-weight:600;color:${c.sub}}
  .foot{margin-top:80px;display:flex;justify-content:space-between;font-size:32px;font-weight:800;color:${c.primary};border-top:3px solid ${c.line};padding-top:30px}
  </style><div class="b1"></div><div class="b2"></div>
  <div class="safe">
    <div class="chip">▶ ${esc(post.series || '릴스')}</div>
    <h1>${md(cover.title || post.title)}</h1>
    ${cover.sub ? `<p>${md(cover.sub)}</p>` : ''}
    <div class="foot"><span>${esc(brand.handle)}</span><span>${Math.round(secs)}초 요약</span></div>
  </div>`;
};
const coverOnly = process.argv.includes('--cover-only');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
const tmp = path.join(OUT_DIR, '.reel.html');

for (const post of targets) {
  const dir = path.join(OUT_DIR, post.id);
  const creamCover = brand.reelCover === 'cream' || coverOnly;
  if (creamCover) {
    fs.writeFileSync(tmp, coverHtml(post));
    await page.goto(pathToFileURL(tmp).href);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(dir, 'reel_cover.png') });
  }
  if (coverOnly) { console.log(`✓ ${post.id} 릴스 표지`); continue; }
  const frameDir = path.join(dir, 'reel_frames');
  fs.rmSync(frameDir, { recursive: true, force: true });
  fs.mkdirSync(frameDir, { recursive: true });
  const n = post.slides.length;
  const frames = [];
  for (let i = 0; i < n; i++) {
    fs.writeFileSync(tmp, frameHtml(post, i, n));
    await page.goto(pathToFileURL(tmp).href);
    await page.evaluate(() => document.fonts.ready);
    const f = path.join(frameDir, `${String(i + 1).padStart(2, '0')}.png`);
    await page.screenshot({ path: f });
    frames.push(f);
  }

  // 장면 전환(옆으로 밀기)으로 이어 붙이기
  const dur = post.slides.map((s) => SEC[s.type] ?? SEC.default);
  const args = ['-y', '-loglevel', 'error'];
  frames.forEach((f, i) => args.push('-loop', '1', '-framerate', '30', '-t', String(dur[i] + (i < n - 1 ? FADE : 0)), '-i', f));
  let filter = '', last = '[0:v]', offset = 0;
  for (let i = 1; i < n; i++) {
    offset += dur[i - 1];
    filter += `${last}[${i}:v]xfade=transition=slideleft:duration=${FADE}:offset=${offset.toFixed(2)}[v${i}];`;
    last = `[v${i}]`;
  }
  filter += `${last}format=yuv420p[out]`;
  args.push('-filter_complex', filter, '-map', '[out]', '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', '-an', path.join(dir, 'reel.mp4'));
  execFileSync(FFMPEG, args, { stdio: 'inherit' });
  if (!creamCover) fs.copyFileSync(frames[0], path.join(dir, 'reel_cover.png'));
  fs.rmSync(frameDir, { recursive: true, force: true });
  console.log(`✓ ${post.id} 릴스 ${dur.reduce((a, b) => a + b, 0).toFixed(1)}초 → output/${post.id}/reel.mp4`);
}
fs.rmSync(tmp, { force: true });
await browser.close();
console.log('\n완료! 인스타그램 앱에서 릴스로 올릴 때 음악을 추가하세요.');
