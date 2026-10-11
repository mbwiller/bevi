import { Text, type StyleProp, type TextStyle } from 'react-native';

export interface PriceTierProps {
  tier: 1 | 2 | 3 | 4;
  /** Bevi estimated the price: prefixed with "~". */
  estimated?: boolean;
  /** Inherits the meta line's size and colour when nested in a Text; style it here when standalone. */
  style?: StyleProp<TextStyle>;
}

/** "$"–"$$$$" as text: "$$", or "~$$" when estimated. */
export function priceTierText(tier: number, estimated = false): string {
  return (estimated ? '~' : '') + '$'.repeat(Math.max(1, Math.min(4, Math.round(tier))));
}

/** Price tier as Beli prints it in a meta line: just the active count of $; "~" when estimated. */
export function PriceTier({ tier, estimated = false, style }: PriceTierProps) {
  const dollars = priceTierText(tier);
  return (
    <Text
      style={[{ fontVariant: ['tabular-nums'] }, style]}
      accessibilityLabel={estimated ? `about ${dollars}, estimated` : dollars}
    >
      {priceTierText(tier, estimated)}
    </Text>
  );
}
