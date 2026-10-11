import { useId, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { radius, spacing, type, useTheme } from '@/theme';

export interface TextFieldProps {
  label?: string;
  /** Controlled text. */
  value?: string;
  /** Initial text when uncontrolled. */
  defaultValue?: string;
  placeholder?: string;
  /** Fixed text before the input ("@" for handles). */
  prefix?: string;
  /** Help under the field, in `textSecondary`. */
  hint?: string;
  /** Replaces the hint in `scoreLow` and turns the outline `scoreLow`. Say what to do: "That handle is taken." */
  error?: string;
  /** The HTML input type it stands for: `password` hides the text, `email`/`tel`/`url`/`numeric` pick the keyboard. */
  type?: 'text' | 'password' | 'email' | 'tel' | 'url' | 'numeric' | 'search';
  /** The input's DOM id on web. */
  id?: string;
  /** The new text (the design system passes the input's change event; React Native passes the string). */
  onChange?: (v: string) => void;
  /** Return / the keyboard's Go key. */
  onSubmit?: (v: string) => void;
  /** Browser autofill hint: `username`, `current-password`, `new-password`, `off`… */
  autoComplete?: TextInputProps['autoComplete'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoFocus?: boolean;
  enterKeyHint?: TextInputProps['enterKeyHint'];
  maxLength?: number;
  editable?: boolean;
  style?: StyleProp<ViewStyle>;
}

const BOX = 48;
const INPUT_MODE: Record<NonNullable<TextFieldProps['type']>, TextInputProps['inputMode']> = {
  text: 'text',
  password: 'text',
  email: 'email',
  tel: 'tel',
  url: 'url',
  numeric: 'numeric',
  search: 'search',
};

/** Labelled 48pt text field for onboarding, settings and the create-Bev wizard. */
export function TextField({
  label,
  value,
  defaultValue,
  placeholder,
  prefix,
  hint,
  error,
  type: kind = 'text',
  id,
  onChange,
  onSubmit,
  autoComplete,
  autoCapitalize,
  autoFocus,
  enterKeyHint,
  maxLength,
  editable = true,
  style,
}: TextFieldProps) {
  const { colors, elevation } = useTheme();
  const [focused, setFocused] = useState(false);
  const input = useRef<TextInput>(null);
  const auto = `bv-field-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const fid = id ?? auto;
  const message = error || hint;
  const plain = kind === 'password' || kind === 'email' || kind === 'url';
  return (
    <View style={[styles.field, style]}>
      {label ? (
        <Text id={`${fid}-label`} style={[type.caption, styles.label, { color: colors.textSecondary }]}>
          {label}
        </Text>
      ) : null}
      {/* Tapping the box (or the prefix) focuses the input. */}
      <Pressable
        onPress={() => input.current?.focus()}
        accessible={false}
        focusable={false}
        style={[
          styles.box,
          { borderColor: error ? colors.scoreLow : focused ? colors.primary : colors.borderStrong, backgroundColor: colors.surface },
          focused && { boxShadow: elevation.focusRing },
        ]}
      >
        {prefix ? (
          <Text style={[type.bodyLarge, styles.prefix, { color: colors.textSecondary }]} aria-hidden>
            {prefix}
          </Text>
        ) : null}
        <TextInput
          ref={input}
          id={fid}
          value={value}
          defaultValue={defaultValue}
          onChangeText={onChange}
          onSubmitEditing={onSubmit ? (e) => onSubmit(e.nativeEvent.text) : undefined}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel={label ?? placeholder}
          aria-labelledby={label ? `${fid}-label` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? `${fid}-msg` : undefined}
          secureTextEntry={kind === 'password'}
          inputMode={INPUT_MODE[kind]}
          autoComplete={autoComplete}
          autoCapitalize={autoCapitalize ?? (plain ? 'none' : undefined)}
          autoCorrect={plain ? false : undefined}
          spellCheck={plain ? false : undefined}
          autoFocus={autoFocus}
          enterKeyHint={enterKeyHint}
          maxLength={maxLength}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[styles.input, { color: colors.text }]}
        />
      </Pressable>
      {message ? (
        <Text
          id={`${fid}-msg`}
          style={[type.caption, { color: error ? colors.scoreLow : colors.textSecondary }]}
          accessibilityLiveRegion={error ? 'polite' : undefined}
        >
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6, alignSelf: 'stretch' },
  label: { fontWeight: '600' },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    height: BOX,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.input,
  },
  prefix: { marginRight: 2 },
  // 17pt (bodyLarge) also keeps iOS Safari from zooming the page on focus (it zooms below 16px).
  input: { ...type.bodyLarge, flex: 1, minWidth: 0, alignSelf: 'stretch', padding: 0, borderWidth: 0, outlineWidth: 0 },
});
