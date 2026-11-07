import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');

// Service worker в Chrome — ES-модуль: он импортирует core.js и берёт списки доменов
// оттуда. Здесь проверяем, что импорт не падает и правило собирается из общих данных,
// а не из второй копии списка.
test('service worker собирает DNR-правило из core.js для всех трёх сайтов', async (t) => {
  const rules = [];
  const listeners = {};
  globalThis.chrome = {
    runtime: {
      id: 'abcdefghijklmnopabcdefghijklmnop',
      onInstalled: { addListener: (fn) => { listeners.installed = fn; } },
      onStartup: { addListener: (fn) => { listeners.startup = fn; } },
      onMessage: { addListener: (fn) => { listeners.message = fn; } },
    },
    declarativeNetRequest: { updateDynamicRules: async (options) => { rules.push(options); } },
    action: { onClicked: { addListener: (fn) => { listeners.action = fn; } } },
    tabs: { query: async () => [], update: async () => {}, sendMessage: async () => {}, create: async () => {} },
  };

  try {
    await import(pathToFileURL(path.join(root, 'background.js')).href);
  } catch (err) {
    delete globalThis.chrome;
    // Node 18/20 без определения модулей не умеет импортировать .js с import-синтаксисом.
    if (/Cannot use import statement|ERR_REQUIRE_ESM/.test(String(err && err.message))) {
      t.skip('этот Node не определяет ES-модули по синтаксису; в Chrome MV3 модуль работает');
      return;
    }
    throw err;
  }

  await new Promise((resolve) => setTimeout(resolve, 20));
  const rule = rules.at(-1).addRules[0];
  const requestDomains = rule.condition.requestDomains;
  const initiatorDomains = rule.condition.initiatorDomains;

  assert.equal(rule.action.type, 'modifyHeaders');
  assert.equal(rule.action.requestHeaders[0].header, 'referer');
  assert.deepEqual(rule.condition.resourceTypes, ['xmlhttprequest', 'image', 'other']);

  for (const host of ['api.cdnlibs.org', 'api.lib.social', 'api.shlib.life', 'hentaicdn.org', 'hentailib.me']) {
    assert.ok(requestDomains.includes(host), `в requestDomains нет ${host}`);
  }
  for (const site of ['mangalib.me', 'v2.shlib.life', 'hentailib.me', 'hentailib.org']) {
    assert.ok(initiatorDomains.includes(site), `в initiatorDomains нет ${site}`);
  }
  assert.ok(initiatorDomains.includes('abcdefghijklmnopabcdefghijklmnop'), 'само расширение — инициатор');

  assert.equal(typeof listeners.action, 'function', 'клик по иконке обрабатывается');

  delete globalThis.chrome;
});
