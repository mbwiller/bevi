import { useAnnounce } from '@/lib/useAnnounce';

/**
 * Renders nothing; has VoiceOver say `text` when it appears or changes (see `useAnnounce`). For a
 * status or error line that is rendered conditionally, where a hook can't sit: put it beside the line.
 */
export function Announce({ text }: { text?: string | null }) {
  useAnnounce(text);
  return null;
}
