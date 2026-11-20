import { Markdown } from '@/features/settings/Markdown';
import { PRIVACY_MARKDOWN } from '@/features/settings/privacyText.generated';
import { SettingsScreen } from '@/features/settings/SettingsRow';

/**
 * Settings › Privacy (§6.18): the privacy note, rendered as plain paragraphs. It is a bundled copy
 * of app/public/privacy.md (scripts/gen-privacy-text.mjs), so it needs no network on any platform;
 * the web also serves the file itself at /privacy.md as the public policy URL.
 */
export default function PrivacyScreen() {
  return (
    <SettingsScreen title="Privacy">
      <Markdown source={PRIVACY_MARKDOWN} />
    </SettingsScreen>
  );
}
