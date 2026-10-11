import { Image } from 'expo-image';
import { useId } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { radius, size, spacing, type, useTheme } from '@/theme';

import { BevArt, type BevArtProps } from './BevArt';

export interface FeaturedCardProps {
  title: string;
  /** "Boba • $$" for a Bev, "You've had 3 of 10" for a list. */
  subtitle?: string;
  /** A polished full-bleed image (shown under the scrim). */
  src?: string;
  /** Placeholder art when there is no image, on `tint`. */
  art?: BevArtProps;
  /** Backdrop behind `art`: the product's colour, not a token. */
  tint?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** bundle.css `.bv-featured-art`: a 108pt drawing 8pt from the top; title 10pt from the bottom. */
const ART = 108;
const ART_TOP = 8;
const TEXT_BOTTOM = 10;

/** 164pt square photo card for the Featured carousel: image, a `photoScrim` gradient, white title and subtitle. */
export function FeaturedCard({ title, subtitle, src, art, tint, onPress, style }: FeaturedCardProps) {
  const { colors } = useTheme();
  const scrimId = `featured-scrim-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const onDeep = { color: colors.onDeep };
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      style={[styles.card, { backgroundColor: tint ?? colors.input }, style]}
    >
      {src ? (
        <Image source={{ uri: src }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={src} accessible={false} />
      ) : art ? (
        <View style={styles.art}>
          <BevArt {...art} />
        </View>
      ) : null}
      {/* linear-gradient(to top, photoScrim 0%, transparent 66%) */}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
        <Defs>
          <LinearGradient id={scrimId} x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor={colors.photoScrim} />
            <Stop offset="0.66" stopColor={colors.photoScrim} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${scrimId})`} />
      </Svg>
      <View style={styles.text}>
        <Text style={[type.screenTitle, onDeep]} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[type.body, onDeep]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: size.featuredCard,
    height: size.featuredCard,
    borderRadius: radius.photo,
    overflow: 'hidden',
    flexShrink: 0,
  },
  art: { position: 'absolute', top: ART_TOP, left: (size.featuredCard - ART) / 2, width: ART, height: ART },
  text: { position: 'absolute', left: spacing.md, right: spacing.md, bottom: TEXT_BOTTOM },
});
