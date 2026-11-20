# The iPhone walk (IM-11, layer 4)

What only a phone can prove, written down so that every gate is the same walk.
Jest renders through a test renderer with every native module mocked: it cannot
see the Keychain, the camera, a keyboard, a safe area, a modal's presentation
or a real request. Each line below exists because something merged that no
test on a laptop can vouch for.

Walk it on a **TestFlight build**, on the real backend, signed in as yourself
unless a step says otherwise. Note the build number at the top of your notes;
`eas build:list` says which commit it came from. A line that fails is a ticket
(the report button, or TestFlight's screenshot feedback), not a note in a chat.

There is one hosted backend and it is the live one. Everything here is safe to
do on it except where marked **use a test account**.

## 0. Before you start

- [ ] Settings shows the version and build you expect.
- [ ] iOS Settings > Bevi lists Camera and nothing unexpected (no Location, no
      Microphone, no Tracking).

## 1. Launch and session (IM-2, IM-3)

- [ ] Cold launch: the wordmark, then the feed. No white flash between the
      launch screen and the app, in light and in dark mode.
- [ ] Force-quit (swipe the app away), reopen: still signed in.
- [ ] Leave it in the background overnight, reopen: still signed in, and the
      feed refreshes without a pull.
- [ ] **Use a test account.** Delete the app, reinstall from TestFlight, open:
      signed out. (The Keychain outlives an uninstall; the app wipes it on a
      fresh install.)
- [ ] Offline launch with an expired token. Sign in, force-quit, wait more than
      an hour, turn on airplane mode, open the app: the wordmark for about five
      seconds, then "You're offline" with Retry. Never the sign-in screen. Turn
      airplane mode off: the app enters by itself within about fifteen seconds.

## 2. Connection (IM-4)

- [ ] Airplane mode while scrolling the feed: the "You're offline" strip
      appears; cached screens stay readable.
- [ ] Offline, like a post: it fails at once with its message, and the like
      rolls back.
- [ ] Airplane mode off: the strip goes by itself and lists refresh.
- [ ] On cellular only (Wi-Fi off), the feed loads and a photo uploads.

## 3. Photos (IM-5)

- [ ] New Bev > take a photo with the camera: the iOS camera prompt appears
      once, with Bevi's wording.
- [ ] A portrait photo straight from the camera (HEIC) shows unsquashed in the
      preview and on the Bev afterwards.
- [ ] The stored object is not 0 bytes: open the Bev on another device, or
      look at the object's size in the storage bucket.
- [ ] The upload carries no location: download the stored image and read its
      metadata (Preview > Tools > Show Inspector). No GPS section. Do this
      once with Location Services on for the Camera, so the original has it.
- [ ] Choose a photo from the library: no permission prompt (it is the system
      picker), and it uploads.
- [ ] iOS Settings > Bevi > Camera off, then take a photo: a line says what to
      do, with Open Settings, and Open Settings lands on Bevi's page.
- [ ] Change your profile photo: the spinner on the avatar is a normal size,
      and the new photo shows on your profile and in the feed.

## 4. Barcode scan (IM-5)

- [ ] New Bev > Scan barcode: the camera opens (no second prompt if the camera
      was already allowed).
- [ ] Scan a US can or bottle (UPC-A): one lookup fires, the preview stops,
      and the code shown has 12 digits.
- [ ] Scan a product with an EAN-13 that does not start with 0 (an imported
      drink), and an EAN-8 if you can find one: the digits are unchanged.
- [ ] Hold the camera on a barcode for several seconds: still one lookup.
- [ ] After the scan: the name, brand and category are filled in and the line
      under Scan barcode says which. With VoiceOver on, that line is read out
      once.
- [ ] In a new Bev, type a brand, then scan: the brand you typed is still
      there. Scan a second, different drink: the name and category change to
      the second one's.
- [ ] Close the sheet: the green camera dot in the status bar goes out.
- [ ] With the camera refused: the refused line and Open Settings, and typing
      the barcode by hand still works.
- [ ] Press Use this label and create the Bev: the barcode is on it afterwards.

## 5. Core flows (gate G2)

- [ ] Rank a Bev you have not ranked: the comparison flow, the note step, the
      result. Then re-rank it.
- [ ] Add a Bev with a photo, end to end.
- [ ] Lists: Want to Try add and remove; your list scrolls smoothly to the
      bottom and back.
- [ ] Search: results, recents persist after a force-quit.
- [ ] A profile: yours and someone else's; follow and unfollow.
- [ ] Share profile: the share sheet opens with a link, and the link opens the
      right profile in a browser.
- [ ] Settings > Privacy renders the policy text.
- [ ] **Use a test account.** Settings > Delete account, all the way through:
      signed out, and signing in again fails.

## 6. Keyboard and sheets (IM-6)

- [ ] Sign up: with the keyboard up, the Invite code field and Create account
      are reachable.
- [ ] Sign in and sign up: the username is not autocorrected or capitalised;
      iOS offers a saved password where it has one.
- [ ] A ranking's Edit note sheet: the field and Save stay above the keyboard.
- [ ] Comments: the composer sits just above the keyboard, fully visible.
- [ ] In any sheet with a field, with the keyboard up, the first tap on a
      button acts (it does not only dismiss the keyboard).
- [ ] Every sheet clears the home indicator at the bottom.
- [ ] Pull to refresh on the feed works; bookmarking or liking a post does
      **not** make the list jump or show the refresh spinner.
- [ ] Pushing a screen (a Bev from the feed) is one slide, with the content
      already there. Opening the ranking flow is one rise.
- [ ] Dark mode: switching tabs shows no light flash.
- [ ] Close a sheet that then opens a full-screen flow (a ranking's actions >
      Re-rank; discard in New Bev): no stuck or blank screen.
- [ ] The bottom of a Bev's page, Settings and a profile scroll clear of the
      home indicator.

## 7. Report and block (IM-13)

**Use two test accounts**, A and B, that follow each other.

- [ ] As A, on B's post: More actions > Report post. Pick a reason, add a
      note, send. The confirmation shows.
- [ ] The note field with the keyboard up: the field and Send are visible.
- [ ] **First, because it was broken once:** open a post's comments, tap More
      actions on a comment by B. The menu appears over the comments sheet,
      Report comment and Block account both work, and closing it returns to
      the comments. Repeat from the Activity list on B's profile.
- [ ] As A, block B from B's profile: the confirmation says what blocking
      does; afterwards you are taken back, and B is gone from A's feed,
      search, followers and following.
- [ ] As B: A is gone the same way, and A's profile link reads as not found.
- [ ] As A, Settings > Blocked accounts lists B; Unblock removes the row. The
      follow does not come back by itself.
- [ ] No More actions control on your own posts, comments or profile.

## 8. The update and maintenance gate (IM-9)

Needs someone at the database. The row is `app_config`, edited in the
Supabase dashboard.

- [ ] Set `maintenance` to true: within five minutes the open app shows
      "We'll be right back". Set a `maintenance_message`: it replaces the
      default line on the next check.
- [ ] Set it back to false: the screen lifts within about a minute, or at once
      with Try again, and you are on the screen you left.
- [ ] Turn on maintenance while inside the ranking flow or New Bev: note what
      happens. The notice is expected to show only after you leave the
      full-screen flow; anything worse is a ticket.
- [ ] Do **not** raise `min_app_version` or `min_contract_version` on the live
      row to test the update screen: every installed build obeys it.

## 9. Over-the-air updates

- [ ] After `eas update --channel production` with a visible change (a word in
      Settings): open the app, close it, open it again. The change is there on
      the second launch, and Settings still shows the same build number.
- [ ] A build with a different native project does not receive that update.

## 10. Errors and crashes

There is no crash reporter of our own yet (Sentry was dropped for an in-house
one, not built). What can be checked today:

- [ ] If a screen ever shows "Something went wrong", Try again brings the app
      back without a relaunch. File what you were doing.
- [ ] After any crash, TestFlight offers to send feedback on the next launch:
      send it, and check it arrives in App Store Connect > TestFlight >
      Crashes.

## 11. The bug reporter, for an internal account (IM-10)

Needs a build that links `react-native-view-shot`.

- [ ] The report button shows on every signed-in screen; an ordinary account
      never sees it.
- [ ] Press it: the note opens with a picture of the screen you were on. The
      picture does not include the button or the note, and does include an
      open sheet or modal.
- [ ] With the note open, tap and scroll the app beside it: touches pass
      through.
- [ ] Inside the ranking flow, New Bev and the photo viewer: the button is
      there and a report can be sent. Filed reports is expected not to open
      from these; note whether that limit matters.
- [ ] The keyboard does not cover the note's text field.
- [ ] Set the note aside, force-quit, reopen: the text is restored; the
      picture is not, and the note says so.
- [ ] Send it: the ticket arrives on the board with its picture, the route,
      the app version and build, and the device.
- [ ] Select element: the note steps aside, a tap on the app selects what it
      landed on and presses nothing; the note comes back with the component
      and its source file, and the new picture has the outline and its number.
      Try it on a tab, on a row in a list, and inside the ranking flow.
- [ ] In select mode the app does not scroll (expected on iOS: scroll first,
      then select) and a drag selects nothing. Tap a text field: it is selected
      and the keyboard goes away again.
- [ ] Record steps: the button becomes Stop with a count; open two screens and
      tap a few things, one of them inside a sheet; Stop shows them as steps,
      and every tap did what it normally does.

## 12. Accessibility

- [ ] VoiceOver through sign in: each field is announced with its label, and a
      wrong password is spoken.
- [ ] VoiceOver on the tab bar, a feed post (like, save, comment, More
      actions), and a sheet: focus stays inside the sheet.
- [ ] The Follow control says whether you already follow the person.
- [ ] Going offline is spoken.
- [ ] Largest Dynamic Type size: the feed, a Bev's page and Settings remain
      usable; nothing is cut off behind a fixed height.
- [ ] Reduce Motion on: no slide or fade that ignores it. Reduce Transparency
      on: the tab bar is solid.

## 13. Things to look at once

- [ ] Feed times ("5 minutes ago"), "Member since" on a profile, and the
      For you list all show (dates under Hermes).
- [ ] Three or four catalog Bev icons with a lot of label text look the same
      as on the web.
- [ ] The Map tab shows the "In progress" page.
