# BEV-15: generated icon quality evaluation

Technical success is not visual approval. This tool exercises the same
`generateIcon` / `finishRender` implementation as the deployed worker, then
creates a private, self-contained review gallery. It never claims a Supabase
job, writes an icon bucket, publishes artwork, or configures cron.

## Implementation checklist

- [x] Share provider invocation and image finishing between worker and evaluator.
- [x] Preflight every input and reference before spending a model call.
- [x] Require explicit live mode and a call ceiling; no automatic retries.
- [x] Support offline replay of captured provider JPEGs.
- [x] Produce source/result comparisons and 40/56/96/155px light/dark tiles.
- [x] Record input, prompt, reference, code and output hashes, elapsed time and failures.
- [x] Keep human scores separate and bind them to exact run/output hashes.
- [x] Test the review gate, failure accounting and provider error paths.
- [ ] Collect at least 20 representative real-photo cases and reserve fresh holdouts.
- [ ] Run the baseline and have Matt/Arjun score it before changing the prompt.
- [ ] Tune failures, rerun, then evaluate fresh holdouts without further tuning.
- [ ] Approve the quality threshold and visual direction before tester activation.

The CLI's policy below is a **proposed pilot gate**, not an existing product
decision. Passing it does not implement regeneration, candidate selection or
production deployment. Those remain release work.

## Prepare a private suite

Keep photos, captured model images and generated reports outside the checkout.
The HTML embeds original photos, including any people or other private content.
Do not commit or publicly upload it. Existing spike photos are useful for smoke
tests but cannot replace a representative fresh dataset.

Create `/tmp/bevi-eval-inputs/suite.json`:

```json
{
  "version": 1,
  "cases": [
    {
      "id": "chai-top-down",
      "categoryId": "coffee",
      "photo": "photos/chai.jpg",
      "tags": ["cup", "top-down"],
      "expected": "Pale chai in a marbled paper cup. Preserve the visible rim and liquid; do not invent an ornate glass."
    }
  ]
}
```

Paths are local filesystem paths, relative to the suite file or absolute.
IDs must be unique slugs. `expected` is a human review instruction; it is **not
sent to the model**. Use a category ID from the actual catalog.
Supported source images for browser review: JPEG, PNG, WebP. Convert HEIC first.
Each photo is at most 12 MiB. Add at least 20 distinct photos covering the tags
`cup`, `layered`, `stemmed`, `bottle`, `can`, `dim`, `clutter`, `top-down`.
Tags describe the photo; they do not establish that a model handled it correctly.
Do not label a synthetic image or repeated crop as a fresh real-photo case.

## Export the production style references locally

Use the existing pinned renderer described in `design/beverage-icons/README.md`:

```sh
node scripts/icons/export-style-refs.mjs --dry-run
```

This renders only unbranded catalog artwork into the gitignored
`design/beverage-icons/style-refs/` directory and uploads nothing. If installed
elsewhere, set `BEVI_RESVG_MODULE` to the `@resvg/resvg-js@2.6.2` package directory.
The evaluator checks reference hashes and image dimensions before making calls.

## Preflight, live generation and replay

All commands below run from the repository root. Deno is required; there are
no new runtime dependencies.

```sh
# No network, credentials, output writes or model spend.
deno run --allow-read supabase/functions/generate-bev-icon/evaluation/cli.ts \
  --suite /tmp/bevi-eval-inputs/suite.json \
  --refs design/beverage-icons/style-refs/index.json

# One attempt per case; --max-calls must cover the suite (maximum 100).
# Reads only the two Cloudflare variables; no Supabase credentials are used.
deno run --env-file=supabase/.env --allow-read --allow-write \
  --allow-env=CF_ACCOUNT_ID,CF_API_TOKEN --allow-net=api.cloudflare.com \
  supabase/functions/generate-bev-icon/evaluation/cli.ts \
  --suite /tmp/bevi-eval-inputs/suite.json \
  --refs design/beverage-icons/style-refs/index.json \
  --run --max-calls 20 --out /tmp/bevi-eval-baseline
```

