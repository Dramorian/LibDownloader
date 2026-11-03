/* Lib Chapter Downloader — интерфейс и загрузка.
 * Manifest V3, без внешних зависимостей. Публичные главы только.
 */
'use strict';

const C = globalThis.MLCore;
if (!C) throw new Error('core.js не загружен');

const SERVER_PRIORITY = ['compress', 'download', 'secondary', 'main'];
const SPEEDS = {
  gentle: { concurrency: 2, delay: 300, chapterPause: 1200 },
  normal: { concurrency: 3, delay: 150, chapterPause: 700 },
  fast: { concurrency: 5, delay: 50, chapterPause: 300 },
};
const RULE_ID = 1;
const initialSite = { ...C.SITE_PROFILES.manga };

const state = {
  sourceUrl: '',
  sourceTabId: null,
  bridgeTabId: null,
  bridgeUnavailable: false,
  site: initialSite,
  siteKey: initialSite.key,
  siteId: initialSite.siteId,
  authToken: null,
  siteName: initialSite.name,
  origin: initialSite.defaultOrigin,
  rootFolder: initialSite.rootFolder,
  apiBases: [...initialSite.apiBases],
  fallbackServers: [...initialSite.fallbackServers],
  slug: '',
  title: '',
  chapters: [],
  chapterRows: [],
  servers: [...initialSite.fallbackServers],
  serversLoaded: false,
  apiBase: null,
  running: false,
  controller: null,
  accessPromise: null,
  lastCheckedIndex: null,
  lastCheckedState: true,
  readTarget: null,
  loadId: 0,
};

function makeApiHeaders(siteId) {
  const headers = { Accept: 'application/json', 'Site-Id': String(siteId ?? state.siteId) };
  // Некоторые 18+ тайтлы доступны только авторизованному пользователю.
  // Токен читается из localStorage открытой вкладки сайта и никуда не сохраняется.
  if (state.authToken) headers.Authorization = `Bearer ${state.authToken}`;
  return headers;
}

function apiHeaders() {
  return makeApiHeaders(state.siteId);
}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const dom = {
  form: $('#source-form'),
  url: $('#source-url'),
  siteSelect: $('#site-select'),
  load: $('#load-btn'),
  status: $('#status'),
  siteBadge: $('#site-badge'),
  apiHost: $('#api-host'),
  sourceLink: $('#source-link'),
  titleCard: $('#title-card'),
  suggestions: $('#suggestions'),
  titleName: $('#title-name'),
  titleSlug: $('#title-slug'),
  chapterCount: $('#chapter-count'),
  closedCount: $('#closed-count'),
  workspace: $('#workspace'),
  format: $('#format'),
  speed: $('#speed'),
  root: $('#root-folder'),
  filter: $('#filter'),
  range: $('#range'),
  applyRange: $('#apply-range'),
  selectAll: $('#select-all'),
  selectNone: $('#select-none'),
  selectedCount: $('#selected-count'),
  list: $('#chapter-list'),
  start: $('#start-btn'),
  stop: $('#stop-btn'),
  rules: $('#rules-btn'),
  progress: $('#progress'),
  overallText: $('#overall-text'),
  overallProgress: $('#overall-progress'),
  currentText: $('#current-text'),
  pageProgress: $('#page-progress'),
  log: $('#log'),
};

class ApiError extends Error {
  constructor(message, status, retryable, retryAfter) {
    super(message);
    this.name = 'ApiError';
    this.status = Number(status) || 0;
    this.retryable = !!retryable;
    this.retryAfter = Number(retryAfter) || 0;
  }
}

function abortError() {
  const err = new Error('Остановлено пользователем');
  err.name = 'AbortError';
  return err;
}

function isAbort(err) {
  return !!err && (err.name === 'AbortError' || !!(state.controller && state.controller.signal.aborted));
}

function humanError(err) {
  if (!err) return 'Неизвестная ошибка';
  if (err instanceof ApiError) {
    const code = err.status ? ` (HTTP ${err.status})` : '';
    return `${err.message}${code}`;
  }
  return String(err.message || err);
}

function setStatus(text, kind) {
  dom.status.textContent = text;
  dom.status.className = `status${kind ? ` ${kind}` : ''}`;
}

function addLog(text, kind) {
  const li = document.createElement('li');
  if (kind) li.className = kind;
  li.textContent = text;
  dom.log.append(li);
  while (dom.log.children.length > 200) dom.log.firstElementChild.remove();
  dom.log.scrollTop = dom.log.scrollHeight;
}

function shortText(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, Number(ms) || 0));
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

function titleFromSlug(slug) {
  const words = String(slug).replace(/^\d+--/, '').replace(/[_-]+/g, ' ').trim();
  return words ? words.replace(/\b\p{L}/gu, (ch) => ch.toUpperCase()) : slug;
}

function updateApiHost() {
  if (!state.apiBase) {
    dom.apiHost.textContent = 'API: —';
    return;
  }
  try {
    dom.apiHost.textContent = `API: ${new URL(state.apiBase).hostname}`;
  } catch (_) {
    dom.apiHost.textContent = 'API: —';
  }
}

function updateSiteBadge() {
  dom.siteBadge.textContent = `Сайт: ${state.siteName}, Site-Id ${state.siteId}`;
}

function updateTitleCard() {
  dom.titleName.textContent = state.title || state.slug;
  dom.titleSlug.textContent = state.slug;
  dom.chapterCount.textContent = `Глав: ${state.chapters.length}`;
  const closed = state.chapters.filter((chapter) => !chapter.available).length;
  dom.closedCount.hidden = closed === 0;
  dom.closedCount.textContent = `Закрыто: ${closed}`;
  dom.titleCard.hidden = false;
}

function setRunning(running) {
  state.running = running;
  dom.start.disabled = running;
  dom.stop.disabled = !running;
  dom.load.disabled = running;
  dom.rules.disabled = running;
  dom.url.disabled = running;
  dom.siteSelect.disabled = running;
  dom.format.disabled = running;
  dom.speed.disabled = running;
  dom.root.disabled = running;
  dom.progress.hidden = !running;
}

// ---------- Доступы и Referer ----------

function allOrigins() {
  const values = [...state.apiBases, ...state.servers, state.origin];
  return C.unique(values.map((value) => {
    try { return new URL(value).origin + '/*'; } catch (_) { return null; }
  }));
}

function dnrDomains() {
  const hosts = [...C.SITE_DNR_DOMAINS];
  for (const value of [...state.apiBases, ...state.servers, state.origin]) {
    try {
      const hostname = new URL(value).hostname;
      hosts.push(hostname);
      const labels = hostname.split('.');
      if (labels.length >= 2) hosts.push(labels.slice(-2).join('.'));
      if (labels.length >= 3) hosts.push(labels.slice(-3).join('.'));
    } catch (_) { /* строку не удалось разобрать */ }
  }
  return C.unique(hosts);
}

function buildRefererRule() {
  return {
    id: RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'referer', operation: 'set', value: `${state.origin}/` }],
    },
    condition: {
      initiatorDomains: C.unique([
        chrome.runtime.id,
        ...C.SITE_INITIATOR_DOMAINS,
        (() => { try { return new URL(state.origin).hostname; } catch (_) { return null; } })(),
      ]),
      requestDomains: dnrDomains(),
      resourceTypes: ['xmlhttprequest', 'image', 'other'],
    },
  };
}

