import { useId, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { radius, spacing, type, useTheme } from '@/theme';

export interface TextAreaProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  /** Visible lines before it scrolls. */
  rows?: number;
  maxLength?: number;
  editable?: boolean;
}

const LINE = 22;

/**
 * A multi-line sibling of the design system's `TextField`, for the two long
 * fields of the bug reporter. It is local to this feature on purpose: the
 * design system has no textarea, and inventing one in `components/` would put
 * a component there that `components/index.d.ts` does not name.
 */
export function TextArea({ label, value, onChange, placeholder, hint, rows = 4, maxLength, editable = true }: TextAreaProps) {
  const { colors, elevation } = useTheme();
  const [focused, setFocused] = useState(false);
  const fid = `bv-area-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View style={styles.field}>
      <Text id={`${fid}-label`} style={[type.caption, styles.label, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <TextInput
        id={fid}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel={label}
        aria-labelledby={`${fid}-label`}
        aria-describedby={hint ? `${fid}-msg` : undefined}
        multiline
        numberOfLines={rows}
        maxLength={maxLength}
        editable={editable}
        // Return inserts a newline here; the form has an explicit submit button.
        submitBehavior="newline"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          type.bodyLarge,
          styles.input,
          {
            minHeight: rows * LINE + spacing.lg * 2,
            color: colors.text,
            backgroundColor: colors.surface,
            borderColor: focused ? colors.primary : colors.borderStrong,
          },
          focused && { boxShadow: elevation.focusRing },
        ]}
      />
      {hint ? (
        <Text id={`${fid}-msg`} style={[type.caption, { color: colors.textSecondary }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6, alignSelf: 'stretch' },
  label: { fontWeight: '600' },
  input: {
    alignSelf: 'stretch',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.input,
    textAlignVertical: 'top',
    outlineWidth: 0,
  },
});
