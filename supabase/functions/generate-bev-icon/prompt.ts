// The prompt, and which style references go with it.
//
// Both are load-bearing and both were settled by measurement on 2026-11-11,
// not by taste. Pulled out of `index.ts` so they can be read, reviewed and
// tested without the HTTP and storage plumbing around them.

export interface StyleRef {
  slug: string;
  /** 'tall-glass' | 'stemmed' | 'rocks' -- see scripts/icons/export-style-refs.mjs. */
  shape: string;
  bytes: Uint8Array;
}

/**
 * Two instructions here are NOT stylistic preferences, and removing either one
 * breaks the pipeline:
 *
 *   NO LETTERING. The model's output filter rejects a recognisable brand mark
 *   outright, with error 3030, deterministically -- a photo of a branded
 *   bottle plus "keep the wordmark legible" failed every time, and the same
 *   photo with lettering forbidden succeeded. The wordmark is composited
 *   afterwards from what the user typed, which is also a cleaner posture than
 *   asking a model to reproduce a trademark.
 *
 *   NO SHADOW. A drawn shadow cannot be matted: its dark core is not connected
 *   to the background, so the flood fill leaves an opaque grey ellipse, plainly
 *   visible on the app's dark surface. `compositeShadow` draws the real one
 *   from `style.mjs`'s own geometry instead, so generated and authored icons
 *   match exactly.
 *
 * The rest mirrors `design/beverage-icons/skill/SKILL.md`'s "Shared drawing
 * language", which is what the authored catalogue was drawn to.
 */
export function buildPrompt(categoryId: string): string {
  return [
    'Redraw the drink in the first photograph as a product illustration in exactly the drawing style of the illustrations that follow it.',
    '',
    'Match those references precisely: the same soft dimensional gradients, the same restrained white specular highlights down one side, the same elliptical rims seen slightly from above, the same light direction, the same perceived scale and the same level of detail. There are NO OUTLINES anywhere: no black linework, no dark contour strokes, no comic or sticker edges. Every edge is defined only by a change in colour or shading.',
    '',
    `Keep the real ${containerHint(categoryId)} recognisable: its true proportions, its closure, and the colours of its label.`,
    'Render any label as plain flat bands of colour only, in the colours of the photograph. No lettering, no words, no logos, no brand marks, no numbers and no symbols anywhere in the image.',
    '',
    'Remove the hand, the background and every other object. Draw NO shadow, NO reflection and NO contact shadow of any kind. Nothing but the drink itself, upright and centred, on a plain flat pure white background.',
  ].join('\n');
}

/**
 * A nudge toward the right container, from the Bev's own category. The
 * photograph carries the form; this just stops the model drifting toward the
 * glassware the references happen to show.
 */
function containerHint(categoryId: string): string {
  switch (categoryId) {
    case 'soda':
    case 'diet_soda':
    case 'energy':
    case 'sparkling_water':
      return 'can or bottle';
    case 'water':
    case 'juice':
    case 'sports':
    case 'tea':
      return 'bottle';
    case 'coffee':
    case 'boba':
    case 'smoothie':
      return 'cup or glass';
    case 'beer':
    case 'wine':
    case 'spirits_cocktails':
      return 'glass';
    default:
      return 'container';
  }
}

/**
 * Which references to send, given the model takes at most four images and the
 * photograph is one of them.
 *
 * Every unbranded icon in the catalogue is a served drink, so there is no
 * unbranded can or bottle to offer -- and that turns out not to matter: the
 * spike produced a correct PET bottle from three glassware references, because
 * the references teach STYLE and the photograph teaches FORM. So this prefers
 * a shape that suits the category and then fills the remaining slots from
 * whatever else is there, deterministically (sorted by slug) so the same Bev
 * would be drawn from the same references on a retry.
 */
export function pickReferences(refs: readonly StyleRef[], categoryId: string, limit: number): StyleRef[] {
  const preferred = preferredShape(categoryId);
  const sorted = [...refs].sort((a, z) => (a.slug < z.slug ? -1 : a.slug > z.slug ? 1 : 0));
  const first = sorted.filter((r) => r.shape === preferred);
  const rest = sorted.filter((r) => r.shape !== preferred);
  return [...first, ...rest].slice(0, limit);
}

function preferredShape(categoryId: string): string {
  switch (categoryId) {
    case 'beer':
    case 'wine':
    case 'spirits_cocktails':
      return 'stemmed';
    case 'coffee':
    case 'boba':
    case 'smoothie':
      return 'tall-glass';
    default:
      return 'tall-glass';
  }
}
