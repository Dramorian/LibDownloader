import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../core.js');
const enc = new TextEncoder();

test('parseSlug: MangaLib, SlashLib, читалка и голый slug', () => {
  assert.equal(C.parseSlug('https://mangalib.me/ru/7965--chainsaw-man'), '7965--chainsaw-man');
  assert.equal(
    C.parseSlug('https://mangalib.me/ru/7965--chainsaw-man/read/v1/c12.5?bid=4667'),
    '7965--chainsaw-man',
  );
  assert.equal(C.parseSlug('https://mangalib.me/ru/manga/206--one-piece?section=chapters'), '206--one-piece');
  assert.equal(C.parseSlug('https://v2.shlib.life/ru/manga/87161--san-da'), '87161--san-da');
  assert.equal(
    C.parseSlug('https://v2.shlib.life/ru/87161--san-da/read/v14/c116?bid=2017'),
    '87161--san-da',
  );
  assert.equal(C.parseSlug('7965--chainsaw-man'), '7965--chainsaw-man');
  assert.equal(C.parseSlug('https://example.com/7965--chainsaw-man'), null);
});

test('профили сайтов: разные Site-Id, API и CDN', () => {
  assert.equal(C.SITE_PROFILES.manga.siteId, '1');
  assert.equal(C.SITE_PROFILES.slash.siteId, '2');
  assert.equal(C.detectSite('https://mangalib.me/ru/7965--chainsaw-man').key, 'manga');
  assert.equal(C.detectSite('https://v2.shlib.life/ru/manga/87161--san-da').key, 'slash');
  assert.equal(C.detectSite('87161--san-da'), null);
  assert.ok(C.isSupportedHost('v2.shlib.life'));
  assert.ok(C.isSupportedHost('mangalib.org'));
  assert.ok(C.SITE_PROFILES.slash.apiBases.includes('https://api.shlib.life/api'));
  assert.ok(C.SITE_PROFILES.slash.fallbackServers.includes('https://img3.hentaicdn.org'));
  assert.ok(C.SITE_DNR_DOMAINS.includes('hentaicdn.org'));
  assert.ok(C.SITE_INITIATOR_DOMAINS.includes('v2.shlib.life'));
});

test('slugToSearchQueries и titleSearchScore', () => {
  const queries = C.slugToSearchQueries('4364--kobayashi-san-chi-no-maid-dragon');
  assert.ok(queries.includes('kobayashi san chi no maid dragon'));
  assert.ok(queries.includes('kobayashi'));
  assert.ok(queries.includes('maid dragon'));
  assert.ok(queries.length <= 6);
  const exact = { slug_url: '4364--kobayashi-san-chi-no-maid-dragon', slug: 'kobayashi-san-chi-no-maid-dragon', site: 2, name: 'Kobayashi-san chi no Maid Dragon' };
  const other = { slug_url: '56049--kobayashi-san-chi-no-maid-dragon-okomorigurashi-no-fafnir', slug: 'kobayashi-san-chi-no-maid-dragon-okomorigurashi-no-fafnir', site: 2, name: 'Fafnir' };
  assert.ok(C.titleSearchScore(exact, exact.slug_url, '2') > C.titleSearchScore(other, exact.slug_url, '2'));
  assert.equal(C.SITE_NAMES[2], 'SlashLib');
  assert.equal(C.SITE_NAMES[4], 'HentaiLib');
});

test('parseReadTarget и originFrom', () => {
  assert.deepEqual(
    C.parseReadTarget('https://mangalib.me/ru/7965--chainsaw-man/read/v2/c15'),
    { volume: '2', number: '15' },
  );
  assert.deepEqual(
    C.parseReadTarget('https://v2.shlib.life/ru/87161--san-da/read/v14/c116'),
    { volume: '14', number: '116' },
  );
  assert.equal(C.originFrom('https://mangalib.org/ru/7965--chainsaw-man'), 'https://mangalib.org');
  assert.equal(C.originFrom('https://v2.shlib.life/ru/manga/87161--san-da'), 'https://v2.shlib.life');
  assert.equal(C.originFrom('7965--chainsaw-man'), 'https://mangalib.me');
  assert.equal(C.originFrom('87161--san-da', C.SITE_PROFILES.slash.defaultOrigin), 'https://v2.shlib.life');
});

