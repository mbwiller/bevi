# App Store submission pack (IM-12, gate G4)

Everything App Store Connect asks for before a version can be sent to review,
drafted so that submitting is filling in forms, not writing. **Drafts, not
decisions**: the listing copy is the founders' voice and the questionnaire
answers are statements made to Apple in our name, so one of us reads every
line before it is typed in.

Written 2026-11-19. Companion to `DEVELOPMENT-MATT-IOS.md` (IM-12) and
`DEVELOPMENT-ARJUN-IOS.md` (IA-8). The walk on a phone is
`docs/ios-device-checklist.md`.

## 1. What still stands between the code and "Waiting for Review"

In order. The first group needs one of us and an account; nothing in the
repository can do it.

| # | What | Who | Why it blocks |
|---|---|---|---|
| 1 | A new TestFlight build from the commit that contains this work | Arjun (EAS) | Build 0.1.0 (3) is from `e1f0b1f` and predates photos, the scanner, the gate, report and block |
| 2 | Walk `docs/ios-device-checklist.md` on that build | Either | G2. Jest mocks every native module, so nothing below is proven until a phone says so |
| 3 | A support address, and the App Store id | Either | The "Update required" screen, Settings and the listing all need a way to reach us (Guideline 1.2 asks for published contact). Both are `null` in `app/src/lib/appStore.ts` |
| 4 | Decide what G3's crash check means now | Both | Sentry was dropped on 2026-11-19 for an in-house reporter, which is not built. Until it is, native crashes show only in Apple's own reports (TestFlight, App Store Connect, Xcode Organizer) and a JS error shows the "Something went wrong" screen and is recorded nowhere (§7) |
| 5 | Who reads `content_reports`, and how fast | Both | Guideline 1.2 expects reports to be acted on, in practice within 24 hours. Today a report is a row nobody is told about (§6) |
| 6 | Screenshots | Matt (needs a simulator or a phone) | §3 |
| 7 | The privacy policy's two stale lines | Both | §5: "no analytics" once crash reporting is on, and "ask the person who invited you" as the only contact |
| 8 | Seed the demo account on the hosted project and note its credentials in App Store Connect | Arjun | §8. Review cannot get past the invite code alone |

## 2. App information

| Field | Value |
|---|---|
| Name | Bevi |
| Bundle id | `app.bevi.ios` (team `9NA45GL4CJ`) |
| Primary language | English (U.S.) |
| Primary category | Food & Drink |
| Secondary category | Social Networking |
| Price | Free, no in-app purchases |
| Devices | iPhone only (`supportsTablet: false`; an iPad runs it in compatibility mode) |
| Minimum iOS | 16.4 |
| Version | 0.1.0 as built today. Decide whether the first public version is 1.0.0; it is one line in `app/app.config.ts` and changes the runtime version of every later update |
| Export compliance | Standard HTTPS only; `usesNonExemptEncryption: false` is already in the binary, so App Store Connect does not ask |
| Privacy policy URL | `https://bevi-gamma.vercel.app/privacy.md` until Bevi has a domain. Check that it opens in a browser as a readable page; a raw Markdown file is a weak thing to show a reviewer |
| Support URL | Needed. There is no support page yet |

## 3. Listing copy (draft)

**Subtitle** (30 characters max):

> Rank every drink you've had

**Promotional text** (170 max, can change without a review):

> Compare drinks head to head and Bevi builds your personal ranking. See what
> your friends are drinking and what to try next.

**Description:**

> Bevi is where you rank every drink you've ever had.
>
> You never type a score. Add a drink, answer a few "better or worse than
> this?" questions, and Bevi places it on your list and works out its score
> from where it lands.
>
> - Rank anything: sodas, coffee, tea, energy drinks, juice, and more.
> - See what your friends are drinking, and save what looks good to Want to
>   Try.
> - A leaderboard of the best Bevs, overall and by category.
> - "We think you'd rate this" predictions for drinks you haven't tried.
> - Can't find a drink? Add it with a photo, or scan its barcode.
>
> Bevi is invite-only for now: you need a code from someone already on it.
> No ads and no tracking.

**Keywords** (100 characters, comma-separated, no spaces after commas):

> drinks,ranking,rate,beverage,soda,coffee,tea,energy drink,boba,leaderboard,friends,list

