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
  ];
  const SITE_DNR_DOMAINS = [
    'mangalib.me', 'mangalib.org', 'cdnlibs.org', 'lib.social', 'imglib.info',
    'cdnrulib.link', 'shlib.life', 'hentaicdn.org',
    'api.shlib.life', 'hapi.hentaicdn.org', 'img2.hentaicdn.org', 'img3.hentaicdn.org',
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
      if (!isSupportedHost(url.hostname) && url.protocol.startsWith('http')) return null;
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
      if (/^[\w%.-]+--[\w%.-]+$/.test(raw) && !/[\/\\]/.test(raw)) return raw;
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
    return `т${padNumber(chapter.volume, 2)} гл${padNumber(chapter.number, 4)}`;
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
    const title = o.title || o.chapterName || `Глава ${o.chapterNumber}`;
    const lines = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
      `  <Title>${xmlEscape(title)}</Title>`,
      `  <Series>${xmlEscape(o.series || '')}</Series>`,
      `  <Volume>${xmlEscape(o.volume || '')}</Volume>`,
      `  <Number>${xmlEscape(o.chapterNumber || '')}</Number>`,
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

  // Байты ZIP без обёртки в Blob: нужны, чтобы положить CBZ глав внутрь общего ZIP.
  function buildZipBytes(files) {
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
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    return concatBytes([...localParts, ...centralParts, new Uint8Array(end.buffer)]);
  }

  function buildZip(files, options) {
    const type = (options && options.type) || 'application/vnd.comicbook+zip';
    return new Blob([buildZipBytes(files)], { type });
  }

  function titleName(data, fallback) {
    const d = (data && data.data && typeof data.data === 'object') ? data.data : (data || {});
    return String(d.rus_name || d.name || d.eng_name || fallback || 'Манга').trim();
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
    buildZipBytes,
    buildZip,
    titleName,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MLCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
