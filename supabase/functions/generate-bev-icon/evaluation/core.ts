// Evaluation policy is deliberately separate from technical image acceptance.
export const AXES = ['fidelity', 'style', 'cutout', 'smallSize'] as const;
export const REQUIRED_TAGS = [
  'cup',
  'layered',
  'stemmed',
  'bottle',
  'can',
  'dim',
  'clutter',
  'top-down',
] as const;
export interface Fixture {
  id: string;
  categoryId: string;
  photo: string;
  render?: string;
  tags: string[];
  expected: string;
}
export interface Suite {
  version: 1;
  cases: Fixture[];
}

export function parseSuite(value: unknown): Suite {
  const suite = value as Suite;
  if (
    !suite || suite.version !== 1 || !Array.isArray(suite.cases) || !suite.cases.length ||
    suite.cases.length > 100
  ) {
    throw new Error('Suite must have version 1 and between 1 and 100 cases');
  }
  const ids = new Set<string>();
  for (const c of suite.cases) {
    if (
      !c || typeof c.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(c.id) || ids.has(c.id)
    ) {
      throw new Error('Case ids must be unique lowercase slugs');
    }
    ids.add(c.id);
    for (const field of ['categoryId', 'photo', 'expected'] as const) {
      if (typeof c[field] !== 'string' || !c[field].trim()) {
        throw new Error(`${c.id}: missing ${field}`);
      }
    }
    if (
      !Array.isArray(c.tags) || !c.tags.length ||
      c.tags.some((t) => typeof t !== 'string' || !t.trim())
    ) {
      throw new Error(`${c.id}: tags required`);
    }
    if (c.render !== undefined && (typeof c.render !== 'string' || !c.render.trim())) {
      throw new Error(`${c.id}: invalid render`);
    }
  }
  return suite;
}

export interface CaseResult {
  id: string;
  tags: string[];
  expected: string;
  inputSha256: string;
  renderSha256?: string;
  promptSha256: string;
  references: { slug: string; sha256: string }[];
  status: 'completed' | 'failed' | 'release';
  elapsedMs: number;
  error?: string;
  outputSha256?: string;
  transparentFraction?: number;
  labelBand?: unknown;
}
export interface Report {
  version: 1;
  runId: string;
  mode: 'live' | 'replay';
  model: string;
  createdAt: string;
  suiteSha256: string;
  codeSha256: Record<string, string>;
  providerCalls: number;
  cost: null;
  results: CaseResult[];
}
export interface Review {
  runId: string;
  reviewer: string;
  reviewedAt: string;
  cases: {
    id: string;
    outputSha256: string;
    scores: Record<typeof AXES[number], number | null>;
    severeDefect: boolean;
    notes: string;
  }[];
}

/** Proposed pilot policy, not a statement of product/design approval. */
export function assess(
  report: Report,
  review: Review | undefined,
): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (report.mode !== 'live') reasons.push('Replay cannot establish live provider quality');
  if (report.results.length < 20) reasons.push('At least 20 real-photo cases required');
  if (new Set(report.results.map((c) => c.inputSha256)).size < 20) {
    reasons.push('At least 20 distinct source photos required');
  }
  const tags = new Set(report.results.flatMap((c) => c.tags));
  for (const tag of REQUIRED_TAGS) if (!tags.has(tag)) reasons.push(`Missing coverage: ${tag}`);
  if (
    !review || review.runId !== report.runId || !review.reviewer?.trim() || !review.reviewedAt ||
    !Number.isFinite(Date.parse(review.reviewedAt))
  ) {
    return { passed: false, reasons: [...reasons, 'Dated human review for this run required'] };
  }
  const seen = new Set<string>();
  for (const item of review.cases ?? []) {
    if (seen.has(item.id)) reasons.push(`Duplicate review: ${item.id}`);
    seen.add(item.id);
    if (!report.results.some((c) => c.id === item.id)) reasons.push(`Unknown review: ${item.id}`);
  }
  let accepted = 0;
  const totals = Object.fromEntries(AXES.map((a) => [a, 0])) as Record<typeof AXES[number], number>;
  let scored = 0;
  for (const result of report.results) {
    if (result.status !== 'completed') continue; // Failures stay in the pass-rate denominator.
    const item = review.cases?.find((c) => c.id === result.id);
    if (!item || !result.outputSha256 || item.outputSha256 !== result.outputSha256) {
      reasons.push(`${result.id}: missing review or changed output`);
      continue;
    }
    if (
      !AXES.every((a) =>
        Number.isInteger(item.scores?.[a]) && Number(item.scores[a]) >= 1 &&
        Number(item.scores[a]) <= 5
      ) ||
      typeof item.severeDefect !== 'boolean'
    ) {
      reasons.push(`${result.id}: score all four axes from 1 to 5 and mark severeDefect`);
      continue;
    }
    scored++;
    for (const a of AXES) totals[a] += Number(item.scores[a]);
    if (item.severeDefect) reasons.push(`${result.id}: severe defect`);
    if (!item.severeDefect && AXES.every((a) => Number(item.scores[a]) >= 3)) accepted++;
  }
  if (accepted / report.results.length < 0.9) {
    reasons.push('Fewer than 90% of attempted cases are visually usable');
  }
  for (const a of AXES) if (!scored || totals[a] / scored < 4) reasons.push(`Mean ${a} below 4/5`);
  return { passed: reasons.length === 0, reasons };
}

