# BucketButton

Gut-check choice in the ranking flow: a capsule with a glossy orb in its bucket colour that fills with that colour when chosen. It is a flat tint by default, and always on the Bevi web app; liquid glass only with the native glass material on iOS 26+.

- Provide: `bucket` (loved, fine, disliked), `selected`, `material`, `onClick`. Always show all three, in that order, 14pt apart, full width on the 16pt gutter.
- Labels and faces are fixed: "Loved it" (laugh), "It was fine" (meh), "Didn't like it" (frown). The label always shows, so a bucket is never told apart by colour alone; the chosen one also gets a ring and a filled check.
- `material="tint"` (default): 64pt high, `radius-card` corners, a 12% bucket tint and a 4px bucket bar on the left; no blur, no shadow. The Bevi web app always uses it, in every browser, including the home-screen app on iOS 26.
- `material="glass"`: `glassFill` with a 24px blur over a BevGlow, a `glassStroke` rim, a top sheen and `elevation-glass`. Render it only where the OS has a real glass material: iOS 26+, with the native `GlassView` from expo-glass-effect, which only a native build has. Never imitate it with a blur view or CSS `backdrop-filter`. The orb, label, check and pour are identical in both materials. Reduce Transparency switches glass to tint on every platform.
- Choosing one pours: the liquid (the bucket colour mixed 45% into `surface`, 70% opaque) rises to two-thirds in 450ms under a moving surface with a light meniscus and a few rising bubbles. The meniscus stays above the label, never across it. Reduce Motion keeps the level and stops the waves and bubbles. Draw the waves with react-native-svg and drive the pour with Reanimated.
- Contrast, worst case (glass over any BevGlow, checked against black, white and saturated drink colours with every blob overlapping): `text` stays at least 9.8:1 in light and 5.7:1 in dark, poured or not. On the tint material it stays at least 7.3:1.
- Don't add a fourth option, use glass for other buttons, or tint the label text with the bucket colour.
