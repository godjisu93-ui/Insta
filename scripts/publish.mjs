// 인스타그램 자동 업로드 (GitHub Actions에서 실행)
//   node scripts/publish.mjs prepare --kind carousel|reel [--day N] [--date YYYY-MM-DD]
//       → 오늘 올릴 원고를 찾아 이미지/릴스를 만들고 .media/<id>/ 에 JPEG·MP4로 준비
//   node scripts/publish.mjs publish [--dry-run]
//       → .media/target.json 대상을 Instagram API로 게시하고 published.json에 기록
// 필요한 환경변수: IG_ACCESS_TOKEN, MEDIA_BASE_URL (예: https://raw.githubusercontent.com/<owner>/<repo>/media)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const sched = JSON.parse(fs.readFileSync(path.join(ROOT, 'schedule.json'), 'utf8'));
const MEDIA = path.join(ROOT, '.media');
const TARGET = path.join(MEDIA, 'target.json');
const LOG = path.join(ROOT, 'published.json');
let API = `https://graph.instagram.com/${sched.graphApiVersion}`; // EAA 로 시작하는 토큰이면 graph.facebook.com 사용

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const flag = (name) => rest.includes(`--${name}`);
const fail = (msg) => { console.log(`::error::${msg}`); console.error(msg); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readLog = () => (fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : []);
const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: sched.timezone }).format(new Date());
const dayFor = (kind, date) => {
  const s = sched[kind];
  const diff = Math.round((Date.parse(date) - Date.parse(s.firstDate)) / 86400000);
  return s.firstDay + diff;
};
const loadPosts = () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.json') && !e.name.startsWith('_') ? [p] : [];
  });
  return walk(path.join(ROOT, 'content')).flatMap((f) => { const d = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(d) ? d : [d]; });
};

// ---------------- prepare ----------------
function prepare() {
  const kind = opt('kind');
  if (!['carousel', 'reel'].includes(kind)) fail('--kind 는 carousel 또는 reel 이어야 합니다');
  fs.rmSync(MEDIA, { recursive: true, force: true });
  fs.mkdirSync(MEDIA, { recursive: true });
  const write = (t) => { fs.writeFileSync(TARGET, JSON.stringify(t, null, 2)); console.log(JSON.stringify(t)); };

  if (sched.paused) return write({ skip: true, reason: 'schedule.json 의 paused 가 true' });
  const date = opt('date') || todayLocal();
  const day = opt('day') ? Number(opt('day')) : dayFor(kind, date);
  if (day < sched[kind].firstDay) return write({ skip: true, reason: `${kind} 일정 시작 전 (${sched[kind].firstDate})` });
  const id = `day${String(day).padStart(2, '0')}`;

  if (readLog().some((e) => e.id === id && e.kind === kind)) return write({ skip: true, id, kind, reason: '이미 게시됨' });
  const post = loadPosts().find((p) => p.id === id);
  if (!post) fail(`${date} 에 올릴 ${id} 원고가 없습니다. 새 원고를 만들어 주세요 (Claude에게 "다음 주 원고 만들어 줘").`);
  if (post.approved === false) fail(`${id} 원고가 아직 승인되지 않았습니다. 확인 후 "approved": true 로 바꿔 주세요.`);

  execFileSync(process.execPath, [path.join(ROOT, 'scripts/render.mjs'), id], { stdio: 'inherit' });
  if (kind === 'reel') execFileSync(process.execPath, [path.join(ROOT, 'scripts/render-reels.mjs'), id], { stdio: 'inherit' });

  // Instagram API는 JPEG 이미지만 받습니다
  const ffmpeg = require('ffmpeg-static');
  const src = path.join(ROOT, 'output', id);
  const dst = path.join(MEDIA, id);
  fs.mkdirSync(dst, { recursive: true });
  const jpg = (from, to) => execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', from, '-q:v', '2', to]);
  const images = [];
  if (kind === 'carousel') {
    for (const f of fs.readdirSync(src).filter((f) => /^\d+\.png$/.test(f)).sort()) {
      const out = f.replace('.png', '.jpg');
      jpg(path.join(src, f), path.join(dst, out));
      images.push(out);
    }
  } else {
    jpg(path.join(src, 'reel_cover.png'), path.join(dst, 'reel_cover.jpg'));
    fs.copyFileSync(path.join(src, 'reel.mp4'), path.join(dst, 'reel.mp4'));
  }
  const caption = fs.readFileSync(path.join(src, 'caption.txt'), 'utf8').trim();
  write({ skip: false, id, kind, date, day, title: post.title, images, caption });
}

// ---------------- publish ----------------
const TOKEN = (process.env.IG_ACCESS_TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
async function api(method, endpoint, params = {}) {
  const url = new URL(endpoint.startsWith('http') ? endpoint : API + endpoint);
  const body = new URLSearchParams({ ...params, access_token: TOKEN });
  const res = method === 'GET'
    ? await fetch((url.search = body.toString(), url))
    : await fetch(url, { method, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`${method} ${url.pathname} 실패: ${JSON.stringify(json.error || json)}`);
  return json;
}

async function waitReady(containerId, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const s = await api('GET', `/${containerId}`, { fields: 'status_code,status' });
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`미디어 처리 실패 (${containerId}): ${s.status}`);
    await sleep(8000);
  }
  throw new Error(`미디어 처리 시간 초과 (${containerId})`);
}

async function waitUrl(url) {
  for (let i = 0; i < 20; i++) {
    const r = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (r?.ok) return;
    await sleep(5000);
  }
  throw new Error(`공개 주소에서 파일을 찾을 수 없습니다: ${url} (저장소가 공개 상태인지 확인하세요)`);
}