test('normalizeChapters: переводы и закрытые ветки', () => {
  const [chapter] = C.normalizeChapters([{
    id: 10,
    volume: '1',
    number: '1',
    name: 'Пёс и бензопила',
    branches_count: 3,
    branches: [
      { id: 100, branch_id: 4666, teams: [{ name: 'Japit Comics' }] },
      { id: 101, branch_id: 4667, teams: [{ name: 'Nippa' }], restricted_view: { is_open: false } },
      { id: 102, branch_id: 4668, user: { username: 'Solo' } },
    ],
  }]);
  assert.equal(chapter.available, true);
  assert.equal(chapter.ambiguous, true);
  assert.equal(chapter.defaultBranchId, '4666');
  assert.equal(chapter.openBranches.length, 2);
  assert.equal(chapter.branches[1].closed, true);

  const [closed] = C.normalizeChapters([{
    id: 11, volume: '1', number: '2', branches_count: 1,
    branches: [{ id: 103, branch_id: 5000, restricted_view: { is_open: false, price: 18 } }],
  }]);
  assert.equal(closed.available, false);
});

test('parseRange: целые и дробные номера глав', () => {
  const chapters = ['1', '1.5', '2', '5', '10'].map((number) => ({ volume: '1', number }));
  assert.deepEqual([...C.parseRange('1-2, 10', chapters)], [0, 1, 2, 4]);
  assert.deepEqual([...C.parseRange('5', chapters)], [3]);
  assert.deepEqual([...C.parseRange('2-1', chapters)].sort(), [0, 1, 2].sort());
  assert.equal(C.parseRange('', chapters).size, chapters.length);
  assert.equal(C.parseRange('мусор', chapters).size, 0);
});

test('joinServerUrl: убирает двойной слеш и кодирует путь', () => {
  assert.equal(
    C.joinServerUrl('https://img3.cdnlibs.org', '//manga/one-piece/chapters/54646/01.jpg'),
    'https://img3.cdnlibs.org/manga/one-piece/chapters/54646/01.jpg',
  );
  assert.equal(
    C.joinServerUrl('https://img3.cdnlibs.org/', '/manga/x/1화_Dfpp.png'),
    'https://img3.cdnlibs.org/manga/x/1%ED%99%94_Dfpp.png',
  );
});

test('sniffImageExt: магия важнее расширения в URL', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(0)]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(20).fill(0)]);
  assert.equal(C.sniffImageExt(jpeg, 'image/png', 'https://x/00.png'), 'jpg');
  assert.equal(C.sniffImageExt(png, '', 'https://x/00.jpg'), 'png');
  assert.equal(C.sniffImageExt(new Uint8Array(20), 'image/webp', 'https://x/00.jpg'), 'webp');
  assert.equal(C.sniffImageExt(new Uint8Array(20), '', 'https://x/00.gif'), 'gif');
  assert.equal(C.mimeForExt('jpg'), 'image/jpeg');
});

test('sanitizeComponent и padNumber', () => {
  assert.equal(C.sanitizeComponent('  A/B:C*?  '), 'A_B_C');
  assert.equal(C.sanitizeComponent('CON'), '_CON');
  assert.equal(C.padNumber('12.5', 4), '0012.5');
  assert.equal(C.padNumber('7', 2), '07');
});

test('buildComicInfo экранирует XML и поддерживает общий архив', () => {
  const xml = C.buildComicInfo({
    title: 'Общий <архив>',
    chapterName: 'A & <B>',
    series: 'X"Y',
    pageCount: 3,
    summary: '0001-0002\tГлава & <1>',
  });
  assert.match(xml, /<Title>Общий &lt;архив&gt;<\/Title>/);
  assert.match(xml, /X&quot;Y/);
  assert.match(xml, /<PageCount>3<\/PageCount>/);
  assert.match(xml, /<Summary>0001-0002\tГлава &amp; &lt;1&gt;<\/Summary>/);
});