**Screenshots.** 6.9" (1320 x 2868) is required and covers the smaller sizes;
add 6.5" (1284 x 2778) only if App Store Connect asks. No iPad set. Take them
signed in as the seeded demo account so the feed, lists and leaderboard are
full: the feed, a ranking comparison, your list, a Bev's page with its
predicted score, the leaderboard, a profile. A browser at phone width is not a
substitute: the status bar and safe areas are wrong.

## 4. Age rating

The catalog has beer, wine, spirits and cocktails, and the app shows other
people's posts, comments and photos. Answer the questionnaire as it is asked;
the tier is its output, not our choice (Apple's tiers changed in 2025, so do
not carry an expected number in from older notes). What is true of the app:

| Question area | Truthful answer |
|---|---|
| Alcohol, tobacco or drug use or references | Yes: references to alcoholic drinks. No sale, no encouragement of excess |
| User-generated content | Yes: posts, comments, notes, photos, profiles |
| Messaging or chat between users | Comments on posts only; no private messages |
| Unrestricted web access | No |
| Gambling, contests, violence, sexual content, horror, medical | No |
| Advertising | No |
| Parental controls / age assurance | The app asks for a birth date and hides the three alcoholic categories server-side for anyone under 21 (`can_see_alcohol`). That is content gating, not age verification; say exactly that |

