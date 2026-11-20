/**
 * The accessible name of a Follow pill in either state: "Follow Friend A", or "Following Friend A"
 * once you do (`followLabel` in components/UserRow.tsx). A test that follows someone and then looks
 * the pill up again matches both, and reads the state from `aria-pressed` / `accessibilityState`.
 */
export function followPill(name: string): RegExp {
  return new RegExp(`^Follow(?:ing)? ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}
