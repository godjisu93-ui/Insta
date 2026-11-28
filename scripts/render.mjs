// 카드뉴스 렌더러: content/ 폴더의 JSON 원고 → output/<id>/NN.png + caption.txt
// 사용법:
//   npm run build                 모든 원고 렌더링
//   npm run build -- day03 day04  특정 id만 렌더링
//   npm run check                 원고 형식만 검사(이미지 생성 안 함)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirArg = process.argv.indexOf('--dir');
const CONTENT_DIR = dirArg > 0 ? path.resolve(ROOT, process.argv[dirArg + 1]) : path.join(ROOT, 'content');
const OUT_DIR = path.join(ROOT, 'output');
const W = 1080, H = 1350;

const brand = JSON.parse(fs.readFileSync(path.join(ROOT, 'brand.json'), 'utf8'));
const css = fs.readFileSync(path.join(ROOT, 'templates', 'card.css'), 'utf8');
const require = createRequire(import.meta.url);
const fontDir = path.join(path.dirname(require.resolve('pretendard/package.json')), 'dist/web/static/woff2');

// ---------- 원고 읽기 ----------
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.json') && !e.name.startsWith('_') ? [p] : [];
  }).sort();
}

function loadPosts() {
  const posts = [];
  for (const file of walk(CONTENT_DIR)) {
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { throw new Error(`JSON 문법 오류: ${path.relative(ROOT, file)}\n  ${e.message}`); }
    for (const post of Array.isArray(data) ? data : [data]) posts.push({ ...post, _file: path.relative(ROOT, file) });
  }
  return posts;
}

const TYPES = {
  cover: ['title'], text: ['heading', 'body'], list: ['heading', 'items'], myth: ['myth', 'fact'],
  table: ['heading', 'rows'], compare: ['heading', 'left', 'right'], recipe: ['heading', 'ingredients', 'steps'],
  end: ['summary'], quiz: ['question'], answer: ['answer', 'heading'], poster: ['heading', 'steps'],
};

function validate(posts) {
  const errors = [];
  const ids = new Set();
  for (const p of posts) {
    const where = `${p._file} (${p.id ?? 'id 없음'})`;
    if (!p.id) errors.push(`${where}: "id"가 없습니다`);
    else if (ids.has(p.id)) errors.push(`${where}: id가 중복됩니다`);
    ids.add(p.id);
    if (!Array.isArray(p.slides) || !p.slides.length) { errors.push(`${where}: "slides"가 비었습니다`); continue; }
    if (p.slides.length > 20) errors.push(`${where}: 인스타그램 캐러셀은 최대 20장입니다`);
    p.slides.forEach((s, i) => {
      const req = TYPES[s.type];
      if (!req) return errors.push(`${where} ${i + 1}번째 장: 알 수 없는 type "${s.type}" (사용 가능: ${Object.keys(TYPES).join(', ')})`);
      for (const k of req) if (s[k] == null) errors.push(`${where} ${i + 1}번째 장(${s.type}): "${k}" 항목이 필요합니다`);
    });
  }
  return errors;
}

// ---------- HTML 만들기 ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// **강조** → 강조색, 줄바꿈(\n) → <br>
const md = (s) => esc(s ?? '').replace(/\*\*(.+?)\*\*/g, '<em>$1</em>').replace(/\n/g, '<br>');
const paras = (b) => (Array.isArray(b) ? b : [b]).map((t) => `<p>${md(t)}</p>`).join('');