async function ensureRefererRules() {
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateDynamicRules) return;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [RULE_ID],
    addRules: [buildRefererRule()],
  });
}

// Вызывается строго из обработчика клика: permissions.request требует user gesture.
function requestHostAccess() {
  if (!chrome.permissions || !chrome.permissions.request) {
    state.accessPromise = Promise.resolve(true);
    return;
  }
  const origins = allOrigins();
  state.accessPromise = chrome.permissions.request({ origins }).then((granted) => {
    if (!granted) throw new Error('Нужно разрешить доступ к API и серверам изображений.');
    return true;
  });
  // Чтобы отклонение не стало unhandled rejection, если доступ запрашивали кнопкой "Обновить CDN".
  state.accessPromise.catch(() => {});
}

// ---------- HTTP ----------

function retryableStatus(status) {
  return status === 429 || status >= 500 || status === 0;
}

function retryAfterFrom(response) {
  const raw = response && response.headers && response.headers.get('Retry-After');
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.min(60, value) : 0;
}

async function readJsonResponse(response) {
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) { /* HTML от WAF или пустой ответ */ }
  if (!response.ok) {
    const message = (data && data.message)
      || (data && data.data && data.data.toast && data.data.toast.message)
      || shortText(text)
      || `HTTP ${response.status}`;
    throw new ApiError(message, response.status, retryableStatus(response.status), retryAfterFrom(response));
  }
  if (!data || typeof data !== 'object') {
    throw new ApiError(`API вернул не JSON: ${shortText(text) || 'пустой ответ'}`, response.status, false, 0);
  }
  return data;
}

async function withRetry(label, operation, signal, maxRetries) {
  const limit = Number(maxRetries) || 2;
  for (let attempt = 0; ; attempt++) {
    if (signal && signal.aborted) throw abortError();
    try {
      return await operation();
    } catch (err) {
      if (isAbort(err)) throw err;
      const retryable = err instanceof ApiError ? err.retryable : (err instanceof TypeError);
      if (!retryable || attempt >= limit) throw err;
      const wait = err.retryAfter
        ? err.retryAfter * 1000
        : Math.min(8000, 800 * (2 ** attempt));
      addLog(`${label}: ${humanError(err)}; повтор через ${Math.round(wait / 1000)} с`, 'info');
      await sleep(wait, signal);
    }
  }
}

async function fetchJsonDirect(url, signal, headers) {
  const response = await fetch(url, {
    method: 'GET',
    headers: headers || apiHeaders(),
    // Публичные главы не требуют cookies; если нужен авторизованный контекст,
    // apiGet повторит запрос из вкладки нужного сайта с credentials:'include'.
    credentials: 'omit',
    cache: 'no-store',
    signal,
  });
  return readJsonResponse(response);
}

function isSupportedTabUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && C.isSupportedHost(url.hostname);
  } catch (_) {
    return false;
  }
}

function isCurrentSiteTabUrl(value) {
  if (!isSupportedTabUrl(value)) return false;
  const site = C.detectSite(value);
  return !!site && site.key === state.siteKey;
}

async function findSourceTab() {
  // Запасные запросы должны идти только из вкладки того же сайта:
  // иначе origin/Referer/CORS и cookies окажутся от другого профиля.
  if (state.bridgeTabId != null) {
    try {
      const tab = await chrome.tabs.get(state.bridgeTabId);
      if (tab && isCurrentSiteTabUrl(tab.url)) return state.bridgeTabId;
    } catch (_) { /* вкладка закрылась */ }
    state.bridgeTabId = null;
  }
  if (state.sourceTabId != null) {
    try {
      const tab = await chrome.tabs.get(state.sourceTabId);
      if (tab && isCurrentSiteTabUrl(tab.url)) {
        state.bridgeTabId = tab.id;
        state.bridgeUnavailable = false;
        return tab.id;
      }
    } catch (_) { /* вкладка закрылась */ }
    state.sourceTabId = null;
  }
  if (state.bridgeUnavailable) return null;
  const tabs = await chrome.tabs.query({});
  const found = tabs.find((tab) => isCurrentSiteTabUrl(tab.url));
  if (found && found.id != null) {
    state.bridgeTabId = found.id;
    state.bridgeUnavailable = false;
    return found.id;
  }
  state.bridgeUnavailable = true;
  return null;
}

// Читаем актуальный Site-Id и access_token авторизованного пользователя.
// 18+ тайтлы SlashLib/HentaiLib могут отдавать 404 без Bearer-токена.
async function readPageContext() {
  try {
    const tabId = await findSourceTab();
    if (tabId == null) return;
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const id = document.documentElement && document.documentElement.getAttribute('data-id');
        const siteId = /^\d+$/.test(String(id || '')) ? String(id) : null;
        let authToken = null;
        const extract = (raw) => {
          if (!raw) return null;
          try {
            const obj = JSON.parse(raw);
            const candidates = [
              obj && obj.token && obj.token.access_token,
              obj && obj.access_token,
              obj && obj.data && obj.data.access_token,
              typeof (obj && obj.token) === 'string' ? obj.token : null,
            ];
            for (const value of candidates) {
              if (typeof value === 'string' && value.length > 20) return value;
            }
          } catch (_) { /* ключ не JSON */ }
          return null;
        };
        try {
          const preferred = ['auth', 'token', 'auth_token'];
          for (const key of preferred) {
            authToken = extract(localStorage.getItem(key));
            if (authToken) break;
          }
          if (!authToken) {
            for (let i = 0; i < localStorage.length; i += 1) {
              const key = localStorage.key(i);
              if (key && /auth|token/i.test(key)) {
                authToken = extract(localStorage.getItem(key));
                if (authToken) break;
              }
            }
          }
        } catch (_) { /* localStorage недоступен */ }
        return { siteId, authToken };
      },
    });
    const context = results && results[0] && results[0].result;
    if (context && /^\d+$/.test(String(context.siteId || ''))) {
      state.siteId = String(context.siteId);
      updateSiteBadge();
    }
    if (context && context.authToken) {
      state.authToken = context.authToken;
      addLog('Найдена авторизация сайта: для API будет использован Bearer-токен.', 'info');
    }
  } catch (_) { /* остаётся Site-Id из профиля, токен необязателен */ }
}

async function runInSourceTab(func, args, world) {
  const tabId = await findSourceTab();
  if (tabId == null) {
    throw new Error('Нет открытой вкладки нужного сайта для запасного запроса. Откройте тайтл на MangaLib/SlashLib и запустите расширение снова.');
  }
  const options = { target: { tabId }, func, args };
  if (world) options.world = world;
  const results = await chrome.scripting.executeScript(options);
  const injection = results && results[0];
  if (!injection) throw new Error('Не удалось выполнить запрос во вкладке сайта.');
  if (injection.exceptionDetails) {
    const text = injection.exceptionDetails.text || (injection.exceptionDetails.exception && injection.exceptionDetails.exception.description);
    throw new Error(shortText(text) || 'Ошибка во вкладке сайта.');
  }
  return injection.result;
}

