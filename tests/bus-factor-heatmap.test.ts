/**
 * Focused component tests for src/components/admin/BusFactorHeatmap.tsx.
 *
 * Why this shape: the repo has vitest (node env) + esbuild + @playwright/test but no
 * jsdom/testing-library, so instead of adding dev dependencies we bundle the real TSX
 * with esbuild (React included, resolved from the repo's node_modules), serve it from a
 * local HTTP page, answer the risk API with realistic payloads over real fetch, and
 * drive the component in headless Chromium.
 *
 * Excluded cases and why:
 *  - cargo / cargo-test: round-2 backend work runs elsewhere; tests here only need a
 *    compiled TSX, so nothing depends on the Rust toolchain.
 *  - tests/accessibility.spec.ts: needs a fully running Next server, not a component.
 *  - `pnpm test` full chain: it rebuilds Rust and the daemon; this component owns
 *    nothing in that chain, so we run vitest on this file directly instead.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const componentPath = path.join(repoRoot, 'src/components/admin/BusFactorHeatmap.tsx');

// Playwright 1.65 wants chromium-1254, but only the 1243 build is cached locally, and
// /usr/bin/chromium exists as a fallback; explicit executablePath bypasses the check.
const CHROMIUM_CANDIDATES = [
  process.env.REV_CHROMIUM_PATH,
  '/home/fev/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  '/usr/bin/chromium',
].filter((value): value is string => Boolean(value));

const ALICE_EMAIL = 'alice@rev.dev';
const SCORE_EXPLANATION =
  'score = departing share of current HEAD blame × (1 + ln(1 + 90-day churn lines))';

interface ContributorTuple {
  name: string;
  email: string;
  lines: number;
  ownershipFraction: number;
  isDeparting: boolean;
}

function moduleFixture(overrides: Record<string, unknown> = {}, contributors?: ContributorTuple[]) {
  return {
    path: 'src/components/admin/HandoverWizard.tsx',
    totalLines: 1400,
    departingLines: 980,
    ownershipFraction: 0.7,
    churnLines: 210,
    testCoverage: null,
    score: 0.7 * (1 + Math.log1p(210)),
    explanation: 'Ownership is current HEAD blame; churn counts added/deleted lines in the last 90 days.',
    ...(contributors ? { contributors, busFactor50: 1 } : {}),
    ...overrides,
  };
}

const highModule = moduleFixture({ path: 'src/high.ts' }, [
  { name: 'Alicearczyk', email: ALICE_EMAIL, lines: 980, ownershipFraction: 0.7, isDeparting: true },
  { name: 'Bob Stearns', email: 'bob@rev.dev', lines: 300, ownershipFraction: 0.2, isDeparting: false },
  { name: 'Carol Mensah', email: 'carol@rev.dev', lines: 120, ownershipFraction: 0.1, isDeparting: false },
]);
const sharedModule = moduleFixture(
  { path: 'src/shared.ts', departingLines: 300, ownershipFraction: 0.3, score: 0.3, churnLines: 30 },
  [
    { name: 'Bob Stearns', email: 'bob@rev.dev', lines: 700, ownershipFraction: 0.7, isDeparting: false },
    { name: 'Alicearczyk', email: ALICE_EMAIL, lines: 300, ownershipFraction: 0.3, isDeparting: true },
  ],
);
// Pre-round-2 core payload: no contributors/busFactor50 fields at all.
const legacyModule = moduleFixture({
  path: 'src/legacy.ts',
  churnLines: 5,
  ownershipFraction: 0.1,
  departingLines: 14,
  score: 0.11,
});
const otherModule = moduleFixture({
  path: 'src/other.ts',
  churnLines: 40,
  ownershipFraction: 0.2,
  departingLines: 60,
  score: 0.25,
});

function riskPayload(kind: 'contributors' | 'legacy' | 'empty') {
  return {
    runId: 'test-run',
    analysis: {
      revision: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
      modules:
        kind === 'contributors' ? [highModule, sharedModule, legacyModule] : kind === 'legacy' ? [legacyModule, otherModule] : [],
      warnings: kind === 'contributors' ? ['Could not analyze blame for vendor/vendor.min.js; omitted from results'] : [],
    },
  };
}

let componentJs = '';
let browser: Browser | null = null;
let context: BrowserContext | null = null;
let server: Server | null = null;
let pageErrors: string[] = [];

beforeAll(async () => {
  // Compile guard: the owned component must keep typechecking inside the project.
  execFileSync('pnpm', ['typecheck'], { cwd: repoRoot, stdio: 'pipe', timeout: 180_000 });

  // Self-contained browser bundle: React + the real TSX, no network/CDN needed.
  const scratch = await mkdtemp(path.join(tmpdir(), 'rev-bfh-'));
  try {
    const entryPath = path.join(scratch, 'entry.tsx');
    await writeFile(
      entryPath,
      [
        "import React from 'react';",
        "import { createRoot } from 'react-dom/client';",
        `import BusFactorHeatmap from '${componentPath}';`,
        'window.__mountBusFactorHeatmap = (props) => {',
        "  createRoot(document.getElementById('root')).render(React.createElement(BusFactorHeatmap, props));",
        '};',
      ].join('\n'),
    );
    const bundle = await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      format: 'iife',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      nodePaths: [path.join(repoRoot, 'node_modules')],
      write: false,
      logLevel: 'silent',
    });
    componentJs = bundle.outputFiles[0].text;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  const chromiumPath = CHROMIUM_CANDIDATES.find((candidate) => candidate.length > 0);
  if (!chromiumPath) throw new Error('No Chromium executable found for Playwright');
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true });
  context = await browser.newContext();
}, 240_000);

afterAll(async () => {
  await context?.close();
  await browser?.close();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

type Scenario = 'contributors' | 'legacy' | 'empty' | 'error' | 'slow-after-first';

async function mountHarness(scenario: Scenario): Promise<Page> {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  pageErrors = [];
  let requestCount = 0;

  server = createServer((req, res) => {
    const respondJson = (payload: unknown) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (req.method === 'POST' && req.url?.startsWith('/api/runs/')) {
      requestCount += 1;
      if (scenario === 'error') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bus-factor analysis requires a run imported from a local Git checkout.' }));
        return;
      }
      if (scenario === 'slow-after-first' && requestCount > 1) {
        // Keep the fetch pending so the loading state is observable.
        setTimeout(() => respondJson(riskPayload('legacy')), 500);
        return;
      }
      respondJson(riskPayload(scenario === 'legacy' || scenario === 'slow-after-first' ? 'legacy' : scenario));
      return;
    }
    if (req.url === '/component.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(componentJs);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      '<!doctype html><html><head><meta charset="utf-8"><title>BusFactorHeatmap harness</title></head>' +
        '<body><div id="root"></div>' +
        '<script src="/component.js"></script>' +
        "<script>window.__mountBusFactorHeatmap({ runId: 'test-run', departingName: 'Alice' });</script>" +
        '</body></html>',
    );
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('harness server failed to bind');

  const page = await context!.newPage();
  page.on('pageerror', (error: Error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/`);
  return page;
}

async function clickAnalyze(page: Page) {
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Analyze ownership and churn'),
    ) as HTMLButtonElement | undefined;
    if (!button) throw new Error('Analyze button not found');
    button.click();
  });
}

const waitFor = async (
  page: Page,
  predicate: (page: Page) => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 10_000,
) => {
  const started = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = await predicate(page);
    } catch {
      ok = false; // transient (navigation, detached frame); keep polling
    }
    if (ok) return;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const hasTable = (page: Page) => page.evaluate(() => Boolean(document.querySelector('tbody')));
const bodyText = (page: Page) => page.evaluate(() => document.body.textContent ?? '');
const visiblePaths = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('tbody button[data-path]')].map((b) => (b as HTMLElement).dataset.path),
  );

function assertNoPageErrors() {
  expect(pageErrors).toEqual([]);
}

describe('BusFactorHeatmap (real Chromium via esbuild bundle + stubbed API)', () => {
  it('compiles the TSX component into a runnable browser bundle', () => {
    expect(componentJs.length).toBeGreaterThan(0);
    expect(componentJs).toContain('BusFactorHeatmap');
  });

  it('shows an error alert when the risk API fails', { timeout: 30_000 }, async () => {
    const page = await mountHarness('error');
    try {
      await clickAnalyze(page);
      await waitFor(page, () => page.evaluate(() => Boolean(document.querySelector('[role="alert"]'))), 'error alert');
      const text = await bodyText(page);
      expect(text).toContain('Bus-factor analysis requires a run imported from a local Git checkout.');
      assertNoPageErrors();
    } finally {
      await page.close();
    }
  });

  it('renders an accessible empty state when analysis returns no blamed modules', { timeout: 30_000 }, async () => {
    const page = await mountHarness('empty');
    try {
      await clickAnalyze(page);
      await waitFor(page, () => page.evaluate(() => document.body.textContent?.includes('No Git-blamed modules were returned') ?? false), 'empty state');
      const text = await bodyText(page);
      expect(text).toContain('local Git checkout with commit history');
      assertNoPageErrors();
    } finally {
      await page.close();
    }
  });

  it('sorts, filters, and searches files; headers expose aria-sort and honest labels', { timeout: 60_000 }, async () => {
    const page = await mountHarness('contributors');
    try {
      await clickAnalyze(page);
      await waitFor(page, hasTable, 'table after analyze');

      // Honest priority framing instead of fake CRITICAL/MODERATE/LOW severity levels.
      let text = await bodyText(page);
      expect(text).not.toContain('CRITICAL');
      expect(text).not.toContain('Critical Concentration');
      expect(text).toContain('High priority');
      expect(text).toContain('Heuristic priority (not failure probability)');
      // Combined churn is never presented as a "+" delta.
      expect(text).toContain('210 lines changed');
      expect(text).not.toContain('+210');
      // Analysis warnings surface in the UI.
      expect(text).toContain('Could not analyze blame for vendor/vendor.min.js');
      // With contributor data the concentration column exists.
      expect(text).toContain('50% ownership concentration');

      // Default sort: score descending → high (4.45), shared (0.30), legacy (0.11).
      expect(await visiblePaths(page)).toEqual(['src/high.ts', 'src/shared.ts', 'src/legacy.ts']);
      expect(text).toContain('score 4.45');

      // Sort by path: first click ascending, header exposes aria-sort.
      await page.evaluate(() => {
        const th = [...document.querySelectorAll('th')].find((el) => el.textContent?.includes('File / module path'));
        (th?.querySelector('button') as HTMLButtonElement).click();
      });
      await waitFor(
        page,
        () => page.evaluate(() => document.querySelector('th[aria-sort="ascending"]')?.textContent?.includes('File / module path') ?? false),
        'aria-sort ascending on path column',
      );
      expect(await visiblePaths(page)).toEqual(['src/high.ts', 'src/legacy.ts', 'src/shared.ts']);

      // Second click flips to descending.
      await page.evaluate(() => {
        const th = [...document.querySelectorAll('th')].find((el) => el.textContent?.includes('File / module path'));
        (th?.querySelector('button') as HTMLButtonElement).click();
      });
      await waitFor(
        page,
        () => page.evaluate(() => document.querySelector('th[aria-sort="descending"]')?.textContent?.includes('File / module path') ?? false),
        'aria-sort descending on path column',
      );
      expect(await visiblePaths(page)).toEqual(['src/shared.ts', 'src/legacy.ts', 'src/high.ts']);

      // Churn sort ascending via its header button.
      // Poll for either churn sort state first: a single inter-test double click can
      // land entirely between two 50 ms polls, so the transient 'descending' state
      // (or the whole toggle) may complete unseen.
      await page.evaluate(() => {
        const th = [...document.querySelectorAll('th')].find((el) => el.textContent?.includes('90-day churn'));
        const button = th?.querySelector('button') as HTMLButtonElement;
        button.click(); // desc
        button.click(); // asc
      });
      await waitFor(
        page,
        () =>
          page.evaluate(() =>
            Boolean(document.querySelector('th[aria-sort="ascending"]')?.textContent?.includes('90-day churn')),
          ),
        'aria-sort ascending on churn column',
      );
      expect(await visiblePaths(page)).toEqual(['src/legacy.ts', 'src/shared.ts', 'src/high.ts']);

      // Priority filter radio: only high-priority files remain.
      await page.evaluate(() => {
        const label = [...document.querySelectorAll('label')].find((el) => el.textContent?.trim() === 'High priority');
        (label?.querySelector('input') as HTMLInputElement).click();
      });
      await waitFor(page, async () => (await visiblePaths(page)).length === 1, 'high filter applied');
      expect(await visiblePaths(page)).toEqual(['src/high.ts']);
      expect(await bodyText(page)).toContain('Showing 1 of 3 tracked files');

      // Single-majority-author filter matches both busFactor50 === 1 files.
      await page.evaluate(() => {
        const label = [...document.querySelectorAll('label')].find((el) => el.textContent?.trim() === 'One majority author');
        (label?.querySelector('input') as HTMLInputElement).click();
      });
      await waitFor(page, async () => (await visiblePaths(page)).length === 2, 'single-majority filter applied');

      // Back to all files, then search narrows by path substring.
      await page.evaluate(() => {
        const label = [...document.querySelectorAll('label')].find((el) => el.textContent?.trim() === 'All files');
        (label?.querySelector('input') as HTMLInputElement).click();
      });
      await waitFor(page, async () => (await visiblePaths(page)).length === 3, 'all-files filter restored');

      await page.fill('input[type="search"]', 'legacy');
      await waitFor(page, async () => (await visiblePaths(page)).length === 1, 'search applied');
      expect(await visiblePaths(page)).toEqual(['src/legacy.ts']);
      text = await bodyText(page);
      expect(text).toContain('Showing 1 of 3 tracked files');

      // Clearing the search restores the full list.
      await page.fill('input[type="search"]', '');
      await waitFor(page, async () => (await visiblePaths(page)).length === 3, 'search cleared');
      assertNoPageErrors();
    } finally {
      await page.close();
    }
  });

  it('expands file details with contributor bars, exact score explanation, and no invented coverage', { timeout: 60_000 }, async () => {
    const page = await mountHarness('contributors');
    try {
      await clickAnalyze(page);
      await waitFor(page, hasTable, 'table after analyze');

      await page.click('button[data-path="src/high.ts"]');
      await waitFor(
        page,
        () => page.evaluate(() => document.body.textContent?.includes('Current HEAD blame by author') ?? false),
        'contributor panel',
      );

      const detail = await page.evaluate(() => {
        const toggle = document.querySelector('button[data-path="src/high.ts"]') as HTMLButtonElement;
        const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
        const bars = [...(panel?.querySelectorAll('div[role="img"] > div') ?? [])] as HTMLElement[];
        return { text: panel?.textContent ?? '', expanded: toggle.getAttribute('aria-expanded'), widths: bars.map((b) => b.style.width) };
      });
      expect(detail.expanded).toBe('true');
      // Departing author first (largest share) and visually distinguishable from other authors.
      expect(detail.text).toContain('Alicearczyk (departing)');
      expect(detail.text).toContain('980 lines · 70%');
      expect(detail.text).toContain('Bob Stearns');
      expect(detail.text).toContain('Carol Mensah');
      expect(detail.text).toContain('every other entry is a remaining author on the file');
      // Stacked bar widths follow the blame shares (70% / 20% / 10%).
      expect(detail.widths).toHaveLength(3);
      expect(parseFloat(detail.widths[0])).toBeCloseTo(70, 1);
      expect(parseFloat(detail.widths[1])).toBeCloseTo(20, 1);
      expect(parseFloat(detail.widths[2])).toBeCloseTo(10, 1);
      // 50% concentration is framed as ownership concentration, never total knowledge.
      expect(detail.text).toContain('1 author covers');
      expect(detail.text).toContain('not team attrition or total knowledge distribution');
      // Coverage stays explicitly unavailable.
      expect(detail.text).toContain('Test coverage unavailable');
      expect(detail.text).not.toContain('% of lines');
      // Exact score formula and honest heuristic framing.
      expect(detail.text).toContain(SCORE_EXPLANATION);
      expect(detail.text).toContain('Heuristic priority (not failure probability)');
      // Core explanation is surfaced verbatim.
      expect(detail.text).toContain('Ownership is current HEAD blame');

      // Collapsing hides the panel again.
      await page.click('button[data-path="src/high.ts"]');
      await waitFor(
        page,
        () => page.evaluate(() => !document.body.textContent?.includes('Current HEAD blame by author')),
        'contributor panel collapsed',
      );
      assertNoPageErrors();
    } finally {
      await page.close();
    }
  });

  it('handles legacy payloads without contributor fields and shows test-coverage unavailability', { timeout: 60_000 }, async () => {
    const page = await mountHarness('legacy');
    try {
      await clickAnalyze(page);
      await waitFor(page, hasTable, 'table after analyze');

      const text = await bodyText(page);
      // Concentration column and single-author metric are omitted when the data is absent.
      // (The footer explainer still mentions the concept, so scope this to the table.)
      const tableHeader = await page.evaluate(() => document.querySelector('thead')?.textContent ?? '');
      expect(tableHeader).not.toContain('50% ownership concentration');
      expect(text).not.toContain('Single-majority-author files');
      // No warnings were returned → no notes box.
      expect(text).not.toContain('Analysis notes');

      await page.click('button[data-path="src/legacy.ts"]');
      await waitFor(
        page,
        () => page.evaluate(() => document.body.textContent?.includes('Why this ranking') ?? false),
        'details panel',
      );
      const detail = await page.evaluate(() => {
        const toggle = document.querySelector('button[data-path="src/legacy.ts"]') as HTMLButtonElement;
        const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
        return panel?.textContent ?? '';
      });
      expect(detail).toContain(SCORE_EXPLANATION);
      expect(detail).toContain('Test coverage unavailable');
      expect(detail).not.toContain('Current HEAD blame by author');
      assertNoPageErrors();
    } finally {
      await page.close();
    }
  });

  it('keeps a visible loading state and offers recomputation from latest history', { timeout: 60_000 }, async () => {
    const page = await mountHarness('slow-after-first');
    try {
      await clickAnalyze(page);
      await waitFor(page, hasTable, 'table after first analyze');
      expect(await bodyText(page)).toContain('src/legacy.ts');

      // Recompute → second request is delayed server-side, so first observe the
      // visible loading status while the fetch is pending, then the refreshed table.
      await page.evaluate(() => {
        const button = [...document.querySelectorAll('button')].find((b) =>
          b.textContent?.includes('Recompute from latest history'),
        ) as HTMLButtonElement | undefined;
        if (!button) throw new Error('Recompute button not found');
        button.click();
      });
      await waitFor(
        page,
        () =>
          page.evaluate(
            () =>
              Boolean(document.querySelector('[role="status"]')) &&
              (document.querySelector('[role="status"]')?.textContent?.includes('Analyzing Git blame') ?? false),
          ),
        'loading status while recompute request is pending',
      );
      // While still loading, the recompute button is not rendered (only one CTA at a time).
      expect(
        await page.evaluate(() =>
          [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Recompute from latest history')),
        ),
      ).toBe(false);
      // The previous table legitimately stays visible during the pending recompute.
      await waitFor(
        page,
        () => page.evaluate(() => !document.querySelector('[role="status"]')),
        'loading status cleared after recompute',
        10_000,
      );
      assertNoPageErrors();
    } finally {
      await page.close();
    }
  });
});