function slideBody(s) {
  switch (s.type) {
    case 'cover':
      return `
        ${s.tag ? `<div class="cover-tag">${md(s.tag)}</div>` : ''}
        <h1 class="cover-title">${md(s.title)}</h1>
        ${s.sub ? `<p class="cover-sub">${md(s.sub)}</p>` : ''}
        <div class="swipe">옆으로 넘겨 보세요 <span class="arrow">→</span></div>`;
    case 'text':
      return `${s.label ? `<div class="label">${md(s.label)}</div>` : ''}
        <h2>${md(s.heading)}</h2><div class="body">${paras(s.body)}</div>
        ${s.note ? `<div class="note">${md(s.note)}</div>` : ''}`;
    case 'list':
      return `<h2>${md(s.heading)}</h2>
        <ol class="items ${s.style === 'check' ? 'check' : ''}">${s.items.map((it, i) => {
          const t = typeof it === 'string' ? { title: it } : it;
          return `<li><span class="num">${s.style === 'check' ? '✓' : i + 1}</span><div><strong>${md(t.title)}</strong>${t.desc ? `<span>${md(t.desc)}</span>` : ''}</div></li>`;
        }).join('')}</ol>
        ${s.note ? `<div class="note">${md(s.note)}</div>` : ''}`;
    case 'myth':
      return `${s.heading ? `<h2>${md(s.heading)}</h2>` : ''}
        <div class="mf myth"><div class="mf-badge">X</div><div><div class="mf-label">오해</div><div class="mf-text">${md(s.myth)}</div></div></div>
        <div class="mf fact"><div class="mf-badge">O</div><div><div class="mf-label">사실</div><div class="mf-text">${md(s.fact)}</div></div></div>
        ${s.note ? `<div class="note">${md(s.note)}</div>` : ''}`;
    case 'table':
      return `<h2>${md(s.heading)}</h2>
        <div class="table">${s.rows.map((r) => `
          <div class="row tone-${r.tone || 'none'}"><div class="row-label">${md(r.label)}</div><div class="row-value">${md(r.value)}</div></div>`).join('')}
        </div>${s.note ? `<div class="note">${md(s.note)}</div>` : ''}`;
    case 'compare': {
      const col = (c, cls) => `<div class="col ${cls}"><div class="col-title">${md(c.title)}</div>
        <ul>${c.items.map((x) => `<li>${md(x)}</li>`).join('')}</ul></div>`;
      return `<h2>${md(s.heading)}</h2><div class="compare">${col(s.left, 'left')}<div class="vs">→</div>${col(s.right, 'right')}</div>
        ${s.note ? `<div class="note">${md(s.note)}</div>` : ''}`;
    }
    case 'recipe':
      return `<h2>${md(s.heading)}</h2>${s.meta ? `<div class="meta">${md(s.meta)}</div>` : ''}
        <div class="recipe">
          <div class="ing"><div class="col-title">재료</div><ul>${s.ingredients.map((x) => `<li>${md(x)}</li>`).join('')}</ul></div>
          <div class="steps"><div class="col-title">만드는 법</div><ol>${s.steps.map((x, i) => `<li><span class="num">${i + 1}</span><div>${md(x)}</div></li>`).join('')}</ol></div>
        </div>${s.note ? `<div class="note">${md(s.note)}</div>` : ''}`;
    case 'quiz':
      return `<div class="q-label">Q.</div><h2 class="q-text">${md(s.question)}</h2>
        <div class="ox"><div class="o">O</div><div class="x">X</div></div>
        <div class="q-hint">${md(s.hint || '정답은 다음 장에 있어요 →')}</div>`;
    case 'answer':
      return `<div class="a-row"><div class="a-badge ${s.answer === 'O' ? 'o' : 'x'}">${esc(s.answer)}</div>
        <div class="a-label">정답은<br><b>${esc(s.answer)}</b>예요</div></div>
        <h2>${md(s.heading)}</h2>${s.body ? `<div class="body">${paras(s.body)}</div>` : ''}
        ${s.note ? `<div class="note">${md(s.note)}</div>` : ''}`;
    case 'poster':
      return `<div class="p-tag">${md(s.tag || '냉장고에 붙여 두세요')}</div>
        <h2 class="p-title">${md(s.heading)}</h2>
        ${s.chips ? `<div class="p-chips">${s.chips.map((c) => `<span>${md(c)}</span>`).join('')}</div>` : ''}
        <div class="p-steps">${s.steps.map((st, k) => {
          const t = typeof st === 'string' ? { title: st } : st;
          return `<div class="p-step"><div class="p-n">${k + 1}</div><div><b>${md(t.title)}</b>${t.desc ? `<span>${md(t.desc)}</span>` : ''}</div></div>`;
        }).join('')}</div>
        ${s.warn ? `<div class="p-warn">${md(s.warn)}</div>` : ''}
        ${s.source ? `<div class="p-src">출처 · ${md(s.source)} · ${md(brand.disclaimer)}</div>` : ''}`;
    case 'end':
      return `<h2>${md(s.heading || '오늘의 핵심 정리')}</h2>
        <ul class="summary">${s.summary.map((x) => `<li><span class="tick">✓</span><div>${md(x)}</div></li>`).join('')}</ul>
        ${s.question ? `<div class="question">${md(s.question)}</div>` : ''}
        <div class="end-meta">
          ${s.source ? `<div class="source">출처 · ${md(s.source)}</div>` : ''}
          <div class="disclaimer">${md(brand.disclaimer)}</div>
        </div>`;
  }
}