async function executeInSourceTab(func, args) {
  let firstResult = null;
  let firstError = null;
  try {
    firstResult = await runInSourceTab(func, args);
  } catch (err) {
    firstError = err;
  }
  // На некоторых сборках Chromium изолированный мир наследует расширенческий Origin,
  // а CORS-ошибка прячется внутри результата. Повторяем в MAIN-мире страницы,
  // чтобы запрос ушёл именно от origins нужного сайта.
  const fetchFailed = firstResult && firstResult.ok === false
    && (firstResult.status === 0 || /cors|failed to fetch|blocked/i.test(firstResult.message || ''));
  if (firstError || !firstResult || fetchFailed) {
    try {
      const second = await runInSourceTab(func, args, 'MAIN');
      if (second) return second;
    } catch (_) { /* ниже вернём первую ошибку */ }
  }
  if (firstError) throw firstError;
  return firstResult;
}

async function fetchJsonInPage(url, signal, headers) {
  if (signal && signal.aborted) throw abortError();
  const result = await executeInSourceTab(async (requestUrl, requestHeaders) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(requestUrl, {
        method: 'GET',
        headers: requestHeaders,
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      });
      const text = await response.text();
      let data = null;
      try { data = JSON.parse(text); } catch (_) {}
      const clean = String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
      return {
        ok: response.ok,
        status: response.status,
        data,
        message: (data && data.message) || (data && data.data && data.data.toast && data.data.toast.message) || clean,
      };
    } catch (err) {
      return { ok: false, status: 0, message: String((err && err.message) || err) };
    } finally {
      clearTimeout(timer);
    }
  }, [url, headers || apiHeaders()]);
  if (signal && signal.aborted) throw abortError();
  if (!result || !result.ok) {
    throw new ApiError(
      (result && result.message) || 'Запрос через вкладку сайта не удался',
      result ? result.status : 0,
      false,
      0,
    );
  }
  if (!result.data || typeof result.data !== 'object') {
    throw new ApiError('Ответ через вкладку сайта содержит не JSON', result.status, false, 0);
  }
  return result.data;
}

async function apiGet(path, signal, options = {}) {
  const siteId = options.siteId != null ? options.siteId : state.siteId;
  const headers = makeApiHeaders(siteId);
  const bases = options.bases && options.bases.length
    ? [...options.bases]
    : (state.apiBase
      ? [state.apiBase, ...state.apiBases.filter((base) => base !== state.apiBase)]
      : [...state.apiBases]);
  const usePage = options.usePage !== false;
  const errors = [];

  for (const base of bases) {
    const url = base + path;
    const host = (() => { try { return new URL(base).hostname; } catch (_) { return base; } })();
    try {
      const data = await withRetry(`API ${host}`, () => fetchJsonDirect(url, signal, headers), signal, 2);
      state.apiBase = base;
      updateApiHost();
      return data;
    } catch (err) {
      if (isAbort(err)) throw err;
      errors.push(`${host}: ${humanError(err)}`);
      if (!usePage) continue;
      try {
        const data = await fetchJsonInPage(url, signal, headers);
        state.apiBase = base;
        updateApiHost();
        addLog('Запрос API выполнен через открытую вкладку сайта.', 'info');
        return data;
      } catch (pageErr) {
        if (isAbort(pageErr)) throw pageErr;
        errors.push(`вкладка: ${humanError(pageErr)}`);
      }
    }
  }
  const tail = errors.slice(0, 4).join(' | ');
  const all404 = errors.length > 0 && errors.every((line) => /\(HTTP 404\)|Not Found/i.test(line));
  const message = all404
    ? `Тайтл не найден в публичном API (404). ${tail}. Проверьте Site-Id, авторизацию на 18+ тайтлах и саму ссылку.`
    : `API недоступен. ${tail}. Проверьте ссылку и держите вкладку ${state.siteName} открытой.`;
  const error = new Error(message);
  error.notFound = all404;
  throw error;
}

function updateServersFromConstants(json) {
  const list = json && json.data && Array.isArray(json.data.imageServers) ? json.data.imageServers : [];
  const siteId = Number(state.siteId);
  const rank = (server) => {
    const index = SERVER_PRIORITY.indexOf(server.id);
    return index === -1 ? SERVER_PRIORITY.length : index;
  };
  const urls = list
    .filter((server) => server && server.url && server.id !== 'crop'
      && (!Array.isArray(server.site_ids) || server.site_ids.map(Number).includes(siteId)))
    .sort((a, b) => rank(a) - rank(b))
    .map((server) => String(server.url).replace(/\/+$/, ''));
  state.servers = C.unique([...urls, ...state.fallbackServers]);
  state.serversLoaded = true;
  return state.servers;
}

async function loadImageServers(signal) {
  if (state.serversLoaded) return state.servers;
  try {
    const json = await apiGet('/constants?fields[]=imageServers', signal);
    updateServersFromConstants(json);
    addLog(`Серверы изображений: ${state.servers.map((s) => { try { return new URL(s).hostname; } catch (_) { return s; } }).join(', ')}`, 'info');
  } catch (err) {
    state.servers = [...state.fallbackServers];
    state.serversLoaded = true;
    addLog(`Не удалось получить список CDN, используются запасные: ${humanError(err)}`, 'err');
  }
  try { await ensureRefererRules(); } catch (err) { addLog(`DNR: ${humanError(err)}`, 'err'); }
  return state.servers;
}

// ---------- Восстановление после 404 ----------

async function fetchChaptersWithFallback(slug, signal) {
  const path = `/manga/${encodeURIComponent(slug)}/chapters`;
  try {
    return await apiGet(path, signal);
  } catch (err) {
    if (!err.notFound || isAbort(err)) throw err;
    // Один и тот же slug иногда встречается на другом сайте сети lib.social.
    for (const siteId of ['1', '2', '3', '4', '5']) {
      if (siteId === String(state.siteId)) continue;
      try {
        const json = await apiGet(path, signal, {
          siteId,
          bases: [state.apiBases[0]],
          usePage: false,
        });
        state.siteId = siteId;
        state.siteName = C.SITE_NAMES[siteId] || state.siteName;
        updateSiteBadge();
        addLog(`Тайтл найден с Site-Id ${siteId}; контекст API переключён.`, 'info');
        return json;
      } catch (altErr) {
        if (isAbort(altErr)) throw altErr;
        if (!altErr.notFound) throw altErr;
      }
    }
    throw err;
  }
}

