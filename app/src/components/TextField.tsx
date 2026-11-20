import { useEffect, useId, useRef, useState } from 'react';
import {
  InputAccessoryView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { radius, size, spacing, type, useTheme } from '@/theme';

import { useAnnounce } from '@/lib/useAnnounce';

import { registerField } from './fieldFocus';

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
  /**
   * Keeps the hint line's height open when there is no hint or error, for a hint that comes and goes while
   * the person types: the fields below never move.
   */
  reserveHint?: boolean;
  /** The HTML input type it stands for: `password` hides the text, `email`/`tel`/`url`/`numeric` pick the keyboard. */
  type?: 'text' | 'password' | 'email' | 'tel' | 'url' | 'numeric' | 'search';
  /**
   * The input's DOM id on web. With an id, the field also registers in `fieldFocus` while mounted,
   * so `focusField(id)` can move focus to it on native.
   */
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
/** iOS's number and phone pads have no return key, so these kinds get a "Done" bar above the keyboard. */
const PAD_KINDS: ReadonlyArray<NonNullable<TextFieldProps['type']>> = ['numeric', 'tel'];
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
  reserveHint = false,
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
  useEffect(() => (id ? registerField(id, () => input.current?.focus()) : undefined), [id]);
  const accessoryId = Platform.OS === 'ios' && PAD_KINDS.includes(kind) ? `${fid}-done` : undefined;
  const message = error || hint;
  // iOS ignores accessibilityLiveRegion: say a new error aloud (a hint is not announced, only read with the field).
  useAnnounce(error);
  // Text the system must not "fix": passwords, emails, urls, and anything told not to capitalise
  // (handles, invite codes), since iOS autocorrect and spellcheck would rewrite a handle or a code.
  const plain = kind === 'password' || kind === 'email' || kind === 'url' || autoCapitalize === 'none';
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
          // iOS: a "next" field keeps the keyboard up while its onSubmit moves focus, rather than
          // closing it and opening it again. react-native-web ignores this prop.
          submitBehavior={enterKeyHint === 'next' ? 'submit' : undefined}
          maxLength={maxLength}
          editable={editable}
          inputAccessoryViewID={accessoryId}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[styles.input, { color: colors.text }]}
        />
      </Pressable>
      {accessoryId ? (
        <InputAccessoryView nativeID={accessoryId}>
          <View style={[styles.accessory, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
            <Pressable
              onPress={() => input.current?.blur()}
              accessibilityRole="button"
              accessibilityLabel="Done"
              style={styles.done}
            >
              <Text style={[type.body, styles.doneText, { color: colors.primary }]}>Done</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
      {message || reserveHint ? (
        // With `reserveHint` this one Text stays mounted, empty or not, so its line never opens or closes.
        <Text
          id={`${fid}-msg`}
          testID={`${fid}-msg`}
          style={[type.caption, reserveHint && styles.reserved, { color: error ? colors.scoreLow : colors.textSecondary }]}
          accessibilityLiveRegion={error ? 'polite' : undefined}
          aria-hidden={message ? undefined : true}
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
  accessory: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing.gutter, borderTopWidth: 1 },
  done: { minHeight: size.target, minWidth: size.target, alignItems: 'center', justifyContent: 'center' },
  doneText: { fontWeight: '600' },
  // bundle.css `.bv-field-reserve`: one caption line, held open while there is no message.
  reserved: { minHeight: type.caption.lineHeight },
  // 17pt (bodyLarge) also keeps iOS Safari from zooming the page on focus (it zooms below 16px).
  input: { ...type.bodyLarge, flex: 1, minWidth: 0, alignSelf: 'stretch', padding: 0, borderWidth: 0, outlineWidth: 0 },
});
