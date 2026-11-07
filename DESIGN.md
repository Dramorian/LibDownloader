# Lib Downloader — design system

Direction: **circulation slip / library register**. This is an **Operate** surface: a single cool sheet of paper, petrol ink, one cobalt binding accent, and tabular catalogue data built for completing a task. It serves all three sites of the network (MangaLib, SlashLib, HentaiLib — `Site-Id` 1 / 2 / 4) through one form, so the sheet never gains a per-site variant. This replaces the old dark purple dashboard rather than polishing it.

Applied playbooks: Impeccable `new-work`, `craft-floor`, `distill`, `clarify`, `audit`, `polish`; Anthropic `frontend-design` anti-default list. The warm-cream/serif/terracotta and near-black/acid accent looks are explicitly treated as AI defaults and avoided.

## Color

Core palette, named values:

| Token | Hex | Where and why |
|---|---|---|
| Mist paper | `#E7EBE9` | Page ground. Cool, not the default warm cream. |
| Sheet | `#F6F7F4` | The single working surface. |
| Petrol ink | `#142A3C` | Body text, headings, rules. |
| Binding blue | `#24538F` | Primary action, focus, progress, active state. |
| Stamp red | `#A63D32` | Errors, closed chapters, stop action. |
| Folio green | `#2F6B55` | Success and completed states. |

Tinted neutrals derive from the ink hue: `--muted: #526978`, `--muted-quiet: #4E6472`, `--line: #C4CDCA`, `--line-strong: #9EAEAA`, `--blue-wash: #DDE7F2`, `--stamp-wash: #F1E1DF`. Secondary text is never pure gray. Contrast on Sheet: ink 13.7:1, muted 5.35:1, muted-quiet 5.76:1, cobalt 7.21:1, stamp 5.86:1, folio 5.82:1.

Closed (unavailable) chapters are quieted with `--muted-quiet`, never with `opacity`: 50 % transparency pulled 13 px text to 2.06:1 and dimmed the only "закрыто" marker with it.

No gradients, no glass, no glow, no purple, no pure black/white.

## Type

Self-hosted, OFL-licensed, no network fonts:

- **Unbounded** — display voice: wordmark, `h1`, `h2`. Chosen for its wide Cyrillic-capable letterforms; not a system face and not a high-contrast serif cliché.
- **IBM Plex Sans** — UI body, labels, buttons. Clear Cyrillic, quiet next to Unbounded.
- **IBM Plex Mono** — data only: chapter numbers, Site-Id/API strings, counters, progress, log lines. Not used as decoration.

Scale: 12 / 13 / 15 / 17 / 21 / 34 px. Nothing in the interface is smaller than 12 px: 10–11 px mono data was unreadable on a 1120 px sheet. `h1` is `clamp(24px, 3.2vw, 34px)`, so it never exceeds the display step. Body measure capped near 72ch. Display tracking `-0.02em`; no tracking below `-0.04em`. Tabular numerals on all data.

## Layout

One sheet, left docket rail, right working column. Left aligned throughout. Rules replace cards. No nested containers, no section numbers, no eyebrows.

```text
┌ sheet ─────────────────────────────────────────────────────────┐
│ [mark]  Lib Downloader                         Open MangaLib    │
│         Формуляр на выдачу глав                                │
├──────────────────┬─────────────────────────────────────────────┤
│ Сведения         │ Тайтл                                       │
│   Сайт  MangaLib │ [ ссылка / slug ][ сайт ][ загрузить ]       │
│   API   api.…    │ status line                                 │
│                  │ title docket                                │
│ Порядок работы   │ ─────────────────────────────────────────── │
│ 1 Укажите тайтл  │ Главы и настройки          Выбрано: 12       │
│ 2 Отметьте главы │ [ формат ][ скорость ][ папка ]              │
│ 3 Получите архив │ фильтр / диапазон / действия                 │
│                  │ catalogue rows …                            │
│                  │ [ скачать ][ остановить ]                   │
│                  │ progress ─────────────── log               │
└──────────────────┴─────────────────────────────────────────────┘
```

