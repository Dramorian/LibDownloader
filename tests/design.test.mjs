import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));

test('redesign context and self-hosted fonts are present', () => {
  for (const rel of ['PRODUCT.md', 'DESIGN.md', 'SURFACE-BRIEF.md', 'fonts/fonts.css']) {
    assert.ok(exists(rel), `нет файла ${rel}`);
  }
  for (const rel of [
    'fonts/OFL-unbounded.txt',
    'fonts/OFL-ibm-plex-sans.txt',
    'fonts/OFL-ibm-plex-mono.txt',
  ]) {
    assert.ok(exists(rel), `нет лицензии ${rel}`);
  }

  const fontCss = read('fonts/fonts.css');
  assert.match(fontCss, /Unbounded/);
  assert.match(fontCss, /IBM Plex Sans/);
  assert.match(fontCss, /IBM Plex Mono/);
  assert.doesNotMatch(fontCss, /https?:\/\//, 'шрифты не должны тянуться из сети');
  const urls = [...fontCss.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].trim().replace(/^['"]|['"]$/g, ''));
  assert.ok(urls.length >= 20, 'мало self-hosted подмножеств шрифтов');
  for (const dead of ['vietnamese', 'cyrillic-ext']) {
    assert.doesNotMatch(fontCss, new RegExp(dead), `лишнее подмножество ${dead} только увеличивает расширение`);
  }
  for (const url of urls) {
    assert.doesNotMatch(url, /^(https?:|data:)/, `внешний ресурс шрифта ${url}`);
    assert.ok(exists(path.join('fonts', url)), `нет файла шрифта ${url}`);
  }
});

test(' CSS avoids the banned AI-slop defaults', () => {
  const css = read('app.css');
  assert.doesNotMatch(css, /linear-gradient|radial-gradient|conic-gradient/i);
  assert.doesNotMatch(css, /backdrop-filter|filter:\s*blur/i);
  assert.doesNotMatch(css, /text-transform:\s*uppercase/i);
  assert.doesNotMatch(css, /border-left\s*:/i);
  assert.doesNotMatch(css, /border-radius:\s*999px/i);
  assert.doesNotMatch(css, /box-shadow:\s*0 0/i);
  assert.doesNotMatch(css, /#0b1020|#7c8cff|#a78bfa/i, 'старая фиолетовая палитра осталась');
  assert.match(css, /--paper:\s*#E7EBE9/);
  assert.match(css, /--ink:\s*#142A3C/);
  assert.match(css, /--cobalt:\s*#24538F/);
  assert.match(css, /--display:\s*"Unbounded"/);
  assert.match(css, /font-family:\s*var\(--display\)/);
});

test(' craft floor: contrast, touch targets, motion and responsive states', () => {
  const css = read('app.css');
  assert.match(css, /--muted-quiet:\s*#4E6472/);
  assert.match(css, /\.chapter-row\.unavailable \.chapter-name/);
  assert.doesNotMatch(css, /\.chapter-row\.unavailable\s*\{[^}]*opacity/, 'закрытые главы гасим цветом, а не прозрачностью');
  assert.match(css, /min-height:\s*40px/, 'тач-таргеты не меньше 40px');
  // Шапка таблицы и строки глав используют одну и ту же сетку из переменных,
  // иначе подписи колонок разъезжаются с данными.
  assert.match(css, /--chapter-columns:\s*28px 108px/);
  assert.match(css, /--chapter-areas:\s*"check num name branch badge"/);
  assert.match(css, /\.chapter-head,\s*\n\.chapter-row \{[^}]*grid-template-columns: var\(--chapter-columns\)/);
  assert.match(css, /--chapter-areas:\s*"check num name badge" "check num branch branch"/, 'мобильная строка — две строки, без висящего бейджа');
  assert.match(css, /\.chapter-head > \.head-badge \{ grid-area: badge; \}/);
  assert.match(css, /\.chapter-head \{[^}]*color: var\(--muted\)/);
  assert.doesNotMatch(css, /repeat\(auto-fill/, 'подсказки — список, а не сетка карточек');
  assert.match(css, /::selection/);
  assert.match(css, /caret-color/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /scrollbar-color/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /@media \(max-width:\s*760px\)/);
  assert.match(css, /@keyframes issue/);
});

test(' markup has no template chrome or inline styles', () => {
  const html = read('app.html');
  const js = read('app.js');
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'inline-обработчики запрещены CSP');
  assert.doesNotMatch(html, /\sstyle\s*=/i, 'style-src self запрещает inline-стили');
  assert.match(html, /href="fonts\/fonts\.css"/, 'локальные шрифты должны подключаться до app.css');
  assert.doesNotMatch(html, /class="[^"]*\bcard\b/i, 'карточки как контейнеры убраны');
  assert.doesNotMatch(html, /\bhero\b/i);
  assert.doesNotMatch(html, /01\s*\/\s*02|02\s*\/\s*03/, 'декоративные номеры секций убраны');
  assert.doesNotMatch(html, /·|↗|→/, 'шаблонные точки и стрелки убраны');
  assert.doesNotMatch(js, /·|↗/, 'шаблонные точки и стрелки убраны из динамического текста');
});

test(' design docs describe the committed world', () => {
  const design = read('DESIGN.md');
  const brief = read('SURFACE-BRIEF.md');
  const product = read('PRODUCT.md');
  assert.match(design, /circulation slip|библиотеч/i);
  assert.match(design, /Operate|задач/i);
  assert.match(design, /anti-slop|AI defaults/i);
  assert.match(brief, /Operate/);
  for (const doc of [design, product, brief]) {
    assert.match(doc, /HentaiLib/, 'HentaiLib должен быть в описании продукта');
  }
  // Документация должна ссылаться на то, что действительно есть в репозитории.
  assert.doesNotMatch(design, /preview\.html/, 'preview.html в репозитории нет');
  assert.doesNotMatch(design, /npx impeccable/, 'проверку нельзя воспроизвести без зависимостей');
  assert.match(design, /node --test tests\/\*\.test\.mjs/);
});