IS-3 (the demo account's age) is still open: the default is over 21 with
alcohol visible, so the reviewer sees the whole catalog.

## 5. App Privacy

What the binary collects, by Apple's categories. "Linked" means tied to the
account. Nothing is used for tracking and there is no advertising or
third-party analytics SDK, so no tracking prompt is needed. Keep it that way:
adding one changes these answers and needs a review.

| Apple's data type | Collected | What it is | Linked | Purpose |
|---|---|---|---|---|
| Contact info: name | Yes | Display name | Yes | App functionality |
| Identifiers: user ID | Yes | Username | Yes | App functionality |
| User content: photos or videos | Yes | Photos of a drink or a nutrition label, a profile photo | Yes | App functionality |
| User content: other user content | Yes | Rankings, notes, comments, lists, follows, reports you file, the place tagged on a ranking | Yes | App functionality |
| Sensitive info / other data | Check the form's wording | Birth date, used only to decide whether alcohol is shown | Yes | App functionality |
| Diagnostics: crash data | No, today. The app sends no crash data of its own; Apple's crash reports are Apple's, shared by the person in iOS settings. This becomes Yes the day the in-house reporter ships | | | |
| Location: coarse | **Founders to decide** (recommended: Yes) | Since BEV-22 the binary asks for When In Use location. The phone's position is sent with each place search and not stored; the Search more places fallback passes Google a position rounded to 3 decimals. Apple counts data a third party may keep, so the safe answer is Coarse location, not linked, App functionality | No | App functionality |
| Location: precise | No | No position is stored. The place a person tags is a venue they chose, stored with the ranking: answer it under User content. Uploaded photos are re-encoded, which strips their GPS data: **verify on a phone before claiming it** (device checklist) | | |
| Contacts, browsing history, search history, purchases, financial, health, usage data, advertising data | No | | | |

One line of `app/public/privacy.md` needs a decision before submission:
"Questions: ask the person who invited you to Bevi." is not a published
contact. Replace it with the support address. ("No ads, no tracking, no
analytics" is true as built. It needs a sentence about crash reports the day
the in-house reporter ships, and not before.)

After editing `privacy.md`, run `node scripts/gen-privacy-text.mjs` from
`app/`: the in-app Privacy screen renders a bundled copy, and a test fails
when the two drift.

## 6. User-generated content (Guideline 1.2)

The most likely rejection. What the app has, as of contract 3.1.0:

- **Report**: a post, a comment or a profile, with a reason and an optional
  note, from a "More actions" control on each.
- **Block**: mutual and immediate. Each side disappears from the other's feed,
  comments, search, suggestions, follower lists and leaderboard, and any
  follow between them is removed. Settings > Blocked accounts undoes it.
- **Filtering**: alcohol is hidden server-side from anyone under 21.
- **Account deletion**: Settings > Delete account, with no need to contact us.

What it does not have yet, and review asks about:

- **Somebody reading the reports.** A report is a row in `content_reports`
  with status `open`. Nothing notifies anyone. Decide who checks it and how
  often, and write that into the review notes as a commitment we can keep. A
  notification (an email or a Slack message from a database webhook) is a
  small piece of backend work if we want one.
- **Published contact**: the support address (§1, row 3).
- **Terms that forbid objectionable content.** There is no terms-of-use text
  in the app. A short one shown at sign-up is the usual answer.

## 7. Crash reporting

Sentry was considered and dropped on 2026-11-19: the reporter will be built in
house, after the launch blockers. What the binary has today:

- A root error boundary: a screen that throws while rendering shows "Something
  went wrong" with Try again instead of closing the app.
- A `captureError` seam (`app/src/lib/crashReporting.ts`) with scrubbing, and
  the rule that expected API errors are never reported. Nothing is registered
  behind it, so nothing is sent anywhere.
- Native crashes are visible only through Apple: TestFlight's crash feedback,
  App Store Connect, and Xcode's Organizer on a Mac signed in to the team.

So gate G3's "crash reports arrive symbolicated" cannot be met as written. It
either waits for the in-house reporter or is restated as "a crash on a
TestFlight build shows in App Store Connect".

## 8. Review notes (draft)

Paste into App Store Connect > App Review Information. **The demo credentials
are typed there and nowhere else: this repository is public.**

> Bevi is an invite-only app for ranking drinks among friends. Sign-up needs
> an invite code from an existing member, so please use the demo account
> below; it has a week of activity, a ranked list, follows and comments.
>
> Username: (from the demo seed)
> Password: (from the demo seed)
> Invite code, if you would like to try sign-up: (a live code; it will not be
> rotated during review)
>
> User-generated content: people post rankings, notes, photos and comments.
> Any post, comment or profile can be reported from its "More actions"
> control, and any account can be blocked, which hides each person from the
> other at once. Blocked accounts are listed in Settings > Blocked accounts.
> We review reports within (commitment from §6). Contact: (support address).
>
> Alcohol: the catalog includes beer, wine and spirits. The app asks for a
> birth date at sign-up and hides those categories for anyone under 21; the
> filter is applied on the server.
>
> Account deletion: Settings > Delete account.
>
> The Map tab shows an "In progress" page in this version.

About that last line: Apple can reject a placeholder screen under 2.1. The
decision of 2026-11-18 stands, and the tab is one line to hide in
`app/src/app/(tabs)/_layout.tsx` if review asks. Hiding it before submitting
is the safer of the two.

Seeding the demo account on the hosted project is deliberate and guarded:
`npm run demo:seed -- --hosted` with `BEVI_SEED_ALLOW_HOSTED` set to the
project ref and `BEVI_DEMO_PASSWORD` set (see the header of
`scripts/demo/seed.ts`). It writes to the live database through the same RPCs
the app uses.

## 9. Release mechanics

Two things to watch on the first upload from this branch:

- **A missing-purpose-string mail (ITMS-90683).** The binary now links
  `expo-camera`, and the config deliberately has no microphone string because
  the app never records sound. If App Store Connect answers the upload asking
  for `NSMicrophoneUsageDescription`, the fix is one option in
  `app/app.config.ts` (`microphonePermission` on the `expo-camera` plugin, as a
  sentence instead of `false`) and a new build. Nobody has seen the answer
  yet.
- **Remove builds 0.1.0 (2) and (3) from TestFlight** once the new build is on
  both phones. They are contract 2.15.0 and never read `app_config`, so
  neither maintenance nor "update required" can reach them.


- A release build is cut from a commit on `main` whose checks are green, and
  that commit is tagged `v<version>-<build>` so the repository can answer
  "which commit is on my phone".
- `eas build --platform ios --profile production`, then
  `eas submit --platform ios --profile production --id <build id> --non-interactive`.
  The submit profile in `app/eas.json` names the App Store Connect app and EAS
  holds the submission key, so the submit needs no Apple sign-in. Run `eas`
  under Node 22: a newer Node computes a different runtime version.
  `ios.yml` does the same on a dispatch once the `ios` GitHub Environment and
  its secrets exist; until then builds come from Arjun's machine.
- Release the first version manually (not automatically on approval), with
  Phased Release on.
- A JavaScript-only fix after release goes out with
  `eas update --channel production --environment production`, to builds with the same runtime version
  only. The guidelines allow that for fixes, not for changing what the app
  does.
- Never raise `min_app_version` above a version every supported iPhone can
  install, and never before a build with the "Update required" screen is what
  the store is serving (`supabase/CLAUDE.md`).
