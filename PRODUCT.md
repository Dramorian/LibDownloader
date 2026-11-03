# Lib Downloader — product truth

## What it is

A Chrome MV3 extension that turns publicly visible chapters from MangaLib and SlashLib into one local archive. It is a task tool, not a marketing site: the visitor opens it from a title/reader tab, picks chapters, and waits for one download.

## Audience and real scene

A person already browsing `mangalib.me` or `v2.shlib.life` in Chrome. They may have dozens of tabs open, may stop a long download halfway, and want a file they can file away or open in a CBZ reader. They care about chapter boundaries, not dashboard decoration.

## Primary job

Select chapters and translations, then receive **one archive** at the end — or a clearly marked partial archive if they press Stop.

## Modes and states

Impeccable would call this an **Operate** surface. Important states:

- idle / no title yet;
- title loaded, chapter list visible;
- downloading, with overall and per-page progress;
- stopped, with a partial archive;
- error: 404, restricted/18+, network, CDN;
- suggestions when the exact title is unavailable.

## Must remain untouched

All existing behaviour, IDs, Russian copy, download formats, `Site-Id`/Bearer handling, partial-archive logic, and offline/CSP constraints. The redesign replaces only the visual world.

## Success looks like

The interface reads like a library circulation slip: one sheet, one clear column of work, chapter rows that are easy to scan, no decorative containers, and no need to consult metadata to understand the archive structure.

## What would feel wrong

A dark purple SaaS dashboard, gradient hero, equal card grid, glass panels, template eyebrows, generic system fonts, or any redesign that hides the chapter list behind "modern" chrome.
