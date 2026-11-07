/* Lib Chapter Downloader — чистые функции без сетевых вызовов.
 * Используются и в странице расширения, и в Node.js-тестах.
 */
(function (root) {
  'use strict';

  const LOCALES = new Set([
    'ru', 'en', 'uk', 'ja', 'ko', 'zh', 'es', 'de', 'fr', 'pt', 'it', 'tr', 'pl', 'id', 'vi',
  ]);
  const DEFAULT_ORIGIN = 'https://mangalib.me';

  // Два независимых профиля: общий API, но разные Site-Id, API-хосты и CDN.
  const SITE_PROFILES = {
    manga: {
      key: 'manga',
      name: 'MangaLib',
      siteId: '1',
      host: /(?:^|\.)mangalib\.(?:me|org)$/i,
      defaultOrigin: 'https://mangalib.me',
      rootFolder: 'MangaLib',
      apiBases: [
        'https://api.cdnlibs.org/api',
        'https://api.lib.social/api',
        'https://api2.mangalib.me/api',
      ],
      fallbackServers: [
        'https://img3.cdnlibs.org',
        'https://img3.cdnrulib.link',
        'https://img2.imglib.info',
      ],
      // Bearer-токен сайта уходит только на эти хосты (см. buildApiHeaders).
      authHosts: ['api.cdnlibs.org', 'api.lib.social'],
    },
    slash: {
      key: 'slash',
      name: 'SlashLib',
      siteId: '2',
      host: /(?:^|\.)(?:shlib\.life|yaoilib\.net|slashlib\.(?:me|org))$/i,
      defaultOrigin: 'https://v2.shlib.life',
      rootFolder: 'SlashLib',
      apiBases: [
        'https://api.shlib.life/api',
        'https://hapi.hentaicdn.org/api',
        'https://api.cdnlibs.org/api',
        'https://api.lib.social/api',
      ],
      fallbackServers: [
        'https://img3.hentaicdn.org',
        'https://img3.cdnlibs.org',
        'https://img3.cdnrulib.link',
        'https://img2.hentaicdn.org',
      ],
      authHosts: ['api.shlib.life', 'api.cdnlibs.org', 'api.lib.social'],
    },
    hentai: {
      key: 'hentai',
      name: 'HentaiLib',
      // Тот же бэкенд, что у MangaLib; отличаются только Site-Id, origin и CDN.
      siteId: '4',
      host: /(?:^|\.)hentailib\.(?:me|org)$/i,
      defaultOrigin: 'https://hentailib.me',
      rootFolder: 'HentaiLib',
      apiBases: [
        'https://api.cdnlibs.org/api',
        'https://api.lib.social/api',
        'https://api2.mangalib.me/api',
      ],
      fallbackServers: [
        'https://img3.hentaicdn.org',
        'https://img3.cdnlibs.org',
        'https://img3.cdnrulib.link',
        'https://img2.hentaicdn.org',
      ],
      authHosts: ['api.cdnlibs.org', 'api.lib.social'],
    },
  };
  const SITE_NAMES = {
    1: 'MangaLib',
    2: 'SlashLib',
    3: 'RanobeLib',
    4: 'HentaiLib',
    5: 'AnimeLib',
  };
  const SITE_INITIATOR_DOMAINS = [
    'mangalib.me', 'www.mangalib.me', 'mangalib.org', 'www.mangalib.org',
    'shlib.life', 'v2.shlib.life', 'www.shlib.life', 'v1.shlib.life',
    'yaoilib.net', 'v1.yaoilib.net', 'www.yaoilib.net',
    'slashlib.me', 'www.slashlib.me', 'slashlib.org', 'www.slashlib.org',
    'hentailib.me', 'www.hentailib.me', 'hentailib.org', 'www.hentailib.org',
  ];
  const SITE_DNR_DOMAINS = [
    'mangalib.me', 'mangalib.org', 'cdnlibs.org', 'lib.social', 'imglib.info',
    'cdnrulib.link', 'shlib.life', 'hentaicdn.org', 'hentailib.me', 'hentailib.org',
    'api.shlib.life', 'api2.mangalib.me', 'hapi.hentaicdn.org',
    'img2.hentaicdn.org', 'img3.hentaicdn.org',
  ];
  const MIME_BY_EXT = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    avif: 'image/avif',
    gif: 'image/gif',
    bmp: 'image/bmp',
  };
  const EXT_BY_MIME = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
  };
  const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

  function detectSite(input) {
    let hostname = '';
    try { hostname = new URL(String(input || '').trim()).hostname; } catch (_) { return null; }
    for (const site of Object.values(SITE_PROFILES)) {
      if (site.host.test(hostname)) return { ...site };
    }
    return null;
  }

  // Профиль по числовому Site-Id: нужен после 404-фолбэка, когда API нашёл тайтл
  // на соседнем сайте сети. Для 3/5 профиля нет — это текстовые/аниме-сайты.
  function profileBySiteId(siteId) {
    const id = String(siteId ?? '');
    const found = Object.values(SITE_PROFILES).find((site) => site.siteId === id);
    return found ? { ...found } : null;
  }

  // Заголовки запроса к API. Токен пользователя отправляется только на хосты,
  // перечисленные в profile.authHosts: запасные CDN и чужие API его не получают.
  function buildApiHeaders(options) {
    const o = options || {};
    const headers = {
      Accept: 'application/json',
      'Site-Id': String(o.siteId != null ? o.siteId : ''),
    };
    const authHosts = Array.isArray(o.authHosts) ? o.authHosts : [];
    let host = '';
    try { host = new URL(String(o.url || '')).hostname; } catch (_) { host = ''; }
    if (o.token && host && authHosts.includes(host)) headers.Authorization = `Bearer ${o.token}`;
    return headers;
  }

  function isSupportedHost(hostname) {
    const value = String(hostname || '');
    return Object.values(SITE_PROFILES).some((site) => site.host.test(value));
  }

  // Старое имя оставлено как алиас для обратной совместимости.
  function isMangaLibHost(hostname) {
    return isSupportedHost(hostname);
  }

  function originFrom(input, fallback) {
    const fallbackOrigin = fallback || DEFAULT_ORIGIN;
    try {
      const url = new URL(String(input || '').trim());
      if (url.protocol === 'https:' && isSupportedHost(url.hostname)) return url.origin;
    } catch (_) { /* это может быть голый slug */ }
    return fallbackOrigin;
  }

  function parseSlug(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    try {
      const url = new URL(raw);
      // Схема важна: javascript:/data:/ftp: не должны превращаться в slug.
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      if (!isSupportedHost(url.hostname)) return null;
      const parts = url.pathname.split('/').filter(Boolean).map((part) => {
        try { return decodeURIComponent(part); } catch (_) { return part; }
      });
      const withId = parts.find((part) => /^\d+--[A-Za-z0-9_.-]+$/.test(part));
      if (withId) return withId;
      const mangaIndex = parts.indexOf('manga');
      if (mangaIndex >= 0 && parts[mangaIndex + 1]) return parts[mangaIndex + 1];
      const candidate = parts.find((part) => !LOCALES.has(part.toLowerCase()) && !/^(read|chapter|chapters|v\d+|c[\d.]+)$/i.test(part));
      return candidate || null;
    } catch (_) {
      // Разрешаем вручную ввести только сам slug вида "7965--chainsaw-man".
      if (/^[\w%.-]+--[\w%.-]+$/.test(raw) && !/[\/\\:]/.test(raw)) return raw;
      return null;
    }
  }

  function parseReadTarget(input) {
    const match = String(input || '').match(/\/read\/v([^/?#]+)\/c([^/?#]+)/i);
    if (!match) return null;
    try {
      return { volume: decodeURIComponent(match[1]), number: decodeURIComponent(match[2]) };
    } catch (_) {
      return { volume: match[1], number: match[2] };
    }
  }

  function slugToSearchQueries(slug) {
    const text = String(slug || '')
      .replace(/^\d+--/, '')
      .replace(/[-_]+/g, ' ')
      .trim()
      .toLowerCase();
    if (!text) return [];
    const words = text.split(/\s+/).filter(Boolean);
    const queries = [text];
    for (const count of [4, 3, 2, 1]) {
      if (words.length >= count) queries.push(words.slice(0, count).join(' '));
    }
    if (words.length >= 3) queries.push(words.slice(-2).join(' '));
    if (words.length >= 4) queries.push(words.slice(1, 4).join(' '));
    return [...new Set(queries)].slice(0, 6);
  }

  function titleSearchScore(item, slug, currentSiteId) {
    const plain = String(slug || '').replace(/^\d+--/, '').toLowerCase();
    const words = plain.split(/[-_\s]+/).filter(Boolean);
    const haystack = [item && item.rus_name, item && item.name, item && item.eng_name, item && item.slug, item && item.slug_url]
      .filter(Boolean).join(' ').toLowerCase();
    let score = 0;
    if (item && item.slug_url === slug) score += 100;
    if (item && item.slug === plain) score += 60;
    for (const word of words) if (haystack.includes(word)) score += 4;
    if (item && Number(item.site) === Number(currentSiteId)) score += 10;
    if (item && (Number(item.site) === 1 || Number(item.site) === 2)) score += 2;
    return score;
  }

  function toNumber(value) {
    const n = Number.parseFloat(String(value ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  function sanitizeComponent(name, max) {
    const limit = Math.max(1, Number(max) || 90);
    let s = String(name ?? '')
      /* eslint-disable-next-line no-control-regex */
      .replace(/[\\/:*?"<>|\u0000-\u001f#%]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/_+/g, '_')
      .replace(/^[_.\s]+|[_.\s]+$/g, '')
      .slice(0, limit)
      .replace(/[_.\s]+$/g, '');
    if (!s || WINDOWS_RESERVED.test(s)) s = `_${s || 'manga'}`;
    return s;
  }

  function padNumber(value, width) {
    const w = Math.max(1, Number(width) || 4);
    const text = String(value ?? '').trim();
    // Пустой том — это «тома нет», а не «_manga»: такой ярлык попадал в имена папок.
    if (!text) return '';
    const parts = text.split('.');
    if (!/^\d+$/.test(parts[0])) return sanitizeComponent(text, 32);
    const head = parts[0].padStart(w, '0');
    return parts.length > 1 ? `${head}.${parts.slice(1).join('.')}` : head;
  }

  function branchLabel(branch) {
    if (!branch) return 'Перевод по умолчанию';
    const teams = Array.isArray(branch.teams)
      ? branch.teams.map((team) => team && team.name).filter(Boolean)
      : [];
    if (teams.length) return teams.join(', ');
    if (branch.user && branch.user.username) return String(branch.user.username);
    return 'Без команды';
  }

  function normalizeChapter(raw, index) {
    const branches = (Array.isArray(raw.branches) && raw.branches.length
      ? raw.branches
      : [{ id: raw.id, branch_id: null }]).map((branch, i) => {
      const restricted = branch.restricted_view;
      const stable = branch.branch_id != null && branch.branch_id !== '' ? String(branch.branch_id) : null;
      const id = branch.id != null ? String(branch.id) : String(i + 1);
      return {
        id,
        stableBranchId: stable,
        selectorId: stable || id,
        label: branchLabel(branch),
        closed: !!(restricted && restricted.is_open === false),
        createdAt: branch.created_at || null,
      };
    });
    const openBranches = branches.filter((branch) => !branch.closed);
    const chapterRestricted = !!(raw.restricted_view && raw.restricted_view.is_open === false);
    const hasExplicitlyOpenBranch = (Array.isArray(raw.branches) ? raw.branches : [])
      .some((branch) => branch && branch.restricted_view && branch.restricted_view.is_open === true);
    // Если restricted_view висит на всей главе, доверяем только явно открытой ветке.
    const available = openBranches.length > 0 && (!chapterRestricted || hasExplicitlyOpenBranch);
    const ambiguous = Number(raw.branches_count) > 1 || openBranches.length > 1;
    const firstOpen = openBranches[0] || branches[0];
    return {
      id: raw.id != null ? String(raw.id) : String(index + 1),
      index: Number.isFinite(Number(raw.index)) ? Number(raw.index) : index + 1,
      volume: String(raw.volume ?? ''),
      number: String(raw.number ?? ''),
      name: String(raw.name || ''),
      branchesCount: Number(raw.branches_count) || branches.length,
      branches,
      openBranches,
      ambiguous,
      defaultBranchId: ambiguous && firstOpen ? firstOpen.selectorId : null,
      available,
    };
  }

  function normalizeChapters(list) {
    return (Array.isArray(list) ? list : []).map(normalizeChapter);
  }

  function chapterLabel(chapter) {
    const volume = padNumber(chapter.volume, 2);
    const number = padNumber(chapter.number, 4);
    return volume ? `т${volume} гл${number}` : `гл${number}`;
  }

  function findChapterIndex(chapters, target) {
    if (!target) return -1;
    return chapters.findIndex((chapter) => String(chapter.volume) === String(target.volume)
      && String(chapter.number) === String(target.number));
  }

  function parseRange(input, chapters) {
    const text = String(input || '').trim().toLowerCase();
    if (!text || text === 'all' || text === '*' || text === 'все') {
      return new Set(chapters.map((_, i) => i));
    }
    const selected = new Set();
    for (const token of text.split(/[,;\s]+/).filter(Boolean)) {
      const match = token.match(/^(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?$/);
      if (!match) continue;
      let from = Number.parseFloat(match[1]);
      let to = match[2] === undefined ? from : Number.parseFloat(match[2]);
      if (to < from) [from, to] = [to, from];
      chapters.forEach((chapter, i) => {
        const number = toNumber(chapter.number);
        if (number !== null && number >= from - 1e-9 && number <= to + 1e-9) selected.add(i);
      });
    }
    return selected;
  }

  function joinServerUrl(server, relative) {
    const rel = String(relative || '');
    if (/^https?:\/\//i.test(rel)) return rel;
    const base = String(server || '').replace(/\/+$/, '') + '/';
    return new URL(rel.replace(/^\/+/, ''), base).href;
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function ascii(bytes, from, to) {
    let s = '';
    for (let i = from; i < to && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  function imageExtFromBytes(bytes) {
    const b = bytes;
    if (!b || b.length < 12) return null;
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
    if (b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return 'png';
    if (ascii(b, 0, 3) === 'GIF') return 'gif';
    if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
    if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
    if (ascii(b, 4, 8) === 'ftyp' && /^(avif|avis)$/.test(ascii(b, 8, 12))) return 'avif';
    return null;
  }

  function sniffImageExt(bytes, contentType, url) {
    const magic = imageExtFromBytes(bytes);
    if (magic) return magic;
    const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
    if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime];
    const match = String(url || '').split(/[?#]/)[0].match(/\.(jpe?g|png|webp|avif|gif|bmp)$/i);
    if (match) return match[1].toLowerCase().replace('jpeg', 'jpg');
    return 'jpg';
  }

  function mimeForExt(ext) {
    return MIME_BY_EXT[String(ext || '').toLowerCase()] || 'application/octet-stream';
  }

  function xmlEscape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function buildComicInfo(options) {
    const o = options || {};
    const chapterNumber = o.chapterNumber == null ? '' : String(o.chapterNumber).trim();
    const title = o.title || o.chapterName || (chapterNumber ? `Глава ${chapterNumber}` : 'Глава');
    const lines = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
      `  <Title>${xmlEscape(title)}</Title>`,
      `  <Series>${xmlEscape(o.series || '')}</Series>`,
      `  <Volume>${xmlEscape(o.volume || '')}</Volume>`,
      `  <Number>${xmlEscape(chapterNumber)}</Number>`,
      `  <Writer>${xmlEscape(o.translation || '')}</Writer>`,
      `  <PageCount>${Number(o.pageCount) || 0}</PageCount>`,
      '  <LanguageISO>ru</LanguageISO>',
      `  <ScanInformation>${xmlEscape(o.source || 'MangaLib')}</ScanInformation>`,
    ];
    if (o.summary) lines.push(`  <Summary>${xmlEscape(o.summary)}</Summary>`);
    lines.push('</ComicInfo>');
    return lines.join('\n') + '\n';
  }

  // ---- ZIP (STORED): JPEG/PNG/WebP уже сжаты, повторное сжатие только тратит CPU. ----
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  function asBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (typeof value === 'string') return new TextEncoder().encode(value);
    return new Uint8Array(value || []);
  }

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  // ZIP32: больше 65535 записей или 4 ГиБ адресного пространства формат не описывает.
  const ZIP_MAX_ENTRIES = 0xffff;
  const ZIP_MAX_BYTES = 0xffffffff;

  // Части ZIP без склейки: Blob собирается из них напрямую, лишняя полная копия не нужна.
  function buildZipParts(files) {
    if (files.length > ZIP_MAX_ENTRIES) {
      throw new Error(`Слишком много файлов для ZIP: ${files.length} (максимум ${ZIP_MAX_ENTRIES}). Качайте частями.`);
    }
    const encoder = new TextEncoder();
    const { time, date } = dosDateTime(new Date());
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
      const name = encoder.encode(String(file.name));
      const data = asBytes(file.data);
      const size = data.length;
      const crc = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 в именах файлов
      local.setUint16(8, 0, true);      // без сжатия
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, size, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      localParts.push(new Uint8Array(local.buffer), name, data);

      const central = new DataView(new ArrayBuffer(46));
      central.setUint32(0, 0x02014b50, true);
      central.setUint16(4, 20, true);
      central.setUint16(6, 20, true);
      central.setUint16(8, 0x0800, true);
      central.setUint16(10, 0, true);
      central.setUint16(12, time, true);
      central.setUint16(14, date, true);
      central.setUint32(16, crc, true);
      central.setUint32(20, size, true);
      central.setUint32(24, size, true);
      central.setUint16(28, name.length, true);
      central.setUint16(30, 0, true);
      central.setUint16(32, 0, true);
      central.setUint16(34, 0, true);
      central.setUint16(36, 0, true);
      central.setUint32(38, 0, true);
      central.setUint32(42, offset, true);
      centralParts.push(new Uint8Array(central.buffer), name);

      offset += 30 + name.length + size;
      if (offset > ZIP_MAX_BYTES) {
        throw new Error('Архив больше 4 ГиБ: формат ZIP32 не поддерживает такие размеры. Качайте частями.');
      }
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    return [...localParts, ...centralParts, new Uint8Array(end.buffer)];
  }

  // Байты ZIP без обёртки в Blob: нужны, чтобы положить CBZ глав внутрь общего ZIP.
  function buildZipBytes(files) {
    return concatBytes(buildZipParts(files));
  }

  function buildZip(files, options) {
    const type = (options && options.type) || 'application/vnd.comicbook+zip';
    return new Blob(buildZipParts(files), { type });
  }

  function titleName(data, fallback) {
    const d = (data && data.data && typeof data.data === 'object') ? data.data : (data || {});
    return String(d.rus_name || d.name || d.eng_name || fallback || 'Манга').trim();
  }


  // ---- Наборы файлов для архивов. Чистые функции: их проверяют тесты, а не UI. ----

  function chapterZipFiles(chapterData) {
    const files = chapterData.files.map((file) => ({ name: file.name, data: file.bytes }));
    files.push({
      name: 'ComicInfo.xml',
      data: new TextEncoder().encode(buildComicInfo({
        chapterName: chapterData.partial ? `${chapterData.chapterName} (неполная)` : chapterData.chapterName,
        series: chapterData.series,
        volume: chapterData.chapter.volume,
        chapterNumber: chapterData.chapter.number,
        translation: chapterData.branchLabel,
        pageCount: chapterData.files.length,
        source: chapterData.source,
      })),
    });
    return files;
  }

  // Переиндексация страниц неполной главы: дыр в нумерации быть не должно.
  function reindexFiles(files) {
    const width = Math.max(3, String(files.length).length);
    return files.map((file, index) => ({
      ...file,
      name: `${String(index + 1).padStart(width, '0')}.${file.ext}`,
    }));
  }

  function sortedPages(pages) {
    return pages.map((page, index) => ({ page, index })).sort((a, b) => {
      const an = Number(a.page.slug);
      const bn = Number(b.page.slug);
      if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
      return a.index - b.index;
    }).map((entry) => entry.page);
  }

  function batchRangeLabel(chapters) {
    const first = chapters[0].label;
    const last = chapters[chapters.length - 1].label;
    return chapters.length === 1 ? first : `${first}–${last} (${chapters.length} глав)`;
  }

  // Одинаковые имена после обрезки до 90–110 символов не должны перетирать друг друга.
  function uniqueEntryName(name, used) {
    let unique = name;
    let counter = 2;
    while (used.has(unique)) {
      const dot = name.lastIndexOf('.');
      unique = dot > 0
        ? `${name.slice(0, dot)} (${counter++}).${name.slice(dot + 1)}`
        : `${name} (${counter++})`;
    }
    used.add(unique);
    return unique;
  }

  function archiveWriters(chapters) {
    return [...new Set(chapters.map((chapterData) => chapterData.branchLabel).filter(Boolean))].join('; ');
  }

  // Общий том для ComicInfo: если главы из разных томов, поле остаётся пустым.
  function sharedVolume(chapters) {
    const volumes = [...new Set(chapters.map((chapterData) => String(chapterData.chapter.volume ?? '')))];
    return volumes.length === 1 ? volumes[0] : '';
  }

  function batchComicInfo(chapters, series, range, meta, extra) {
    const o = extra || {};
    return buildComicInfo({
      title: `${series} — ${range}${meta.stopped ? ' (остановлено)' : ''}`,
      series,
      volume: sharedVolume(chapters),
      chapterNumber: chapters[0] ? chapters[0].chapter.number : '',
      translation: archiveWriters(chapters),
      pageCount: o.pageCount || 0,
      source: chapters[0] ? chapters[0].source : '',
      summary: o.summary || '',
    });
  }

  function flatArchiveEntries(chapters, series, range, meta) {
    const options = meta || {};
    const encoder = new TextEncoder();
    const total = chapters.reduce((sum, chapterData) => sum + chapterData.files.length, 0);
    const width = Math.max(4, String(total).length);
    const entries = [];
    const partialCount = chapters.filter((chapterData) => chapterData.partial).length;
    const header = [
      series,
      `Диапазон: ${range}`,
      `Глав: ${chapters.length}`,
      `Остановлено: ${options.stopped ? 'да' : 'нет'}`,
      `Неполных глав: ${partialCount}`,
      '',
    ];
    let page = 0;

    for (const chapterData of chapters) {
      const start = page + 1;
      for (const file of chapterData.files) {
        page += 1;
        entries.push({ name: `${String(page).padStart(width, '0')}.${file.ext}`, data: file.bytes });
      }
      const flag = chapterData.partial ? '\tНЕПОЛНАЯ' : '';
      header.push(`${String(start).padStart(width, '0')}-${String(page).padStart(width, '0')}\t${chapterData.label}\t${chapterData.chapterName}\t${chapterData.branchLabel}${flag}`);
    }

    entries.push({ name: 'chapters.txt', data: encoder.encode(header.join('\n') + '\n') });
    entries.push({
      name: 'ComicInfo.xml',
      data: encoder.encode(batchComicInfo(chapters, series, range, options, {
        pageCount: page,
        summary: header.slice(6).join('\n'),
      })),
    });
    return entries;
  }

  function folderedArchiveEntries(chapters, series, range, meta) {
    const options = meta || {};
    const encoder = new TextEncoder();
    const total = chapters.reduce((sum, chapterData) => sum + chapterData.files.length, 0);
    const partialCount = chapters.filter((chapterData) => chapterData.partial).length;
    const header = [
      series,
      `Диапазон: ${range}`,
      `Глав: ${chapters.length}`,
      `Остановлено: ${options.stopped ? 'да' : 'нет'}`,
      `Неполных глав: ${partialCount}`,
      'Структура: одна папка на главу, внутри страницы и ComicInfo.xml',
      '',
    ];
    const lines = [...header];
    const body = [];
    const usedFolders = new Set();

    chapters.forEach((chapterData, index) => {
      const order = String(index + 1).padStart(3, '0');
      const chapterTitle = chapterData.chapterName ? ` - ${chapterData.chapterName}` : '';
      const partialSuffix = chapterData.partial ? ' - неполная' : '';
      const wanted = sanitizeComponent(`${order} - ${chapterData.label}${chapterTitle}${partialSuffix}`, 100);
      let folder = wanted;
      let counter = 2;
      while (usedFolders.has(folder)) folder = `${wanted} (${counter++})`;
      usedFolders.add(folder);

      for (const file of chapterZipFiles(chapterData)) {
        body.push({ name: `${folder}/${file.name}`, data: file.data });
      }
      const flag = chapterData.partial ? '\tНЕПОЛНАЯ' : '';
      lines.push(`${folder}/\t${chapterData.label}\tстраниц: ${chapterData.files.length}\tперевод: ${chapterData.branchLabel}${flag}`);
    });

    const info = batchComicInfo(chapters, series, range, options, {
      pageCount: total,
      summary: lines.slice(header.length).join('\n'),
    });
    return [
      { name: 'ComicInfo.xml', data: encoder.encode(info) },
      { name: 'chapters.txt', data: encoder.encode(lines.join('\n') + '\n') },
      ...body,
    ];
  }

  function nestedArchiveEntries(chapters, series, range, meta) {
    const options = meta || {};
    const encoder = new TextEncoder();
    const entries = [];
    const used = new Set();
    const partialCount = chapters.filter((chapterData) => chapterData.partial).length;
    const lines = [
      series,
      `Диапазон: ${range}`,
      `Глав: ${chapters.length}`,
      `Остановлено: ${options.stopped ? 'да' : 'нет'}`,
      `Неполных глав: ${partialCount}`,
      '',
    ];
    for (const chapterData of chapters) {
      const name = uniqueEntryName(`${sanitizeComponent(chapterData.base, 90)}.cbz`, used);
      entries.push({ name, data: buildZipBytes(chapterZipFiles(chapterData)) });
      const flag = chapterData.partial ? '\tНЕПОЛНАЯ' : '';
      lines.push(`${name}\t${chapterData.label}\tстраниц: ${chapterData.files.length}\tперевод: ${chapterData.branchLabel}${flag}`);
    }
    entries.push({ name: 'chapters.txt', data: encoder.encode(lines.join('\n') + '\n') });
    return entries;
  }

  const api = {
    DEFAULT_ORIGIN,
    LOCALES,
    SITE_PROFILES,
    SITE_NAMES,
    SITE_INITIATOR_DOMAINS,
    SITE_DNR_DOMAINS,
    MIME_BY_EXT,
    EXT_BY_MIME,
    detectSite,
    isSupportedHost,
    isMangaLibHost,
    originFrom,
    parseSlug,
    parseReadTarget,
    slugToSearchQueries,
    titleSearchScore,
    toNumber,
    sanitizeComponent,
    padNumber,
    branchLabel,
    normalizeChapter,
    normalizeChapters,
    chapterLabel,
    findChapterIndex,
    parseRange,
    joinServerUrl,
    unique,
    imageExtFromBytes,
    sniffImageExt,
    mimeForExt,
    xmlEscape,
    buildComicInfo,
    crc32,
    ZIP_MAX_ENTRIES,
    buildZipParts,
    buildZipBytes,
    buildZip,
    titleName,
    profileBySiteId,
    buildApiHeaders,
    chapterZipFiles,
    reindexFiles,
    sortedPages,
    batchRangeLabel,
    uniqueEntryName,
    flatArchiveEntries,
    folderedArchiveEntries,
    nestedArchiveEntries,
  };

  // always publish: background.js импортирует этот файл как ES-модуль и берёт MLCore
  root.MLCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