async function searchTitleCandidates(slug) {
  const queries = C.slugToSearchQueries(slug);
  const bySlug = new Map();
  for (const query of queries) {
    const path = `/manga?q=${encodeURIComponent(query)}`
      + '&site_id[]=1&site_id[]=2&site_id[]=3&site_id[]=4&site_id[]=5';
    try {
      const json = await apiGet(path, undefined, {
        bases: [state.apiBases[0]],
        usePage: true,
      });
      const list = json && Array.isArray(json.data) ? json.data : [];
      for (const item of list) {
        if (item && item.slug_url && !bySlug.has(item.slug_url)) bySlug.set(item.slug_url, item);
      }
      if (bySlug.size >= 12) break;
    } catch (_) { /* один неудачный поисковый запрос не блокирует остальные */ }
  }
  return [...bySlug.values()]
    .map((item) => ({ item, score: C.titleSearchScore(item, slug, state.siteId) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((entry) => entry.item);
}

function siteLabel(id) {
  return C.SITE_NAMES[Number(id)] || `Site ${id}`;
}

function renderSuggestions(candidates, slug) {
  const box = dom.suggestions;
  box.replaceChildren();
  const exact = candidates.some((item) => item.slug_url === slug);
  const title = document.createElement('h3');
  title.className = 'section-title size-sm';
  title.textContent = 'Похожие тайтлы в каталоге';
  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent = exact
    ? 'Точный тайтл найден в каталоге, но публичный API не отдаёт его главы. Для 18+ тайтлов SlashLib нужна авторизация на сайте; иначе главы могут быть закрыты.'
    : 'Возможно, ссылка устарела или ведёт на тайтл другого сайта сети. Выберите подходящий вариант ниже.';
  box.append(title, note);

  if (!candidates.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Похожих тайтлов не найдено.';
    box.append(empty);
    box.hidden = false;
    return;
  }

  const list = document.createElement('div');
  list.className = 'suggestions-list';
  for (const item of candidates) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'suggestion';
    const name = document.createElement('span');
    name.className = 'suggestion-name';
    name.textContent = item.rus_name || item.name || item.eng_name || item.slug_url;
    const meta = document.createElement('span');
    meta.className = 'suggestion-meta';
    const metaParts = [siteLabel(item.site)];
    if (item.ageRestriction && item.ageRestriction.label) metaParts.push(item.ageRestriction.label);
    metaParts.push(item.slug_url);
    meta.textContent = metaParts.join(', ');
    button.append(name, meta);
    const supported = Number(item.site) === 1 || Number(item.site) === 2;
    if (!supported) {
      button.disabled = true;
      button.title = 'Этот сайт сети пока не поддерживается расширением';
      meta.textContent += ', не поддерживается';
    } else {
      button.addEventListener('click', () => {
        dom.siteSelect.value = Number(item.site) === 1 ? 'manga' : 'slash';
        dom.url.value = item.slug_url;
        loadTitle(item.slug_url);
      });
    }
    list.append(button);
  }
  box.append(list);
  box.hidden = false;
}

async function showTitleNotFound(slug, err, loadId) {
  const authHint = state.authToken
    ? 'Токен авторизации найден, но API всё равно вернул 404 — главы, вероятно, закрыты или лицензированы.'
    : 'Для 18+ тайтлов войдите на сайт, подтвердите возраст и нажмите «Загрузить список» ещё раз.';
  setStatus(`Тайтл не найден (404). ${authHint}`, 'error');
  addLog(humanError(err), 'err');
  try {
    const candidates = await searchTitleCandidates(slug);
    if (state.loadId !== loadId || state.running) return;
    renderSuggestions(candidates, slug);
  } catch (searchErr) {
    addLog(`Поиск похожих тайтлов не удался: ${humanError(searchErr)}`, 'err');
  }
}

async function fetchBinaryDirect(url, signal) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'image/*' },
    credentials: 'omit',
    cache: 'force-cache',
    signal,
  });
  const type = response.headers.get('content-type') || '';
  if (!response.ok) {
    throw new ApiError(`HTTP ${response.status}`, response.status, retryableStatus(response.status), retryAfterFrom(response));
  }
  if (type && !/^image\//i.test(type)) {
    throw new ApiError(`Сервер вернул ${type}`, response.status, false, 0);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 64) throw new ApiError('Пустой файл изображения', response.status, false, 0);
  return { bytes, type, url };
}

function bytesFromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function fetchBinaryInPage(url, signal) {
  if (signal && signal.aborted) throw abortError();
  const result = await executeInSourceTab(async (requestUrl) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(requestUrl, {
        method: 'GET',
        headers: { Accept: 'image/*' },
        credentials: 'omit',
        cache: 'force-cache',
        signal: controller.signal,
      });
      if (!response.ok) return { ok: false, status: response.status, message: `HTTP ${response.status}` };
      const type = response.headers.get('content-type') || '';
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return { ok: true, status: response.status, type, b64: btoa(binary) };
    } catch (err) {
      return { ok: false, status: 0, message: String((err && err.message) || err) };
    } finally {
      clearTimeout(timer);
    }
  }, [url]);
  if (signal && signal.aborted) throw abortError();
  if (!result || !result.ok) {
    throw new ApiError((result && result.message) || 'Запрос изображения через вкладку не удался', result ? result.status : 0, false, 0);
  }
  const type = result.type || '';
  if (type && !/^image\//i.test(type)) throw new ApiError(`Сервер вернул ${type}`, result.status, false, 0);
  const bytes = bytesFromBase64(result.b64 || '');
  if (bytes.length < 64) throw new ApiError('Пустой файл изображения', result.status, false, 0);
  return { bytes, type, url };
}

async function fetchPageImage(page, servers, signal) {
  const relative = page.url || page.image;
  if (!relative) throw new Error('У страницы нет адреса изображения');
  const candidates = /^https?:\/\//i.test(relative)
    ? [relative]
    : C.unique(servers.map((server) => C.joinServerUrl(server, relative)));
  let lastError = new Error('Не удалось скачать страницу');

  for (const url of candidates) {
    if (signal.aborted) throw abortError();
    try {
      return await withRetry(
        `Страница ${page.slug || page.image || ''}`,
        () => fetchBinaryDirect(url, signal),
        signal,
        2,
      );
    } catch (err) {
      if (isAbort(err)) throw err;
      lastError = err;
      try {
        const image = await fetchBinaryInPage(url, signal);
        return image;
      } catch (pageErr) {
        if (isAbort(pageErr)) throw pageErr;
        lastError = pageErr;
      }
    }
  }
  throw new Error(`Страница ${page.slug || ''}: ${humanError(lastError)}`);
}

// ---------- Сохранение файлов ----------

function saveBlob(blob, filename) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    let settled = false;
    let timer = null;
    let listener = null;

    function finish(err, id) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (listener) chrome.downloads.onChanged.removeListener(listener);
      URL.revokeObjectURL(objectUrl);
      if (err) reject(err);
      else resolve(id);
    }

    chrome.downloads.download({
      url: objectUrl,
      filename,
      conflictAction: 'uniquify',
      saveAs: false,
    }, (downloadId) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError || downloadId == null) {
        finish(new Error((runtimeError && runtimeError.message) || 'Chrome не принял файл'), null);
        return;
      }
      listener = (delta) => {
        if (!delta || delta.id !== downloadId || !delta.state) return;
        if (delta.state.current === 'complete') finish(null, downloadId);
        else if (delta.state.current === 'interrupted') {
          finish(new Error((delta.error && delta.error.current) || 'Загрузка прервана'), downloadId);
        }
      };
      chrome.downloads.onChanged.addListener(listener);
      // Если событие состояния потеряно, не держим promise вечно.
      timer = setTimeout(() => finish(null, downloadId), 60000);
    });
  });
}

function sortedPages(pages) {
  return pages.map((page, index) => ({ page, index })).sort((a, b) => {
    const an = Number(a.page.slug);
    const bn = Number(b.page.slug);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return a.index - b.index;
  }).map((entry) => entry.page);
}