async function publish() {
  if (!fs.existsSync(TARGET)) fail('먼저 prepare 를 실행하세요');
  const t = JSON.parse(fs.readFileSync(TARGET, 'utf8'));
  if (t.skip) { console.log(`건너뜀: ${t.reason}`); return; }
  const base = (process.env.MEDIA_BASE_URL || '').replace(/\/$/, '');
  const url = (f) => `${base}/${t.id}/${f}`;
  if (flag('dry-run')) {
    console.log(`[연습 모드] ${t.kind} ${t.id} "${t.title}" 를 게시할 예정입니다.`);
    console.log((t.kind === 'carousel' ? t.images.map(url) : [url('reel.mp4')]).join('\n'));
    console.log('--- 캡션 ---\n' + t.caption);
    return;
  }
  if (!TOKEN) fail('IG_ACCESS_TOKEN 이 없습니다. GitHub 저장소 Settings → Secrets 에 등록하세요.');
  if (!base) fail('MEDIA_BASE_URL 이 없습니다.');

  // 토큰 종류: IGAA… = 인스타그램 로그인 토큰 / EAA… = 통합 로그인(시스템 사용자) 토큰
  const fbToken = TOKEN.startsWith('EAA');
  if (fbToken) API = `https://graph.facebook.com/${sched.graphApiVersion}`;
  console.log(`토큰 종류: ${fbToken ? '통합 로그인(만료 없음)' : '인스타그램 로그인'} · 앞 4글자 ${TOKEN.slice(0, 4)} · 길이 ${TOKEN.length}`);

  // 인스타그램 로그인 토큰만 연장 (발급 24시간 이후부터 가능, 실패해도 계속 진행)
  if (!fbToken) try {
    const r = await api('GET', 'https://graph.instagram.com/refresh_access_token', { grant_type: 'ig_refresh_token' });
    console.log(`토큰 유효기간: 약 ${Math.round(r.expires_in / 86400)}일 남음`);
    if (r.access_token && r.access_token !== TOKEN) console.log('::warning::토큰이 새로 발급되었습니다. GitHub Secrets 의 IG_ACCESS_TOKEN 을 갱신해야 할 수 있습니다.');
  } catch (e) { console.log(`토큰 연장 건너뜀: ${e.message}`); }

  let ig, me;
  if (fbToken) {
    ig = process.env.IG_USER_ID || sched.igUserId;
    if (!ig) fail('schedule.json 에 igUserId 가 없습니다');
    me = await api('GET', `/${ig}`, { fields: 'username' });
  } else {
    me = await api('GET', '/me', { fields: 'user_id,username' });
    ig = me.user_id || me.id;
  }
  console.log(`계정: @${me.username} → ${t.kind} ${t.id} "${t.title}" 게시 시작`);

  let creationId;
  if (t.kind === 'carousel') {
    for (const f of t.images) await waitUrl(url(f));
    if (t.images.length === 1) {
      creationId = (await api('POST', `/${ig}/media`, { image_url: url(t.images[0]), caption: t.caption })).id;
    } else {
      const children = [];
      for (const f of t.images) {
        const c = await api('POST', `/${ig}/media`, { image_url: url(f), is_carousel_item: 'true' });
        await waitReady(c.id, 120000);
        children.push(c.id);
      }
      creationId = (await api('POST', `/${ig}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption: t.caption })).id;
    }
    await waitReady(creationId, 300000);
  } else {
    await waitUrl(url('reel_cover.jpg'));
    // share_to_feed false: 릴스는 프로필 격자에 넣지 않고 릴스 탭·추천에만 (피드 체크무늬 유지)
    const common = { media_type: 'REELS', caption: t.caption, share_to_feed: 'false', cover_url: url('reel_cover.jpg') };
    const video = fs.readFileSync(path.join(MEDIA, t.id, 'reel.mp4'));
    try {
      // 영상 파일을 직접 업로드 (공개 주소 불필요)
      const c = await api('POST', `/${ig}/media`, { ...common, upload_type: 'resumable' });
      const up = await fetch(c.uri || `https://rupload.facebook.com/ig-api-upload/${sched.graphApiVersion}/${c.id}`, {
        method: 'POST', headers: { Authorization: `OAuth ${TOKEN}`, offset: '0', file_size: String(video.length) }, body: video,
      });
      if (!up.ok) throw new Error(`영상 업로드 실패: ${up.status} ${await up.text()}`);
      creationId = c.id;
    } catch (e) {
      console.log(`직접 업로드 실패 → 공개 주소 방식으로 재시도 (${e.message})`);
      await waitUrl(url('reel.mp4'));
      creationId = (await api('POST', `/${ig}/media`, { ...common, video_url: url('reel.mp4') })).id;
    }
    await waitReady(creationId, 900000);
  }

  const published = await api('POST', `/${ig}/media_publish`, { creation_id: creationId });
  let permalink = '';
  try { permalink = (await api('GET', `/${published.id}`, { fields: 'permalink' })).permalink; } catch {}
  const log = readLog();
  log.push({ id: t.id, kind: t.kind, date: t.date, title: t.title, mediaId: published.id, permalink, publishedAt: new Date().toISOString() });
  fs.writeFileSync(LOG, JSON.stringify(log, null, 2) + '\n');
  console.log(`✓ 게시 완료: ${permalink || published.id}`);
}

if (cmd === 'prepare') prepare();
else if (cmd === 'publish') publish().catch((e) => fail(e.message));
else fail('사용법: node scripts/publish.mjs prepare|publish ...');
