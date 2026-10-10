# UI research: skills, libraries and the rules we enforce

Phase 0 task 0.2 (DEVELOPMENT-MATT §2). Re-verified 2026-10-10 with `gh api` and `npm view`.

## Source of truth

The visual source of truth is the Bevi design system on claude.ai: https://claude.ai/artifact/WAYjGiTd5Fu938F6vv6Dyn, mirrored in `design/system/project/` (`README.md`, `tokens.json`, `components/index.d.ts`). Where it differs from DEVELOPMENT-MATT §4 or §5 (darker `textSecondary` and score colours, grape `primary`, the added components such as `BucketButton`, `BevGlow`, `UserRow`, `TextField`, `Header`), the design system wins. Changes to it go through Matt's design agent, not through this repo.

## Candidates

| Candidate | Verified | Verdict |
|---|---|---|
| `vercel-labs/agent-skills` → `skills/react-native-skills` | Exists, ~32k stars. No repo LICENSE file; README "License: MIT" and `license: MIT` in the skill's SKILL.md | **Adopted, vendored** in `.claude/skills/react-native-skills/` at `063bee94c3f4df8453406c830b0a7df0f2860278`, unchanged. Skill name `vercel-react-native-skills` |
| `anthropics/skills` → `skills/frontend-design` | Exists. No repo-level licence; the skill ships its own `LICENSE.txt` (Apache-2.0). Checked at `dbd4588f9e1033efb41dad4bef2f7947c8993d44` | **Not vendored, reference only** (§2 said adopt). It tells the agent to choose its own palette and typefaces and to avoid all-caps labels, middle-dot meta strings and `#111` text. Our design system pins all of these (`sectionCaps`, "`$$ • Diet soda`", `text #111111`). Loaded automatically on every UI task, it would pull screens away from the system. Use it only for new brand art, which happens in the claude.ai design project. To try it locally: copy `skills/frontend-design` from the commit above into `~/.claude/skills/` (personal, not the repo) |
| `anthropics/skills` → `brand-guidelines`, `theme-factory` | Both exist, each with its own `LICENSE.txt` | Not needed: the design system already is our brand and theme |
| `vercel-labs/agent-skills` → `web-design-guidelines` | Exists | Reference (web) |
| `Gentleman-Programming/Gentleman-Skills` → `community/react-native/SKILL.md` | MIT, ~660 stars (§2 had the path as `react-native` at the root) | Reference only |
| `founded-labs/react-native-reusables`, `nativewind` | MIT, ~8.7k / ~8.1k stars | Not used: `StyleSheet` + tokens |
| `react-native-reanimated` 4.7.1, `@shopify/flash-list` 2.3.3, `@gorhom/bottom-sheet` 5.2.14 | MIT | Adopt |
| `lucide-react-native` 1.55.0 | ISC | Adopt (the design system's `Icon` names) |
| `expo-image` | Part of Expo | Adopt |
| Apple HIG / Material 3 | — | HIG is the baseline; M3 for Android-only affordances |

## Facts that changed since §2/§3

- **Expo:** the latest stable SDK is **57** (`expo@57.0.27`). SDK 58 is canary only (`58.0.0-canary-20260909`). §3's "SDK 58" should read 57 until 58 ships.
- **Expo Router `src/app`:** no plugin option is needed. The router docs (`docs/pages/router/reference/src-directory.mdx` in expo/expo) say templates from SDK 55 on already use `src/app`, and moving `app/` to `src/app` needs only the `@/*` path alias pointed at `./src/*`. Drop the `["expo-router", { "root": "./src/app" }]` plugin line from §3.

## Where the design system overrides `react-native-skills`

The vendored skill loads for any RN work. Follow it, except:

1. **"Avoid multiple font sizes"** (`ui-styling`): no. Use the design system's type scale (`type.displayDrop` … `type.tabBar`).
2. **"Use native tabs"** (`navigation-native-navigators`): not for the tab bar. Our `TabBar` has a filled `primary` Add circle and an `Avatar` as the Profile icon, which native tabs can't render. Use Expo Router `Tabs` with a custom `tabBar`. Native stacks stay.
3. **`boxShadow` for shadows:** only `elevation-glass` under `BucketButton`. Nothing else has a shadow.
4. **Galeria lightbox** (`ui-image-gallery`): not needed in v1; `image/[url]` is a plain viewer.

## The rules we enforce (checked by `integrator-app`)

1. **Tokens only.** Colours, spacing, radii, type and sizes come from `app/src/theme`. No raw hex, no magic numbers that a token covers. Names map 1:1 from `tokens.json` (`space-md` → `spacing.md`).
2. **Design-system components by name.** Port `design/system/project/components` to `app/src/components/` under the same names and props, adapted to RN (`onClick` → `onPress`). Don't invent a parallel component.
3. **44pt targets.** Every touchable is at least 44×44 (`hitSlop` when the visual is smaller). Every touchable has an `accessibilityLabel` and `accessibilityRole`.
4. **4pt grid, 16pt gutter, 44pt header.**
5. **System font only.** Fredoka is never loaded in the app. The wordmark is the outlined SVG.
6. **No colour-only meaning.** A score always shows its number and a bucket its label. Score colour comes from the 7 / 4 bands via `@bevi/ranking`, never from hard-coded thresholds.
7. **No elevation.** Separate with 1pt `border`. Controls are outlined in `borderStrong`. The only exception is the glass `BucketButton` over a `BevGlow`, and only on iOS 26+.
8. **Motion:** Reanimated, transform and opacity only (plus the pour's height). Durations `fast` / `base` / `springy`. Under Reduce Motion, use cross-fades and stop shimmers. Under Reduce Transparency, glass becomes the tint material.
9. **Lists:** FlashList v2 for anything that can exceed 20 rows. Images through `expo-image` with `recyclingKey`. `Pressable`, never `Touchable*`.
10. **Icons:** `lucide-react-native` only, with the design system's names and sizes (28 / 24 / 16). One icon per category from the shared map. No emoji in the UI.
11. **Dynamic Type:** `maxFontSizeMultiplier` 1.3 on dense rows. Body text scales freely.