The output directory must be new; the CLI will not overwrite a previous run or
review. Calls run sequentially, with a 120-second request timeout. A quota
rejection stops further calls and records the remaining cases as unattempted
failures. Other provider failures are recorded without hidden retries. Reports
are checkpointed after every case. `providerCalls` counts attempted requests,
including transport failures; it is **not a billable-usage measurement**. Cost
is `null` because this API response does not establish cost. Reconcile actual
usage in the provider account rather than inventing a per-image price.

For offline replay, add `"render": "captures/chai-provider.jpg"` to each case
and replace `--run --max-calls 20` with `--replay`. This accepts the raw provider
JPEG (not an already matted PNG), runs the worker's exact finishing code and
spends no API calls. Its report records the captured JPEG hash. Replay never
passes the live-quality gate, because it does not test the current provider.
Successful live runs also save `<case-id>/provider.jpg` for future replay.

## Review and proposed acceptance policy

Open `index.html` from the output directory. Compare source, candidate, style
references and small-size previews. Then fill in `review.json`:

- `reviewer`: the person who inspected the run.
- `reviewedAt`: an ISO timestamp for that inspection.
- Score every completed candidate on `fidelity`, `style`, `cutout`, `smallSize`.
- Mark `severeDefect` for a wrong drink/container, missing major component,
  clipped subject, substantial opaque background, or another unusable result.
- Record concrete defects in `notes`. Do not change the output hash.

Use this shared 1–5 rubric:

| Score | Meaning |
|---|---|
| 1 | Unusable; wrong subject or broken rendering |
| 2 | Major visible defects; would reject |
| 3 | Usable with noticeable compromises |
| 4 | Good; minor defects only |
| 5 | Matches the drink and approved style very well |

`fidelity` checks vessel, proportions, liquid/layers, closure and toppings.
`style` checks gradients, perspective, light, perceived scale and shadow.
`cutout` checks halos, missing white/clear material, clipping and leftover scenery.
`smallSize` checks recognition and readability of the silhouette at app sizes.
This pipeline produces **unlettered candidates**; name/shop lettering still
needs its own implementation and visual acceptance before the complete feature
is ready. The report must not imply lettering has been verified.

```sh
deno run --allow-read supabase/functions/generate-bev-icon/evaluation/cli.ts \
  --check /tmp/bevi-eval-baseline
```

The proposed gate requires a live run of at least 20 cases, all eight coverage
tags, a dated human review, no severe defects, at least 90% usable results
(every axis at least 3), and means of at least 4 on each axis. Provider failures
and unattempted cases remain in the denominator. Unreviewed or changed outputs,
duplicate reviews and incomplete scores fail. The checker verifies the saved
PNG bytes as well as the review's output hash. A green gate is evidence for a
pilot, not automatic approval or deployment.

## Engineering checks

```sh
deno check supabase/functions/generate-bev-icon/index.ts \
  supabase/functions/generate-bev-icon/evaluation/cli.ts
deno test supabase/functions/generate-bev-icon/
```

Tests require neither credentials nor network. They cover input validation,
request construction, bounded provider reads, quota/transport failures, replay
rejection, review binding, failure denominators and HTML escaping, alongside
the existing image-processing suite. They cannot certify aesthetic quality.

## First smoke evaluation, 2026-11-15

Recovered Claude's `pocari-nohand.jpg` and `spike-shipped-refs.png` (despite its
suffix, the latter is a provider JPEG) from the existing private scratchpad.
Preflight and offline replay both completed without provider calls. A single
live Cloudflare request then completed in about 2.8 seconds and produced both
PNG sizes. An initial sandboxed transport attempt failed before that request;
its report is separate from the successful network-enabled run.

Visual inspection rejected the live candidate: the squat PET bottle became a
tall glass-like hybrid, the white cap became tan, and the clear liquid became
amber. This is **not** approved
artwork and not a representative benchmark. It demonstrates why image validity
must not imply product fidelity. The local report and review are in
`/tmp/bevi-icon-quality-live-network/`; photos and generated results are not
committed. Code hashes in that report identify the implementation at the time
of the run. Later runner changes do not retroactively update old evidence.