function slideHtml(post, s, i, n) {
  // 표지 색: brand.json 의 coverPattern 이 "alternate" 면 짝수 Day 는 크림색 표지 (피드 체크무늬용)
  const lightCover = post.coverTheme ? post.coverTheme === 'light' : brand.coverPattern === 'alternate' && Number.isInteger(post.day) && post.day % 2 === 0 && post.day > 0;
  const dark = s.theme ? s.theme === 'dark' : (s.type === 'cover' && !lightCover) || s.type === 'end';
  const c = brand.colors;
  const vars = Object.entries(c).map(([k, v]) => `--${k}:${v};`).join('');
  const font = (w, f) => `@font-face{font-family:'Pretendard';font-weight:${w};src:url('${pathToFileURL(path.join(fontDir, `Pretendard-${f}.woff2`)).href}') format('woff2');}`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
    ${font(400, 'Regular')}${font(500, 'Medium')}${font(600, 'SemiBold')}${font(700, 'Bold')}${font(800, 'ExtraBold')}${font(900, 'Black')}
    :root{${vars}} ${css}</style></head><body>
    <div class="slide type-${s.type} ${dark ? 'dark' : 'light'}">
      <header><span class="chip">${md(s.type === 'cover' ? brand.accountName : (post.series || brand.accountName))}</span><span class="pg">${n > 1 ? `${i + 1} / ${n}` : ''}</span></header>
      <main><div class="inner">${slideBody(s)}</div></main>
      <footer><span class="handle">${esc(brand.handle)}</span><span class="cta">${i === n - 1 ? '저장 · 공유로 가족에게 알려 주세요' : md(brand.footerText)}</span></footer>
    </div></body></html>`;
}

// 내용이 넘치면 글자 크기를 단계적으로 줄인다
async function fitContent(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main'), inner = document.querySelector('.inner');
    let z = 1;
    while (inner.scrollHeight * z > main.clientHeight && z > 0.62) { z -= 0.02; inner.style.zoom = z; }
    return { zoom: Math.round(z * 100) / 100, overflow: inner.scrollHeight * z > main.clientHeight + 2 };
  });
}

// ---------- 실행 ----------
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const only = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--dir');

const posts = loadPosts();
const errors = validate(posts);
if (errors.length) { console.error('원고 오류:\n- ' + errors.join('\n- ')); process.exit(1); }
const targets = only.length ? posts.filter((p) => only.includes(p.id)) : posts;
if (only.length && targets.length !== only.length) console.warn('찾지 못한 id:', only.filter((id) => !posts.some((p) => p.id === id)).join(', '));
console.log(`원고 ${posts.length}개 확인 완료.`);
if (checkOnly) process.exit(0);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const tmp = path.join(OUT_DIR, '.tmp.html');
fs.mkdirSync(OUT_DIR, { recursive: true });
const warnings = [];

for (const post of targets) {
  const dir = path.join(OUT_DIR, post.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const n = post.slides.length;
  for (let i = 0; i < n; i++) {
    fs.writeFileSync(tmp, slideHtml(post, post.slides[i], i, n));
    await page.goto(pathToFileURL(tmp).href);
    await page.evaluate(() => document.fonts.ready);
    const fit = await fitContent(page);
    if (fit.overflow) warnings.push(`${post.id} ${i + 1}장: 글이 너무 많아 잘립니다 → 문장을 줄이거나 2장으로 나누세요`);
    else if (fit.zoom < 0.8) warnings.push(`${post.id} ${i + 1}장: 글자가 ${Math.round(fit.zoom * 100)}%로 작아졌습니다 → 줄이면 더 잘 읽힙니다`);
    await page.screenshot({ path: path.join(dir, `${String(i + 1).padStart(2, '0')}.png`) });
  }
  const caption = [post.caption || '', '', brand.disclaimer, '', (post.hashtags || []).map((h) => (h.startsWith('#') ? h : '#' + h)).join(' ')].join('\n').trim();
  fs.writeFileSync(path.join(dir, 'caption.txt'), caption + '\n');
  console.log(`✓ ${post.id} (${n}장) ${post.title || ''}`);
}
await browser.close();
fs.rmSync(tmp, { force: true });

// 미리보기 페이지
const all = posts.filter((p) => fs.existsSync(path.join(OUT_DIR, p.id)));
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), `<!doctype html><meta charset="utf-8"><title>카드뉴스 미리보기</title>
<style>body{font-family:sans-serif;background:#eee;margin:24px}section{margin-bottom:40px}h2{font-size:18px}
.row{display:flex;gap:8px;overflow-x:auto}.row img{height:340px;border-radius:6px;box-shadow:0 1px 4px #0002}pre{white-space:pre-wrap;background:#fff;padding:12px;max-width:760px;font-size:13px}</style>
${all.map((p) => `<section><h2>${esc(p.id)} · ${esc(p.series || '')} · ${esc(p.title || '')}</h2><div class="row">${p.slides.map((_, i) => `<img src="${p.id}/${String(i + 1).padStart(2, '0')}.png">`).join('')}</div>
<pre>${esc(fs.readFileSync(path.join(OUT_DIR, p.id, 'caption.txt'), 'utf8'))}</pre>${p.check ? `<p><b>업로드 전 확인:</b> ${esc(p.check)}</p>` : ''}</section>`).join('')}`);

if (warnings.length) console.warn('\n확인이 필요한 장:\n- ' + warnings.join('\n- '));
console.log(`\n완료 → output/ 폴더 (미리보기: output/index.html)`);
