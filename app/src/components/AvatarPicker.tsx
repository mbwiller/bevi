import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, spacing, type, useTheme } from '@/theme';

import { Avatar } from './Avatar';
import { TARGET_MIN } from './HitTarget';

export interface AvatarPickerProps {
  /** The person's name: the initials when there is no photo. */
  name: string;
  src?: string;
  /** A photo is uploading: a spinner over the circle and both buttons disabled. */
  busy?: boolean;
  /** A `scoreLow` caption under the buttons ("Couldn't upload your photo. Try another one."). */
  error?: string;
  /** "Add a photo" / "Change photo": opens the photo picker. */
  onChange?: () => void;
  /** "Remove": back to initials. Shown only with a photo (`src`). */
  onRemove?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** bundle.css `.bv-avatarpicker-busy .bv-spinner`: 24px. */
const SPINNER = 24;
/** bundle.css `.bv-avatarpicker-change:disabled`: opacity .5. */
const DISABLED_OPACITY = 0.5;

/**
 * Your own photo where it can be changed (Edit profile, the onboarding profile step): an Avatar 100
 * over a `primary` text button, plus "Remove" in `textSecondary` when there is a photo. The caller
 * saves a chosen photo as soon as it uploads, so there is no Save step here.
 */
export function AvatarPicker({ name, src, busy = false, error, onChange, onRemove, style }: AvatarPickerProps) {
  const { colors } = useTheme();
  const dim = busy ? { opacity: DISABLED_OPACITY } : null;
  return (
    <View style={[styles.root, style]}>
      <View style={styles.circle}>
        <Avatar name={name} src={src} size={100} />
        {busy ? (
          <View
            style={[styles.busy, { backgroundColor: colors.photoScrim }]}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Uploading your photo"
            aria-busy
          >
            <ActivityIndicator size={SPINNER} color={colors.onDeep} />
          </View>
        ) : null}
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={onChange}
          disabled={busy || !onChange}
          accessibilityRole="button"
          accessibilityLabel={src ? 'Change photo' : 'Add a photo'}
          accessibilityState={{ disabled: busy }}
          style={[TARGET_MIN, dim]}
        >
          <Text style={[type.body, styles.change, { color: colors.primary }]}>{src ? 'Change photo' : 'Add a photo'}</Text>
        </Pressable>
        {src && onRemove ? (
          <Pressable
            onPress={onRemove}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Remove photo"
            accessibilityState={{ disabled: busy }}
            style={[TARGET_MIN, dim]}
          >
            <Text style={[type.body, { color: colors.textSecondary }]}>Remove</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text style={[type.caption, styles.error, { color: colors.scoreLow }]} role="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: spacing.xs },
  circle: { position: 'relative' },
  busy: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  change: { fontWeight: '600' },
  error: { textAlign: 'center' },
});
