/* Service worker: открывает интерфейс и один раз настраивает заголовок Referer.
 *
 * API/CDN сети lib.social стоят за WAF и могут отвергать запросы без Referer.
 * Referer нельзя выставить обычным fetch(), поэтому используется правило DNR.
 * Правило ограничено запросами самого расширения и вкладок поддерживаемых сайтов
 * к известным API/CDN. Страница загрузчика уточняет правило под конкретный сайт.
 *
 * Списки доменов берутся из core.js, а не дублируются: модульный service worker
 * импортирует тот же файл, что и страница (он сам публикует globalThis.MLCore).
 */
'use strict';

import './core.js';

const C = globalThis.MLCore;
if (!C) throw new Error('core.js не загружен');

const RULE_ID = 1;
const REFERER = 'https://mangalib.me/';

function hostsFromUrls(values) {
  return values
    .map((value) => {
      try { return new URL(value).hostname; } catch (_) { return null; }
    })
    .filter(Boolean);
}

const REQUEST_DOMAINS = [...new Set([
  ...C.SITE_DNR_DOMAINS,
  ...hostsFromUrls(Object.values(C.SITE_PROFILES).flatMap((site) => [...site.apiBases, ...site.fallbackServers])),
])];

const INITIATOR_DOMAINS = [chrome.runtime.id, ...C.SITE_INITIATOR_DOMAINS];

const SITE_HOST = /(?:^|\.)(?:mangalib\.(?:me|org)|shlib\.life|yaoilib\.net|slashlib\.(?:me|org)|hentailib\.(?:me|org))$/i;

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