test('buildZipBytes: вложенный CBZ внутри общего ZIP', async () => {
  const inner = C.buildZipBytes([
    { name: '001.jpg', data: enc.encode('PAGE') },
    { name: 'ComicInfo.xml', data: enc.encode('<ComicInfo/>') },
  ]);
  assert.ok(inner instanceof Uint8Array);
  const outer = C.buildZipBytes([
    { name: 'глава 1.cbz', data: inner },
    { name: 'chapters.txt', data: enc.encode('0001-0001\tт01 гл0001') },
  ]);
  assert.equal(C.buildZip([{ name: 'x', data: enc.encode('x') }], { type: 'application/zip' }).type, 'application/zip');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-batch-test-'));
  const archive = path.join(dir, 'batch.zip');
  fs.writeFileSync(archive, outer);
  try {
    const output = (await import('node:child_process')).execFileSync('python3', [
      '-c',
      'import sys,zipfile,io; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print("\\n".join(z.namelist())); i=zipfile.ZipFile(io.BytesIO(z.read("глава 1.cbz"))); print(i.testzip()); print("\\n".join(i.namelist()))',
      archive,
    ], { encoding: 'utf8' });
    assert.match(output, /^None\n/);
    assert.match(output, /глава 1\.cbz/);
    assert.match(output, /chapters\.txt/);
    assert.match(output, /001\.jpg/);
    assert.match(output, /ComicInfo\.xml/);
  } catch (err) {
    if (err && err.status !== 127) throw err;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('crc32 совпадает с эталоном для "123456789"', () => {
  assert.equal(C.crc32(enc.encode('123456789')), 0xcbf43926);
});

test('buildZip создаёт читаемый STORED-архив с UTF-8 именами', async () => {
  const page = enc.encode('HELLO-MANGA-PAGE');
  const info = enc.encode('<ComicInfo/>');
  const blob = C.buildZip([
    { name: '001.jpg', data: page },
    { name: 'ComicInfo.xml', data: info },
    { name: 'папка/страница.png', data: page },
  ]);
  const buffer = Buffer.from(await blob.arrayBuffer());

  // EOCD и central directory.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  assert.notEqual(eocd, -1);
  assert.equal(buffer.readUInt16LE(eocd + 10), 3);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  assert.equal(buffer.readUInt32LE(centralOffset), 0x02014b50);

  let cursor = centralOffset;
  const names = [];
  for (let i = 0; i < 3; i++) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50);
    assert.equal(buffer.readUint16LE(cursor + 10), 0); // метод 0 = STORED
    assert.equal(buffer.readUint16LE(cursor + 8) & 0x0800, 0x0800); // UTF-8 flag
    const nameLength = buffer.readUint16LE(cursor + 28);
    const extraLength = buffer.readUint16LE(cursor + 30);
    const commentLength = buffer.readUint16LE(cursor + 32);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    names.push(name);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  assert.deepEqual(names, ['001.jpg', 'ComicInfo.xml', 'папка/страница.png']);

  // Дополнительно проверяем файл настоящим unzip/zipfile, если Python доступен.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-core-test-'));
  const cbz = path.join(dir, 'chapter.cbz');
  fs.writeFileSync(cbz, buffer);
  try {
    const output = (await import('node:child_process')).execFileSync(
      'python3',
      ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print("\\n".join(z.namelist()))', cbz],
      { encoding: 'utf8' },
    );
    assert.match(output, /^None\n/);
    assert.match(output, /папка\/страница\.png/);
  } catch (err) {
    // Python может отсутствовать; ручной разбор ZIP выше уже прошёл.
    if (err && err.status !== 127) throw err;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('HentaiLib: профиль, Site-Id 4, origin и заголовки с токеном', () => {
  const site = C.detectSite('https://hentailib.me/ru/manga/123--title');
  assert.equal(site.key, 'hentai');
  assert.equal(site.siteId, '4');
  assert.equal(site.name, 'HentaiLib');
  assert.equal(C.parseSlug('https://hentailib.me/ru/manga/123--title'), '123--title');
  assert.equal(C.parseSlug('https://www.hentailib.org/ru/123--title/read/v1/c2'), '123--title');
  assert.equal(C.originFrom('https://hentailib.me/ru/123--title'), 'https://hentailib.me');
  assert.ok(C.isSupportedHost('hentailib.me'));
  assert.ok(C.isSupportedHost('kz.hentailib.me'));
  assert.equal(C.isSupportedHost('hentailib.example'), false);
  assert.equal(C.profileBySiteId('4').rootFolder, 'HentaiLib');
  assert.equal(C.profileBySiteId('3'), null);
  assert.deepEqual(C.SITE_NAMES[4], 'HentaiLib');
  assert.ok(C.SITE_INITIATOR_DOMAINS.includes('hentailib.me'));
  assert.ok(C.SITE_DNR_DOMAINS.includes('hentailib.me'));
  assert.ok(site.apiBases.includes('https://api.cdnlibs.org/api'));

  const authHosts = site.authHosts;
  const allowed = C.buildApiHeaders({ siteId: '4', token: 'secret-token-1234567890', url: 'https://api.cdnlibs.org/api/manga/x', authHosts });
  assert.equal(allowed.Authorization, 'Bearer secret-token-1234567890');
  assert.equal(allowed['Site-Id'], '4');
  assert.equal(allowed.Accept, 'application/json');
  // Запасные CDN и чужие API токен не получают — он уходил туда при первом же сбое.
  for (const url of ['https://hapi.hentaicdn.org/api/x', 'https://img3.hentaicdn.org/x.jpg', 'https://api2.mangalib.me/api/x']) {
    assert.equal(C.buildApiHeaders({ siteId: '4', token: 'secret', url, authHosts }).Authorization, undefined, url);
  }
  assert.equal(C.buildApiHeaders({ siteId: '1', token: '', url: 'https://api.lib.social/api/x', authHosts: ['api.lib.social'] }).Authorization, undefined);
});

test('метки глав без тома и служебные значения', () => {
  assert.equal(C.padNumber('', 2), '');
  assert.equal(C.padNumber(null, 2), '');
  assert.equal(C.padNumber('7', 2), '07');
  assert.equal(C.chapterLabel({ volume: '', number: '1' }), 'гл0001');
  assert.equal(C.chapterLabel({ volume: '2', number: '15.5' }), 'т02 гл0015.5');
  assert.match(C.buildComicInfo({ pageCount: 1 }), /<Title>Глава<\/Title>/);
  assert.doesNotMatch(C.buildComicInfo({ pageCount: 1 }), /undefined/);
});

test('parseSlug отклоняет не-HTTP схемы', () => {
  assert.equal(C.parseSlug('javascript:alert(1)'), null);
  assert.equal(C.parseSlug('data:text/html,<b>x</b>'), null);
  assert.equal(C.parseSlug('ftp://mangalib.me/ru/1--x'), null);
  assert.equal(C.parseSlug('https://example.com/1--x'), null);
  assert.equal(C.parseSlug('1--x'), '1--x');
});

test('ZIP: части, лимит записей и вложенные имена', () => {
  const parts = C.buildZipParts([
    { name: '001.jpg', data: new Uint8Array([1, 2, 3]) },
    { name: 'ComicInfo.xml', data: '<ComicInfo/>' },
  ]);
  assert.ok(Array.isArray(parts) && parts.length >= 6);
  assert.throws(() => C.buildZipBytes(new Array(C.ZIP_MAX_ENTRIES + 1).fill({ name: 'a', data: 'x' })), /Слишком много файлов/);
  const used = new Set();
  assert.equal(C.uniqueEntryName('глава.cbz', used), 'глава.cbz');
  assert.equal(C.uniqueEntryName('глава.cbz', used), 'глава (2).cbz');
  assert.equal(C.uniqueEntryName('глава.cbz', used), 'глава (3).cbz');
});

test('архивы: папки по главам, плоский, вложенные CBZ и частичная глава', async () => {
  const page = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const chapter = (number, partial) => ({
    files: [{ name: '001.jpg', ext: 'jpg', bytes: page }, { name: '002.jpg', ext: 'jpg', bytes: page }],
    label: C.chapterLabel({ volume: '1', number }),
    base: `Test - ${C.chapterLabel({ volume: '1', number })}${partial ? ' - неполная' : ''}`,
    root: 'HentaiLib',
    series: 'Test',
    chapter: { volume: '1', number },
    branchLabel: 'Team',
    chapterName: `Глава ${number}`,
    source: 'https://hentailib.me/ru/manga/1--test',
    partial: !!partial,
  });
  const chapters = [chapter('1'), chapter('2', true)];
  const range = C.batchRangeLabel(chapters);
  assert.match(range, /гл0001–т01 гл0002 \(2 глав\)/);

  const cases = {
    folded: C.folderedArchiveEntries(chapters, 'Test', range, { stopped: true }),
    flat: C.flatArchiveEntries(chapters, 'Test', range, { stopped: true }),
    nested: C.nestedArchiveEntries(chapters, 'Test', range, { stopped: true }),
  };
  assert.ok(cases.folded.some((f) => f.name === 'ComicInfo.xml'));
  assert.ok(cases.folded.some((f) => /^001 - .*001\.jpg$/.test(f.name)));
  assert.ok(cases.folded.some((f) => /неполная\/002\.jpg$/.test(f.name)));
  assert.ok(cases.flat.some((f) => f.name === '0003.jpg'), 'плоский архив нумерует страницы сквозняком');
  assert.ok(cases.nested.every((f) => f.name !== 'undefined.cbz'));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-archives-'));
  try {
    for (const [name, entries] of Object.entries(cases)) {
      const file = path.join(dir, `${name}.zip`);
      fs.writeFileSync(file, C.buildZipBytes(entries));
      const out = (await import('node:child_process')).execFileSync('python3', [
        '-c',
        'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(len(z.namelist())); print(z.read("chapters.txt").decode())',
        file,
      ], { encoding: 'utf8' });
      assert.match(out, /НЕПОЛНАЯ/, `${name}: неполная глава помечена в chapters.txt`);
      assert.match(out, /Остановлено: да/, `${name}: остановка помечена`);
      if (name === 'nested') {
        const inner = C.buildZipBytes(C.chapterZipFiles(chapters[0]));
        fs.writeFileSync(path.join(dir, 'inner.cbz'), inner);
        const innerOut = (await import('node:child_process')).execFileSync('python3', [
          '-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(",".join(z.namelist()))',
          path.join(dir, 'inner.cbz'),
        ], { encoding: 'utf8' });
        assert.match(innerOut, /001\.jpg,002\.jpg,ComicInfo\.xml/);
      }
    }
  } catch (err) {
    if (err && err.status !== 127) throw err;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
