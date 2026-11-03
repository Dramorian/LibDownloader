import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));

test('manifest.json: корректный MV3 и все файлы на месте', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '1.6.0');
  assert.match(manifest.name, /SlashLib/);
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.ok(exists('background.js'));
  assert.equal(manifest.options_page, 'app.html');
  assert.ok(exists('app.html'));
  assert.ok(exists('app.css'));
  assert.ok(exists('core.js'));
  assert.ok(exists('app.js'));
  for (const permission of ['downloads', 'scripting', 'tabs', 'declarativeNetRequestWithHostAccess']) {
    assert.ok(manifest.permissions.includes(permission), `нет permission ${permission}`);
  }
  assert.ok(manifest.optional_host_permissions.includes('https://*/*'));
  for (const pattern of manifest.host_permissions) {
    assert.match(pattern, /^https:\/\/[^*]+\/\*$|^https:\/\/\*\.[^*/]+\/\*$/);
  }
  for (const required of ['https://*.shlib.life/*', 'https://*.hentaicdn.org/*', 'https://*.cdnlibs.org/*']) {
    assert.ok(manifest.host_permissions.includes(required), `нет host permission ${required}`);
  }
  assert.doesNotMatch(manifest.content_security_policy.extension_pages, /unsafe-inline|unsafe-eval/);
  assert.match(manifest.content_security_policy.extension_pages, /font-src 'self'/);
  assert.match(manifest.content_security_policy.extension_pages, /style-src 'self'/);
});

test('иконки: PNG с заявленным размером', () => {
  const manifest = JSON.parse(read('manifest.json'));
  for (const [size, rel] of Object.entries(manifest.icons)) {
    const buffer = fs.readFileSync(path.join(root, rel));
    assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG');
    assert.equal(buffer.readUInt32BE(16), Number(size));
    assert.equal(buffer.readUInt32BE(20), Number(size));
  }
});

test('app.html: все #id из app.js существуют, ресурсы локальные', () => {
  const html = read('app.html');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const app = read('app.js');
  const used = [...app.matchAll(/\$\('#([\w-]+)'\)/g)].map((m) => m[1]);
  assert.ok(used.length > 20);
  for (const id of used) assert.ok(ids.has(id), `app.js использует отсутствующий #${id}`);
  for (const id of ['site-select', 'site-badge', 'suggestions']) assert.ok(ids.has(id), `нет #${id}`);
  assert.match(app, /function makeApiHeaders\(/);
  assert.match(app, /Authorization.*Bearer/, 'нужен Bearer-токен для 18+ тайтлов');
  assert.match(app, /readPageContext/);
  assert.match(app, /fetchChaptersWithFallback/);
  assert.match(app, /collectChapterFiles/);
  assert.match(app, /saveBatchArchive/);
  assert.match(app, /abortWithPartial/);
  assert.match(app, /partialChapterData/);
  assert.match(app, /НЕПОЛНАЯ/);
  assert.match(app, /folderedArchiveEntries/);
  assert.match(app, /C\.buildZipBytes/);
  for (const value of ['single-cbz-folders', 'single-cbz', 'single-zip', 'cbz', 'images', 'both']) {
    assert.match(html, new RegExp(`value="${value}"`), `нет формата ${value}`);
  }
  assert.match(html, /value="single-cbz-folders" selected/, 'CBZ с папками по главам должен быть форматом по умолчанию');
  assert.match(html, /частичный архив/, 'нужно предупреждение о частичном архиве при остановке');
  assert.doesNotMatch(app, /['"]Site-Id['"]\s*:\s*['"]\d['"]/, 'Site-Id должен браться из state.siteId');
  assert.match(read('core.js'), /api\.shlib\.life/);
  assert.match(read('core.js'), /slugToSearchQueries/);

  const refs = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 3);
  for (const ref of refs) {
    assert.doesNotMatch(ref, /^https?:/i, `внешний ресурс ${ref}`);
    assert.ok(exists(ref), `нет файла ${ref}`);
  }
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'inline-обработчики запрещены CSP');
});

test('HTML и CSS не тянут внешние шрифты/скрипты/картинки', () => {
  const html = read('app.html');
  const css = read('app.css');
  assert.doesNotMatch(html, /<(?:script|link|img)\b[^>]*(?:src|href)=["']https?:\/\//i);
  assert.doesNotMatch(css, /@import\s+url\(/i);
  assert.doesNotMatch(css, /url\(\s*https?:\/\//i);
});
