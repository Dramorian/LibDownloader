/* Service worker: открывает интерфейс и один раз настраивает заголовок Referer.
 *
 * API/CDN сети lib.social стоят за WAF и могут отвергать запросы без Referer.
 * Referer нельзя выставить обычным fetch(), поэтому используется правило DNR.
 * Правило ограничено запросами самого расширения и вкладок поддерживаемых сайтов
 * к известным API/CDN. Страница загрузчика уточняет правило под конкретный сайт.
 */
'use strict';

const RULE_ID = 1;
const REFERER = 'https://mangalib.me/';
const REQUEST_DOMAINS = [
  'api.cdnlibs.org', 'cdnlibs.org',
  'api.lib.social', 'lib.social',
  'api2.mangalib.me', 'mangalib.me', 'mangalib.org',
  'imglib.info', 'cdnrulib.link',
  'api.shlib.life', 'shlib.life',
  'hapi.hentaicdn.org', 'hentaicdn.org',
  'img2.hentaicdn.org', 'img3.hentaicdn.org',
  'yaoilib.net', 'slashlib.me', 'slashlib.org',
];
const INITIATOR_DOMAINS = [
  chrome.runtime.id,
  'mangalib.me', 'www.mangalib.me', 'mangalib.org', 'www.mangalib.org',
  'shlib.life', 'v2.shlib.life', 'www.shlib.life', 'v1.shlib.life',
  'yaoilib.net', 'v1.yaoilib.net', 'www.yaoilib.net',
  'slashlib.me', 'www.slashlib.me', 'slashlib.org', 'www.slashlib.org',
];
const SITE_HOST = /(?:^|\.)(?:mangalib\.(?:me|org)|shlib\.life|yaoilib\.net|slashlib\.(?:me|org))$/i;

function buildRule(referer, requestDomains) {
  return {
    id: RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'referer', operation: 'set', value: referer || REFERER },
      ],
    },
    condition: {
      initiatorDomains: INITIATOR_DOMAINS,
      requestDomains: [...new Set(requestDomains)].filter(Boolean),
      resourceTypes: ['xmlhttprequest', 'image', 'other'],
    },
  };
}

async function ensureRefererRules(referer, requestDomains) {
  if (!chrome.declarativeNetRequest) return;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [RULE_ID],
    addRules: [buildRule(referer, requestDomains || REQUEST_DOMAINS)],
  });
}

// Фоновая часть запускается и при установке, и при старте браузера.
chrome.runtime.onInstalled.addListener(() => {
  ensureRefererRules().catch((err) => console.warn('Lib DL: не удалось задать Referer', err));
});
chrome.runtime.onStartup.addListener(() => {
  ensureRefererRules().catch((err) => console.warn('Lib DL: не удалось задать Referer', err));
});
ensureRefererRules().catch((err) => console.warn('Lib DL: не удалось задать Referer', err));

// Дополнительный канал: страница загрузчика обновляет список CDN после /constants.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'ML_UPDATE_REFERER_RULES') return false;
  ensureRefererRules(message.referer, message.requestDomains)
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
  return true;
});

function siteOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && SITE_HOST.test(url.hostname) ? url.origin : null;
  } catch (_) {
    return null;
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  const appUrl = chrome.runtime.getURL('app.html');
  const origin = siteOrigin(tab && tab.url);
  const fromSite = !!origin;
  const params = new URLSearchParams();
  if (fromSite) {
    params.set('u', tab.url);
    if (tab.id != null) params.set('tab', String(tab.id));
  }
  const query = params.toString();
  const target = query ? `${appUrl}?${query}` : appUrl;

  // Ещё до открытия интерфейса подставляем Referer нужного сайта.
  if (fromSite) {
    await ensureRefererRules(`${origin}/`, REQUEST_DOMAINS)
      .catch((err) => console.warn('Lib DL: не удалось обновить Referer', err));
  }

  try {
    const existing = await chrome.tabs.query({ url: `${appUrl}*` });
    if (existing.length && existing[0].id != null) {
      await chrome.tabs.update(existing[0].id, { active: true });
      if (fromSite) {
        try {
          await chrome.tabs.sendMessage(existing[0].id, {
            type: 'ML_LOAD_URL',
            url: tab.url,
            tabId: tab.id,
          });
        } catch (_) { /* вкладка ещё грузится — URL уже есть в адресе при первом открытии */ }
      }
      return;
    }
  } catch (err) {
    console.warn('Lib DL: не удалось найти открытую вкладку загрузчика', err);
  }
  await chrome.tabs.create({ url: target });
});