export function reviewTemplate(report: Report): Review {
  return {
    runId: report.runId,
    reviewer: '',
    reviewedAt: '',
    cases: report.results.filter((c) => c.status === 'completed').map((c) => ({
      id: c.id,
      outputSha256: c.outputSha256!,
      scores: { fidelity: null, style: null, cutout: null, smallSize: null },
      severeDefect: false,
      notes: '',
    })),
  };
}

export const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Static local report: no scripts, external requests, or automatic approval. */
export function gallery(
  report: Report,
  media: Record<string, { source: string; output?: string }>,
  refs: { slug: string; image: string }[],
): string {
  const e = escapeHtml;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Bevi icon quality evaluation</title><style>
body{font:16px system-ui;margin:24px;background:#eee;color:#222}article{background:white;margin:24px 0;padding:20px}
.images,.tiles{display:flex;flex-wrap:wrap;gap:16px;align-items:center}.source,.output{width:240px;height:320px;object-fit:contain}
.tile{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;background:#faf8f3}
.dark{background:#25292c}.tile img{width:84%;height:84%;object-fit:contain}.ref{width:100px;height:130px;object-fit:contain}
pre{white-space:pre-wrap}small{display:block}figure{margin:8px}code{overflow-wrap:anywhere}</style>
<h1>Bevi icon quality evaluation</h1><p>${e(report.mode)} · ${e(report.model)} · ${
    e(report.runId)
  }</p>
<p>Technical success is not visual approval. Score fidelity, style, cutout and small-size recognition in review.json.
Lettering is not composited by this pipeline; these are unlettered candidates.</p>
<h2>Style references</h2><div class="images">${
    refs.map((r) =>
      `<figure><img class="ref" src="${e(r.image)}" alt="${e(r.slug)}"><figcaption>${
        e(r.slug)
      }</figcaption></figure>`
    ).join('')
  }</div>
${
    report.results.map((c) =>
      `<article><h2>${e(c.id)} — ${e(c.status)}</h2><p>${e(c.expected)}</p>
<p>${e(c.tags.join(', '))} · ${c.elapsedMs} ms</p><div class="images">
<figure><img class="source" src="${
        e(media[c.id].source)
      }" alt="Source photo"><figcaption>Source</figcaption></figure>
${
        media[c.id].output
          ? `<figure><img class="output" src="${
            e(media[c.id].output!)
          }" alt="Generated icon"><figcaption>Candidate</figcaption></figure>`
          : `<p>${e(c.error ?? 'No output')}</p>`
      }</div>
${
        media[c.id].output
          ? `<div class="tiles">${
            [40, 56, 96, 155].flatMap((size) =>
              ['', 'dark'].map((bg) =>
                `<figure><span class="tile ${bg}" style="width:${size}px;height:${size}px"><img src="${
                  e(media[c.id].output!)
                }" alt="${size}px ${bg || 'light'} preview"></span><figcaption>${size}px ${
                  bg || 'light'
                }</figcaption></figure>`
              )
            ).join('')
          }</div>`
          : ''
      }
<small>SHA-256: <code>${e(c.outputSha256 ?? 'no output')}</code></small></article>`
    ).join('')
  }</html>`;
}
