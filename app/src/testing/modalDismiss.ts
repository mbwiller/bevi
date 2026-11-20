import { screen } from '@testing-library/react-native';

type Json = { type?: string; props?: Record<string, unknown>; children?: unknown } | string | null;

function modals(node: Json | Json[], out: Record<string, unknown>[]): Record<string, unknown>[] {
  if (!node || typeof node === 'string') return out;
  if (Array.isArray(node)) {
    for (const n of node) modals(n, out);
    return out;
  }
  if (node.type === 'Modal' && node.props) out.push(node.props);
  return modals(node.children as Json[] | null, out);
}

/**
 * The `onDismiss` of the Modal on screen now (the last one, when several are open). Jest's Modal mock
 * renders inline and never calls it; on iOS UIKit calls it once a Modal has really gone. Grab it
 * while the Modal is rendered, then call it inside `act` after the sheet has closed to play that.
 */
export function grabModalDismiss(): () => void {
  const found = modals(screen.toJSON() as Json, []).at(-1)?.onDismiss;
  if (typeof found !== 'function') throw new Error('No Modal with an onDismiss is on screen');
  return found as () => void;
}