function chapterZipFiles(chapterData) {
  const files = chapterData.files.map((file) => ({ name: file.name, data: file.bytes }));
  files.push({
    name: 'ComicInfo.xml',
    data: new TextEncoder().encode(C.buildComicInfo({
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

function reindexFiles(files) {
  const width = Math.max(3, String(files.length).length);
  return files.map((file, index) => ({
    ...file,
    name: `${String(index + 1).padStart(width, '0')}.${file.ext}`,
  }));
}

function makeChapterData(parts) {
  const root = C.sanitizeComponent(parts.options.root || 'MangaLib', 40);
  const series = C.sanitizeComponent(state.title || state.slug, 80);
  const base = `${series} - ${parts.label}${parts.partial ? ' - неполная' : ''}`;
  return {
    files: parts.files,
    label: parts.label,
    base,
    root,
    series,
    chapter: parts.chapter,
    branchLabel: parts.branchLabel,
    chapterName: parts.chapterName,
    source: parts.source,
    partial: !!parts.partial,
  };
}

async function collectChapterFiles(item, options, signal, onPage) {
  const { chapter, branchId, branchLabel } = item;
  const label = C.chapterLabel(chapter);
  const query = new URLSearchParams({ number: chapter.number, volume: chapter.volume });
  if (branchId) query.set('branch_id', String(branchId));
  const json = await apiGet(`/manga/${encodeURIComponent(state.slug)}/chapter?${query}`, signal);
  const data = json && json.data ? json.data : {};
  const restricted = data.restricted_view;
  const pages = Array.isArray(data.pages) ? sortedPages(data.pages.slice()) : [];
  if (!pages.length) {
    if (restricted && restricted.is_open === false) {
      throw new Error('Доступ закрыт: глава платная или находится в раннем доступе.');
    }
    throw new Error('В ответе нет страниц — возможно, глава недоступна.');
  }

  const width = Math.max(3, String(pages.length).length);
  const files = new Array(pages.length);
  const abortWithPartial = (cause) => {
    const err = abortError();
    err.cause = cause;
    const partialFiles = files.filter(Boolean);
    if (partialFiles.length) {
      err.partialChapterData = makeChapterData({
        files: reindexFiles(partialFiles),
        label,
        chapter,
        branchLabel,
        chapterName: data.name || chapter.name || `Глава ${chapter.number}`,
        source: state.sourceUrl || `${state.origin}/`,
        options,
        partial: true,
      });
    }
    return err;
  };
  const local = new AbortController();
  const forward = () => local.abort();
  signal.addEventListener('abort', forward, { once: true });
  let next = 0;
  let done = 0;

  try {
    const worker = async () => {
      for (;;) {
        if (local.signal.aborted) throw abortError();
        const i = next++;
        if (i >= pages.length) return;
        const image = await fetchPageImage(pages[i], state.servers, local.signal);
        const ext = C.sniffImageExt(image.bytes, image.type, image.url);
        files[i] = {
          name: `${String(i + 1).padStart(width, '0')}.${ext}`,
          ext,
          type: C.mimeForExt(ext),
          bytes: image.bytes,
          url: image.url,
        };
        done++;
        onPage(done, pages.length, label);
        if (options.delay > 0) await sleep(options.delay, local.signal);
      }
    };
    await Promise.all(Array.from({ length: Math.min(options.concurrency, pages.length) }, worker));
  } catch (err) {
    local.abort();
    if (isAbort(err) || signal.aborted) throw abortWithPartial(err);
    throw err;
  } finally {
    signal.removeEventListener('abort', forward);
  }
  if (signal.aborted) throw abortWithPartial(abortError());

  return makeChapterData({
    files,
    label,
    chapter,
    branchLabel,
    chapterName: data.name || chapter.name || `Глава ${chapter.number}`,
    source: state.sourceUrl || `${state.origin}/`,
    options,
    partial: false,
  });
}

async function downloadChapter(item, options, signal, onPage) {
  const collected = await collectChapterFiles(item, options, signal, onPage);
  const { files, base, root, series } = collected;
  const format = options.format;

  if (format === 'images' || format === 'both') {
    const folder = `${root}/${series}/${C.sanitizeComponent(base, 90)}`;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      await saveBlob(new Blob([file.bytes], { type: file.type }), `${folder}/${file.name}`);
    }
  }
  if (format === 'cbz' || format === 'both') {
    await saveBlob(C.buildZip(chapterZipFiles(collected)), `${root}/${series}/${base}.cbz`);
  }
  return files.length;
}

// ---------- Один общий архив ----------

function batchRangeLabel(chapters) {
  const first = chapters[0].label;
  const last = chapters[chapters.length - 1].label;
  return chapters.length === 1 ? first : `${first}–${last} (${chapters.length} глав)`;
}

function flatArchiveEntries(chapters, series, range, meta = {}) {
  const encoder = new TextEncoder();
  const total = chapters.reduce((sum, chapterData) => sum + chapterData.files.length, 0);
  const width = Math.max(4, String(total).length);
  const entries = [];
  const partialCount = chapters.filter((chapterData) => chapterData.partial).length;
  const lines = [
    series,
    `Диапазон: ${range}`,
    `Глав: ${chapters.length}`,
    `Остановлено: ${meta.stopped ? 'да' : 'нет'}`,
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
    lines.push(`${String(start).padStart(width, '0')}-${String(page).padStart(width, '0')}\t${chapterData.label}\t${chapterData.chapterName}\t${chapterData.branchLabel}${flag}`);
  }

  const writers = [...new Set(chapters.map((chapterData) => chapterData.branchLabel).filter(Boolean))].join('; ');
  entries.push({ name: 'chapters.txt', data: encoder.encode(lines.join('\n') + '\n') });
  entries.push({
    name: 'ComicInfo.xml',
    data: encoder.encode(C.buildComicInfo({
      title: `${series} — ${range}${meta.stopped ? ' (остановлено)' : ''}`,
      series,
      volume: chapters[0].chapter.volume,
      chapterNumber: range,
      translation: writers,
      pageCount: page,
      source: chapters[0].source,
      summary: lines.slice(5).join('\n'),
    })),
  });
  return entries;
}

function folderedArchiveEntries(chapters, series, range, meta = {}) {
  const encoder = new TextEncoder();
  const total = chapters.reduce((sum, chapterData) => sum + chapterData.files.length, 0);
  const partialCount = chapters.filter((chapterData) => chapterData.partial).length;
  const header = [
    series,
    `Диапазон: ${range}`,
    `Глав: ${chapters.length}`,
    `Остановлено: ${meta.stopped ? 'да' : 'нет'}`,
    `Неполных глав: ${partialCount}`,
    `Структура: одна папка на главу, внутри страницы и ComicInfo.xml`,
    '',
  ];
  const lines = [...header];
  const body = [];
  const usedFolders = new Set();

  chapters.forEach((chapterData, index) => {
    const order = String(index + 1).padStart(3, '0');
    const chapterTitle = chapterData.chapterName ? ` - ${chapterData.chapterName}` : '';
    const partialSuffix = chapterData.partial ? ' - неполная' : '';
    let folder = C.sanitizeComponent(`${order} - ${chapterData.label}${chapterTitle}${partialSuffix}`, 100);
    let unique = folder;
    let counter = 2;
    while (usedFolders.has(unique)) unique = `${folder} (${counter++})`;
    usedFolders.add(unique);

    for (const file of chapterZipFiles(chapterData)) {
      body.push({ name: `${unique}/${file.name}`, data: file.data });
    }
    const flag = chapterData.partial ? '\tНЕПОЛНАЯ' : '';
    lines.push(`${unique}/\t${chapterData.label}\tстраниц: ${chapterData.files.length}\tперевод: ${chapterData.branchLabel}${flag}`);
  });

  const writers = [...new Set(chapters.map((chapterData) => chapterData.branchLabel).filter(Boolean))].join('; ');
  const info = C.buildComicInfo({
    title: `${series} — ${range}${meta.stopped ? ' (остановлено)' : ''}`,
    series,
    volume: chapters[0].chapter.volume,
    chapterNumber: range,
    translation: writers,
    pageCount: total,
    source: chapters[0].source,
    summary: lines.slice(header.length).join('\n'),
  });
  return [
    { name: 'ComicInfo.xml', data: encoder.encode(info) },
    { name: 'chapters.txt', data: encoder.encode(lines.join('\n') + '\n') },
    ...body,
  ];
}

function nestedArchiveEntries(chapters, series, range, meta = {}) {
  const encoder = new TextEncoder();
  const entries = [];
  const partialCount = chapters.filter((chapterData) => chapterData.partial).length;
  const lines = [
    series,
    `Диапазон: ${range}`,
    `Глав: ${chapters.length}`,
    `Остановлено: ${meta.stopped ? 'да' : 'нет'}`,
    `Неполных глав: ${partialCount}`,
    '',
  ];
  for (const chapterData of chapters) {
    const name = `${C.sanitizeComponent(chapterData.base, 90)}.cbz`;
    entries.push({ name, data: C.buildZipBytes(chapterZipFiles(chapterData)) });
    const flag = chapterData.partial ? '\tНЕПОЛНАЯ' : '';
    lines.push(`${name}\t${chapterData.label}\tстраниц: ${chapterData.files.length}\tперевод: ${chapterData.branchLabel}${flag}`);
  }
  entries.push({ name: 'chapters.txt', data: encoder.encode(lines.join('\n') + '\n') });
  return entries;
}

async function saveBatchArchive(chapters, options, meta = {}) {
  if (!chapters.length) throw new Error('Нет глав для общего архива.');
  const root = chapters[0].root;
  const series = chapters[0].series;
  const range = batchRangeLabel(chapters);
  const partialCount = chapters.filter((chapterData) => chapterData.partial).length;
  const suffix = `${meta.stopped ? ' - остановлено' : ''}${partialCount ? ' - есть неполные главы' : ''}`;
  const base = C.sanitizeComponent(`${series} - ${range}${suffix}`, 110);

  let files;
  let filename;
  let type;
  if (options.format === 'single-cbz-folders') {
    files = folderedArchiveEntries(chapters, series, range, meta);
    filename = `${root}/${base}.cbz`;
    type = 'application/vnd.comicbook+zip';
  } else if (options.format === 'single-cbz') {
    files = flatArchiveEntries(chapters, series, range, meta);
    filename = `${root}/${base}.cbz`;
    type = 'application/vnd.comicbook+zip';
  } else {
    files = nestedArchiveEntries(chapters, series, range, meta);
    filename = `${root}/${base}.zip`;
    type = 'application/zip';
  }
  // Фаза упаковки уже не прерывается: иначе пользователь потерял бы скачанное.
  const blob = C.buildZip(files, { type });
  await saveBlob(blob, filename);
  return filename;
}

// ---------- Список глав ----------

function applyFilter() {
  const query = dom.filter.value.trim().toLowerCase();
  for (const row of state.chapterRows) {
    row.classList.toggle('filtered', !!query && !row.dataset.search.includes(query));
  }
}

function updateSelectionCount() {
  const count = $$('.chapter-check').filter((checkbox) => checkbox.checked && !checkbox.disabled).length;
  dom.selectedCount.textContent = `Выбрано: ${count}`;
}

function onChapterClick(event, index) {
  const checkbox = event.currentTarget;
  if (event.shiftKey && state.lastCheckedIndex != null) {
    const from = Math.min(state.lastCheckedIndex, index);
    const to = Math.max(state.lastCheckedIndex, index);
    const boxes = $$('.chapter-check');
    for (let i = from; i <= to; i++) {
      if (boxes[i] && !boxes[i].disabled) boxes[i].checked = state.lastCheckedState;
    }
  }
  state.lastCheckedIndex = index;
  state.lastCheckedState = checkbox.checked;
  updateSelectionCount();
}

function renderChapters() {
  const fragment = document.createDocumentFragment();
  state.chapterRows = [];
  const targetIndex = C.findChapterIndex(state.chapters, state.readTarget);

  state.chapters.forEach((chapter, index) => {
    const row = document.createElement('div');
    row.className = `chapter-row${chapter.available ? '' : ' unavailable'}`;
    row.setAttribute('role', 'listitem');
    row.dataset.index = String(index);
    row.dataset.search = `${chapter.volume} ${chapter.number} ${chapter.name} ${C.chapterLabel(chapter)}`.toLowerCase();

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'chapter-check';
    checkbox.dataset.index = String(index);
    checkbox.disabled = !chapter.available;
    checkbox.checked = index === targetIndex && chapter.available;
    checkbox.setAttribute('aria-label', `Том ${chapter.volume}, глава ${chapter.number}`);
    checkbox.addEventListener('click', (event) => onChapterClick(event, index));

    const number = document.createElement('div');
    number.className = 'chapter-num';
    number.textContent = C.chapterLabel(chapter);

    const name = document.createElement('div');
    name.className = 'chapter-name';
    name.textContent = chapter.name || 'Без названия';
    name.title = chapter.name || '';

    let branchCell;
    if (chapter.openBranches.length > 1) {
      const select = document.createElement('select');
      select.className = 'branch-select';
      select.dataset.index = String(index);
      select.setAttribute('aria-label', 'Перевод главы');
      for (const branch of chapter.openBranches) {
        const option = document.createElement('option');
        option.value = branch.selectorId;
        option.textContent = branch.label;
        select.append(option);
      }
      if (chapter.defaultBranchId) select.value = chapter.defaultBranchId;
      branchCell = select;
    } else {
      const text = document.createElement('div');
      text.className = 'chapter-name';
      text.textContent = chapter.openBranches[0] ? chapter.openBranches[0].label : '—';
      text.title = text.textContent;
      branchCell = text;
    }

    const badge = document.createElement('div');
    badge.className = 'chapter-badge';
    badge.textContent = !chapter.available
      ? 'закрыто'
      : (chapter.branchesCount > 1 ? `${chapter.openBranches.length} пер.` : '');

    row.append(checkbox, number, name, branchCell, badge);
    fragment.append(row);
    state.chapterRows.push(row);
  });

  dom.list.replaceChildren(fragment);
  applyFilter();
  updateSelectionCount();
}

function setAll(checked) {
  for (const checkbox of $$('.chapter-check')) {
    if (!checkbox.disabled) checkbox.checked = checked;
  }
  state.lastCheckedState = checked;
  updateSelectionCount();
}

function applyRange() {
  const selected = C.parseRange(dom.range.value, state.chapters);
  const boxes = $$('.chapter-check');
  boxes.forEach((checkbox, index) => {
    if (!checkbox.disabled) checkbox.checked = selected.has(index);
  });
  updateSelectionCount();
  if (!selected.size) setStatus('Диапазон не распознан. Пример: 1-10, 15, 20.5', 'error');
}

function chosenBranch(chapter, index) {
  const select = dom.list.querySelector(`.branch-select[data-index="${index}"]`);
  const branchId = select ? select.value : (chapter.defaultBranchId || null);
  const branches = chapter.openBranches.length ? chapter.openBranches : chapter.branches;
  const found = branchId && branches.find((branch) => branch.selectorId === String(branchId));
  return { branchId, label: (found || branches[0] || { label: 'Неизвестный перевод' }).label };
}

function getSelected() {
  return $$('.chapter-check')
    .filter((checkbox) => checkbox.checked && !checkbox.disabled)
    .map((checkbox) => {
      const index = Number(checkbox.dataset.index);
      const chapter = state.chapters[index];
      const branch = chosenBranch(chapter, index);
      return { chapter, index, branchId: branch.branchId, branchLabel: branch.label };
    })
    .filter((item) => item.chapter);
}

// ---------- Загрузка тайтла ----------

async function loadTitle(input) {
  if (state.running) return;
  const rawInput = String(input || '').trim();
  const slug = C.parseSlug(rawInput);
  if (!slug) {
    setStatus('Не удалось найти slug тайтла. Вставьте ссылку вида https://mangalib.me/ru/7965--chainsaw-man или https://v2.shlib.life/ru/manga/87161--san-da', 'error');
    return;
  }

  const detected = C.detectSite(rawInput);
  const forcedKey = dom.siteSelect.value;
  const forcedSite = forcedKey !== 'auto' ? C.SITE_PROFILES[forcedKey] : null;
  // Полная ссылка всегда определяет сайт; выбор вручную нужен для голого slug.
  const site = detected || forcedSite || state.site || C.SITE_PROFILES.manga;
  const loadId = ++state.loadId;

  state.site = site;
  state.siteKey = site.key;
  state.siteId = site.siteId;
  state.authToken = null;
  state.siteName = site.name;
  state.rootFolder = site.rootFolder;
  state.apiBases = [...site.apiBases];
  state.fallbackServers = [...site.fallbackServers];
  state.apiBase = null;
  state.origin = detected && detected.key === site.key
    ? C.originFrom(rawInput, site.defaultOrigin)
    : site.defaultOrigin;
  state.sourceUrl = rawInput;
  state.slug = slug;
  state.title = titleFromSlug(slug);
  state.readTarget = C.parseReadTarget(rawInput);
  state.chapters = [];
  state.chapterRows = [];
  state.serversLoaded = false;
  state.servers = [...state.fallbackServers];
  state.bridgeUnavailable = false;
  state.bridgeTabId = state.sourceTabId;

  dom.url.value = rawInput;
  dom.sourceLink.href = `${state.origin}/`;
  dom.sourceLink.textContent = `Открыть ${state.siteName}`;
  dom.root.value = state.rootFolder;
  updateSiteBadge();
  updateApiHost();
  dom.workspace.hidden = true;
  dom.titleCard.hidden = true;
  dom.suggestions.hidden = true;
  dom.suggestions.replaceChildren();
  dom.log.replaceChildren();
  setStatus(`Загружаю список глав: ${slug} (${state.siteName})…`);
  dom.load.disabled = true;

  try {
    try {
      await ensureRefererRules();
    } catch (err) {
      addLog(`Не удалось обновить правило Referer: ${humanError(err)}. Будет использован запасной запрос через вкладку.`, 'err');
    }
    await readPageContext();
    const json = await fetchChaptersWithFallback(slug);
    if (state.loadId !== loadId) return;
    const raw = json && Array.isArray(json.data) ? json.data : [];
    state.chapters = C.normalizeChapters(raw);
    updateTitleCard();
    renderChapters();
    dom.workspace.hidden = false;
    if (!state.chapters.length) {
      setStatus('У тайтла нет доступных глав в публичном API — возможно, он лицензирован или скрыт.', 'error');
    } else {
      const open = state.chapters.filter((chapter) => chapter.available).length;
      setStatus(`Загружено глав: ${state.chapters.length}. Доступно: ${open}.`, 'ok');
      if (state.readTarget) addLog(`Из адреса читалки определена глава т${state.readTarget.volume} гл${state.readTarget.number}.`, 'info');
    }

    // Не блокируем интерфейс метаданными и CDN: это второстепенные запросы.
    apiGet(`/manga/${encodeURIComponent(slug)}`)
      .then((meta) => {
        if (state.loadId !== loadId) return;
        state.title = C.titleName(meta, slug);
        updateTitleCard();
      })
      .catch(() => {});
    loadImageServers().catch(() => {});
  } catch (err) {
    if (state.loadId !== loadId || isAbort(err)) return;
    if (err.notFound) {
      await showTitleNotFound(slug, err, loadId);
    } else {
      setStatus(humanError(err), 'error');
      addLog(humanError(err), 'err');
    }
  } finally {
    if (state.loadId === loadId) dom.load.disabled = state.running;
  }
}

// ---------- Пакетная загрузка ----------

function setOverall(done, total) {
  dom.overallProgress.max = Math.max(1, total);
  dom.overallProgress.value = done;
  dom.overallText.textContent = `Главы: ${done} из ${total}`;
}

function setPageProgress(done, total, label) {
  dom.pageProgress.max = Math.max(1, total);
  dom.pageProgress.value = done;
  dom.currentText.textContent = `${label} — страница ${done} из ${total}`;
}

async function startDownload() {
  if (state.running) return;
  const selected = getSelected();
  if (!selected.length) {
    setStatus('Выберите хотя бы одну доступную главу.', 'error');
    return;
  }
  try {
    if (state.accessPromise) await state.accessPromise;
  } catch (err) {
    setStatus(humanError(err), 'error');
    return;
  }

  const speed = SPEEDS[dom.speed.value] || SPEEDS.normal;
  const options = {
    format: dom.format.value,
    root: dom.root.value,
    concurrency: speed.concurrency,
    delay: speed.delay,
    chapterPause: speed.chapterPause,
  };
  const batchMode = options.format === 'single-cbz-folders'
    || options.format === 'single-cbz'
    || options.format === 'single-zip';
  const archiveChapters = [];
  const controller = new AbortController();
  state.controller = controller;
  setRunning(true);
  dom.log.replaceChildren();
  setOverall(0, selected.length);
  setPageProgress(0, 1, 'Подготовка');
  setStatus(batchMode
    ? `Скачиваю глав: ${selected.length}. Один архив появится в конце — даже если нажать «Остановить».`
    : `Скачиваю глав: ${selected.length}. Не закрывайте эту вкладку.`, 'ok');

  let ok = 0;
  let failed = 0;
  let stopped = false;
  let archiveSaved = false;
  let packError = null;

  try {
    await loadImageServers(controller.signal);
    try {
      await ensureRefererRules();
    } catch (err) {
      addLog(`Не удалось обновить правило Referer: ${humanError(err)}`, 'err');
    }

    for (let i = 0; i < selected.length; i++) {
      if (controller.signal.aborted) {
        stopped = true;
        break;
      }
      const item = selected[i];
      const label = C.chapterLabel(item.chapter);
      setOverall(i, selected.length);
      setPageProgress(0, 1, label);
      dom.currentText.textContent = `${label} — получаю список страниц…`;
      try {
        if (batchMode) {
          const chapterData = await collectChapterFiles(item, options, controller.signal, (done, total, chapterLabel) => {
            setPageProgress(done, total, chapterLabel);
          });
          archiveChapters.push(chapterData);
          ok++;
          addLog(`${label}: страниц ${chapterData.files.length}, добавлено в общий архив.`, 'ok');
        } else {
          const pages = await downloadChapter(item, options, controller.signal, (done, total, chapterLabel) => {
            setPageProgress(done, total, chapterLabel);
          });
          ok++;
          addLog(`${label}: сохранено, страниц ${pages}.`, 'ok');
        }
      } catch (err) {
        if (isAbort(err) || controller.signal.aborted) {
          stopped = true;
          if (batchMode && err.partialChapterData && err.partialChapterData.files.length) {
            archiveChapters.push(err.partialChapterData);
            addLog(`${label}: до остановки сохранено ${err.partialChapterData.files.length} стр. (неполная глава).`, 'info');
          }
          break;
        }
        failed++;
        addLog(`${label}: ${humanError(err)}`, 'err');
      }
      if (stopped || controller.signal.aborted) break;
      setOverall(i + 1, selected.length);
      if (i + 1 < selected.length) {
        try {
          await sleep(options.chapterPause, controller.signal);
        } catch (err) {
          if (isAbort(err) || controller.signal.aborted) {
            stopped = true;
            break;
          }
          throw err;
        }
      }
    }

    const included = archiveChapters.length;
    const partialCount = archiveChapters.filter((chapterData) => chapterData.partial).length;
    const partialNote = partialCount ? `, неполных: ${partialCount}` : '';
    setOverall((batchMode ? included : ok) + failed, selected.length);

    // Даже после «Остановить» отдаём уже скачанное: упаковка не прерывается.
    if (batchMode && included) {
      const wasStopped = stopped || controller.signal.aborted;
      setPageProgress(0, 1, 'Упаковка');
      dom.currentText.textContent = wasStopped ? 'Собираю архив из уже скачанного…' : 'Собираю общий архив…';
      try {
        const filename = await saveBatchArchive(archiveChapters, options, { stopped: wasStopped });
        archiveSaved = true;
        addLog(`${wasStopped ? 'Частичный архив' : 'Общий архив'} сохранён: ${filename}`, 'ok');
      } catch (err) {
        packError = err;
        addLog(`Ошибка сборки архива: ${humanError(err)}`, 'err');
      }
    }

    if (packError) {
      setStatus(`Не удалось собрать ${stopped || controller.signal.aborted ? 'частичный ' : ''}архив: ${humanError(packError)}`, 'error');
    } else if (batchMode && archiveSaved) {
      setStatus(stopped || controller.signal.aborted
        ? `Остановлено. Отдан 1 архив, глав внутри: ${included}${partialNote}, ошибок: ${failed}.`
        : `Готово. Отдан 1 архив, глав внутри: ${included}${partialNote}, ошибок: ${failed}.`, 'ok');
    } else if (stopped || controller.signal.aborted) {
      setStatus(batchMode
        ? `Остановлено. Архив не собран: нет загруженных глав, ошибок: ${failed}.`
        : `Остановлено. Уже сохранено глав: ${ok}, с ошибками: ${failed}.`, '');
    } else if (batchMode) {
      setStatus(`Готово. Архив не собран: загружено глав ${included}, ошибок ${failed}.`, failed ? 'error' : 'ok');
    } else {
      setStatus(`Готово. Сохранено: ${ok}, с ошибками: ${failed}.`, 'ok');
    }
    addLog(
      `Итог: глав ${batchMode ? included : ok}, с ошибками ${failed}. ${batchMode ? `Архивов: ${archiveSaved ? 1 : 0}.` : `Сохранено глав: ${ok}.`}${partialCount ? ` Неполных глав в архиве: ${partialCount}.` : ''} Папка «${C.sanitizeComponent(options.root, 40)}».`,
      stopped || packError ? 'info' : 'ok',
    );
  } catch (err) {
    if (isAbort(err) || controller.signal.aborted) {
      stopped = true;
      setStatus('Остановлено.', '');
    } else {
      setStatus(humanError(err), 'error');
      addLog(humanError(err), 'err');
    }
  } finally {
    dom.currentText.textContent = stopped ? 'Остановлено' : 'Готово';
    setRunning(false);
    state.controller = null;
  }
}

// ---------- События ----------

dom.form.addEventListener('submit', (event) => {
  event.preventDefault();
  loadTitle(dom.url.value);
});
dom.filter.addEventListener('input', applyFilter);
dom.applyRange.addEventListener('click', applyRange);
dom.range.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    applyRange();
  }
});
dom.selectAll.addEventListener('click', () => setAll(true));
dom.selectNone.addEventListener('click', () => setAll(false));
dom.start.addEventListener('click', () => {
  requestHostAccess();
  startDownload();
});
dom.stop.addEventListener('click', () => {
  if (state.controller) {
    state.controller.abort();
    dom.currentText.textContent = 'Останавливаю…';
  }
});
dom.rules.addEventListener('click', () => {
  requestHostAccess();
  Promise.all([ensureRefererRules(), state.accessPromise])
    .then(() => setStatus('Доступ к API/CDN и заголовок Referer обновлены.', 'ok'))
    .catch((err) => setStatus(humanError(err), 'error'));
});
window.addEventListener('beforeunload', (event) => {
  if (state.running) {
    event.preventDefault();
    event.returnValue = '';
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== 'ML_LOAD_URL') return false;
  if (state.running) {
    addLog('Новую ссылку нельзя загрузить во время скачивания.', 'err');
    return false;
  }
  state.sourceTabId = Number(message.tabId) || null;
  state.bridgeTabId = state.sourceTabId;
  state.bridgeUnavailable = false;
  dom.url.value = String(message.url || '');
  loadTitle(message.url);
  return false;
});

async function init() {
  const params = new URLSearchParams(location.search);
  const url = params.get('u');
  const tabId = Number(params.get('tab'));
  if (Number.isFinite(tabId) && tabId > 0) {
    state.sourceTabId = tabId;
    state.bridgeTabId = tabId;
  }
  ensureRefererRules().catch((err) => addLog(`DNR: ${humanError(err)}`, 'err'));
  if (url) {
    dom.url.value = url;
    await loadTitle(url);
  } else {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const active = tabs && tabs[0];
      if (active && isSupportedTabUrl(active.url)) {
        state.sourceTabId = active.id;
        state.bridgeTabId = active.id;
        dom.url.value = active.url;
        await loadTitle(active.url);
      }
    } catch (_) { /* пользователь вставит ссылку вручную */ }
  }
}

init();