On narrow screens the rail folds above the work column, settings become one column, and chapter rows lose the branch column.

## Shapes

Square-ish corners: 3px for inputs/buttons, 2px for stamps, 4px for the sheet. No pill radii on large surfaces. Hairline 1px rules separate sections. The only radius above 8px is the sheet itself.

## Elevation & Depth

One soft, offset shadow on the sheet: `0 18px 50px rgba(20, 42, 60, .10)`. Sections, inputs, rows and notes use borders or spacing, never shadows. No zero-offset halos, no hard offset costume shadows, no border-under-shadow ghost cards.

## Motion

One authored page-load moment: the sheet reveals with a short clip/opacity ease-out. Otherwise motion only answers an action: button press, focus, checkbox, progress value. No per-section fade-and-slide, no bounce/elastic easing, no hover transitions on every row. `prefers-reduced-motion` disables the reveal.

Browser surfaces are themed: `::selection`, caret, focus-visible ring, scrollbars, underline offset, checkbox/progress accent colour, and tabular numerals.

## Components

- **Masthead**: authored SVG spine mark, display wordmark, one plain source link. No gradient badge.
- **Docket rail**: `<dl>` pairs for site/API and a real ordered list for the three actual steps. The steps are onboarding only and disappear once a title's chapters are loaded; the rail then carries data, not decoration.
- **Status**: a receipt line with a small square indicator; error/success colour changes the text and dot, not a tinted card.
- **Title docket**: bordered top/bottom line with title, slug, count stamps.
- **Chapter head**: one register line above the list with the actual column names — «Том, глава», «Название», «Перевод», «Статус» — set in 12 px mono in `--muted`. It shares the row grid (`--chapter-columns` / `--chapter-areas`), so labels never drift from the data; on narrow screens it wraps to the same two-line rhythm as the rows. No uppercase, no counters, no zebra stripes.
- **Chapter row**: catalogue entry, 40 px tall and clickable as a whole (the 16 px checkbox alone was the only hit area). Number is a spine-like tabular block; branch select is a plain underlined control, 34 px on desktop and 40 px on touch widths; closed rows are quieted in colour, stay in the list and keep their "закрыто" badge at full strength.
- **Suggestions**: plain list of text buttons, no card grid.
- **Progress**: two linear bars, cobalt fill, no gradient.
- **Log**: measurement-style lines with small type-coloured bullets.

## Responsive

Desktop grid is `220px / 1fr` at a max sheet width of 1120px. Chapter rows are laid out with named grid areas: `check num name branch badge` on desktop and `check num name` / `check num branch` below 760px, where the badge is removed instead of dangling on a third line. Below 760px: single column, rail first, full-width controls, progress labels stack. Touch targets stay at least 40px (`input`, `select` and `.button` all carry `min-height: 40px`). Real Russian copy is tested at both widths.

## Anti-slop checklist

Banned by construction: gradient text, glassmorphism, purple/blue glow, equal card feature rows, nested cards, hero metrics, kicker labels, `01 / 02 / 03` decoration, all-caps labels, middle-dot meta strings, appended arrows, monospace-as-costume, Unicode icon glyphs, repeated section entrances, `border-left` stripes.

## Verification

Everything below is reproducible from a clean checkout with Node.js 18+, without network access or extra packages:

```bash
node --test tests/*.test.mjs
```

- `tests/design.test.mjs` enforces the local anti-slop rules, self-hosted fonts and their subsets, themed browser surfaces, reduced motion, the 40 px touch targets and the responsive chapter-row areas.
- `tests/static.test.mjs` checks the manifest, CSP, host permissions for all three sites and that no interface component reaches for the network.
- `tests/core.test.mjs` covers parsing, ZIP/CBZ and the archive builders that used to live untested in `app.js`.
- Font payload is trimmed to the subsets the interface can actually render (Cyrillic, Cyrillic-ext-free, Latin, Latin-ext, Greek): 24 `@font-face` blocks, no network fonts.
