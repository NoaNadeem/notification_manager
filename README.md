# Notification Manager

For a store-installed beta and eventual public release, see the [publication guide](docs/PUBLISHING.md).

Android companion for events on the signed-in account's primary Google Calendar. By default it shows the past 7 days and the rest of today in the phone's local time zone. A Later divider separates future events; today's future events show their local clock time, while later days show a weekday and date without the year. The menu has one Window row; tap it for review-window presets (daily, week-ahead, meeting-heavy, monthly, and Monday-through-today) or custom lookback/lookahead settings. Recurring instances have only edit and dismiss actions; dismissing one does not dismiss future occurrences.

The app caches the last loaded event list and dismissal records on the phone for offline reading. A dismissal is saved locally first and uploaded to Drive when connectivity returns. Move tiles remain visible offline; tapping one attempts the Calendar request and shows an error if it fails. Moves are not queued offline. On launch or resume, the app fetches Calendar events only if the last successful fetch was at least 12 hours ago; a manual refresh always fetches. Dismissal and move history sync still run when the app reconnects, even if a Calendar fetch is skipped. The subheader waits for this session's first sync and turns red for pending dismissals, an actual sync failure, or Calendar or dismissal data at least 12 hours old. It does not infer sync failure from Android's network hint alone. The menu shows one sync row, either “Synced just now” or “Sync issues”; tap it for refresh timestamps and pending dismissal count. A separate **Recent dismissals** menu row shows the ten most recent dismissed event titles. Pending local changes are cleared after Drive confirms them; a compact synced dismissal cache remains for offline filtering. The prior Recent actions log has been removed from storage.

The app and widget action rows are **2D / 3D / 4D / Calendar / 7D**, then **2H / 3H / 4H / Pencil / Dismiss**. All-day events keep 0D and two empty hour slots; recurring events keep their edit/dismiss controls.

The Calendar picker opens directly to the date grid. Its clock icon opens an optional time picker, initially set to the event’s start time. Selecting a date immediately stages the move with Undo; without using the clock, the event keeps its original time of day. All-day events have no clock icon.

Action taps keep the latest event visible with inline Undo during the configured Undo Time, then hide it while saving. The header Undo arrow restores only the latest pending action; earlier rapid actions save in the background. Destinations are calculated from the tap time, including when the timer crosses midnight. Expanding an event scrolls its options into view, but committing a move does not request a scroll. Full Calendar search results display newest dates first; the regular review list remains oldest first.

Tap the header refresh icon or pull down from the top of the event list to refresh Calendar events and Drive dismissals immediately. **Refresh events** also remains in the three-dot menu. During refresh, the event list shows one pull-to-refresh spinner.

The menu also has **Events recently moved**. It shows the ten latest confirmed moves with their destination and move time. The app stores a small local copy and syncs those records with the Chrome extension through Drive. Older moves made before this feature are not available; the ten-record list is pruned after 30 days. See [move history](docs/move-history.md).

## Samsung home-screen widget

After installing the app, long-press an empty area of the Samsung home screen, choose **Widgets**, find **Notification Manager**, and drag the widget onto a home-screen page. Resize it to fill most of the page for a scrolling event list. It reads the same local event cache, dismissal keys, review window, and account as the app. The header has Search (opens the app's search), a real-events filter, a Wi-Fi-only Refresh button, and settings (opens the app). Tap an event's title or age to expand the familiar move, Calendar, Dismiss, and edit controls. Calendar opens the app's date picker; direct move and dismiss actions keep the latest event visible with inline Undo until its configured delay ends. The widget header Undo arrow restores the latest pending action during the configured Undo Time. After a successful action, its row disappears or moves to its new chronological position within the selected date range. Recurring events show only edit and dismiss. If Google authorization needs interaction, open the app and reconnect; the widget shows an error instead of changing the event.

While a widget is placed, WorkManager schedules a check approximately every hour, initially near the next local hour. The worker checks that the active network is Wi-Fi before making a Calendar request, and skips the scheduled fetch if the last successful Calendar refresh was less than 59 minutes ago. Android battery management can delay a scheduled check, so the time is not exact. Opening or refreshing the app and completing actions also update the widget from its local cache. The widget does not add a persistent Android notification.

The pencil opens the event in the Google Calendar Android app when it is installed. From the event details, tap Google Calendar's Edit control. If the app cannot handle the event link, the pencil falls back to the browser editor.

The Chrome desktop companion lives in [chrome-extension](chrome-extension/README.md). It opens a dedicated manager window when Chrome starts; its one-time Google OAuth and unpacked-install steps are in that README. In the extension, hovering over the 1D tile opens the other actions, while clicking 1D moves the event one day. The Later divider, dots beside events labeled at least “2 days ago,” highlighted event rows, and Dismiss tiles use the selected skin in the app, widget, and extension. Calendar is fourth in the top action row; Edit is fourth in the bottom row.

## Install development updates over Wi-Fi

The connected Samsung runs Android 16, so it supports Android's paired Wireless debugging. Pair it once while the Mac and phone are on the same Wi-Fi network:

1. On the phone, open **Settings → Developer options → Wireless debugging**. Turn it on, allow the current Wi-Fi network, then tap **Pair device with pairing code**.
2. In Android Studio, choose **Pair Devices Using Wi-Fi** from the device selector (or Device Manager), select **Pair using pairing code**, and enter the six-digit code shown on the phone.
3. Unplug the USB cable and check that the phone appears in Android Studio's device selector. If it does not, use the IP address and port on the phone's main **Wireless debugging** screen with `~/Library/Android/sdk/platform-tools/adb connect IP:PORT` (this is different from the temporary pairing port).

After pairing, a development update from this Mac is `./gradlew :app:assembleDebug` followed by `~/Library/Android/sdk/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk`, or press **Run** in Android Studio with the wireless device selected. The `-r` install retains app data. This only deploys from the Mac; pushing Git code alone does not install an update. Keep Wireless debugging enabled and both devices on the same network for wireless installs. The pairing survives unplugging the cable. See [Android's wireless debugging guide](https://developer.android.com/studio/run/device#connect).

## Build and share a test APK

Build on the same Mac used for the current phone install so the APK keeps the same Android debug signing certificate:

```sh
./gradlew :app:testDebugUnitTest :app:assembleDebug
```

The installable APK is `app/build/outputs/apk/debug/app-debug.apk`. To publish a shareable GitHub prerelease, choose a new tag and matching asset name for each build:

```sh
mkdir -p dist
cp app/build/outputs/apk/debug/app-debug.apk dist/notification-manager-v0.1.0-test.apk
gh release create v0.1.0-test dist/notification-manager-v0.1.0-test.apk \
  --target main --title "Notification Manager v0.1.0 test" \
  --notes "Android test build" --prerelease
```

The direct APK URL follows this form:

```text
https://github.com/NoaNadeem/notification_manager/releases/download/v0.1.0-test/notification-manager-v0.1.0-test.apk
```

Send that URL to the tester. They can download the APK on their Android phone, open it, and allow installation from their browser or file manager if Android prompts them. The GitHub repository is public, so release assets are public too. Put APKs in GitHub Releases rather than committing them to Git; `dist/` is ignored.

For Google sign-in while the OAuth app is in Testing mode, add the tester's Google account under **Google Auth platform → Audience → Test users** in Cloud project `411250810503`. The app's Android OAuth client is tied to its package name and the APK signing certificate's SHA-1. A build made on another computer or a GitHub Actions runner can have a different debug certificate and require another Android OAuth client. Keep using the same signing key for test updates. A production release should use a dedicated release signing key.

Rapid Android action taps reuse recent Calendar authorization so each newest selection shows inline Undo while previous actions hide and save in background coroutines. Opening or closing an event’s action flyout preserves the current Undo; selecting an action tile or header action commits it. Background completions never replace a newer Undo. The Chrome extension also keeps committed-but-unsaved actions in a local outbox and retries transient failures when its manager page opens, refreshes, or reconnects.

Undo defaults to 2 seconds. The three-dot menu’s **Undo Time** setting accepts a whole number from 1 to 30 seconds and is saved locally. Only the newest action can be restored by the header Undo arrow. The latest pending event remains visible with inline Undo; saving events are hidden. Failed actions return to the queue with an error; successful moves within the range return to their chronological position without scrolling. Changing Undo Time applies to subsequent actions.

Google Tasks integration, required Google API/OAuth setup, date-only limitations, completion/Undo behavior, and incremental list rendering are documented in [Google Tasks support](docs/google-tasks.md).

Permission recovery: the Android app now offers Google's required consent screen in the foreground after an upgrade, with **Reconnect Google access** and always-accessible **Sync details** in the menu. Cancelling consent does not cause a prompt loop; Refresh or Reconnect explicitly retries. See [Tasks setup and recovery](docs/google-tasks.md).


### Small-event day moves

Day buttons (1D, 2D, 3D, 4D, 7D) default to **6am in the device's local time**, on today's local date plus the selected number of calendar days. This applies to normal-color timed events: under one hour, without other attendees. Duration is preserved. Highlighted events, all-day events, Tasks, hour buttons, and the date/time picker retain their existing behavior.

In **⋮ → Small-event day moves**, toggle between **6am local** and **24-hour increments** (the previous behavior, measured from the click). Android app and widget share the phone preference; Chrome stores a separate local preference. Local time follows travel and daylight saving rather than fixing every move to Pacific time. Queued actions retain the choice made when staged.

The change passed 61 Android unit tests, 99 extension tests, and an isolated browser check of the default, stored option, and both move destinations, with real networking disabled. Android 1.10/version 11 was published to internal testing on November 4, 2026 with this change. Extension source is 0.3.26; live reload is blocked by the browser automation URL policy for `chrome://extensions` and must not be reported as deployed.


### Read-only day after lookahead

When the review range is empty, the app and extension show: “No events in the selected lookback and lookahead range. Read-only events for the day after lookahead below”. Beneath it they show only the next local calendar day's events and dated Tasks. Preview rows reuse the normal event controls and clickable location/notes links. Extension titles open the direct Google Calendar editor (Tasks keep their supplied task link). Phone titles open the action flyout; Pencil opens the direct editor. Relative day/hour move buttons are visible but disabled; Calendar and Dismiss remain enabled. Preview controls start collapsed in the app and open only when the row is tapped. Extension preview controls use the normal hover/focus reveal behavior. Pencil is retained in the phone app, including task menus, recurring rows and search results; it is removed only from the extension. On phone rows, tapping anywhere in the event area opens/toggles the action flyout; nested links and action tiles retain their own behavior. They do not count toward the actionable queue. If that day is also empty, “No events for that day.” appears; the preview does not skip ahead to find a busier day. Search and the real-events filter keep their separate empty states.

The extra day is fetched and cached with the review range, using local date boundaries across daylight saving. The app fetches the expanded cache once after upgrade. The Android widget continues to show its normal actionable review range.

Validation: 62 Android unit tests and 101 extension tests pass; isolated browser fixtures verified enabled Calendar/Dismiss, disabled relative moves, direct editor extension title URLs, clickable location URLs, visible controls, no extension Pencil, and zero actionable count. Android checks also pass after restoring phone Pencil controls and inert titles. No real calendar or Tasks writes were performed. Extension source is 0.3.28; installed-extension reload remains blocked by browser automation URL policy for chrome://extensions. Android 1.11/version 12 was published to internal testing on November 5, 2026 with this change.

The updated preview controls and direct Pencil editor links were published in Android 1.12/version 13 on November 9, 2026.


### Latest-action header status

The app and extension show **Dismissing Dentist appointment…** or **Moving Dentist appointment to Mon 23rd Nov 2026** for the latest pending/saving action, using its staged destination and device-local calendar date. Titles are normalized to one line and limited to 20 Unicode characters plus an ellipsis when longer; blank titles use “Untitled event”. Dates use abbreviated weekdays, ordinal days, and “Sept”. The header no longer says “Saving N actions…”. New actions immediately replace the message while earlier saves continue in the background. An older completion cannot overwrite the latest message. Once the newest action finishes, the action status clears rather than returning to an older queued action; sync errors remain visible. The extension also describes the latest queued action after reopening. Header messages use the theme color.

Validation: 64 Android and 102 extension tests pass, including latest-action selection, old completions, local dates and task dates. A delayed-save browser fixture verified dismiss/move labels, old-save completion ordering, and clearing after the newest save; real networking was disabled. Extension source is 0.3.29. Automatic approval review rejected the installed-extension reload because browser policy blocks chrome://extensions; deployment must not be claimed. Android 1.12/version 13 was published to internal testing on November 9, 2026 with these changes.


Header title/date formatting update: 65 Android and 103 extension tests pass, including rapid-action ownership, ordinal day exceptions, September abbreviation, whitespace/blank titles and emoji-safe truncation. Extension source is 0.3.30. The installed-extension reload remains blocked by the previously reported browser policy; no retry or workaround was attempted. Android 1.13/version 14 was published to internal testing on November 9, 2026 with the formatting update and full event-row flyout touch target. No real event/task writes were performed.


### Full-width action status

While a Moving/Dismissing message is shown, the app and extension hide the clock/date so the action status uses the entire header status line. The extension also suppresses the adjacent sync summary during this period and omits the leading separator; error details remain available. Once the action status clears, normal clock/sync display returns. The phone action label wraps across the available width without the clock or its spacing.

Validation: 65 Android and 103 extension tests pass; delayed-save browser fixtures verified clock hiding during both action types, full-line status, no leading separator and clock restoration after saving. No real event/Task actions were used. Extension source is 0.3.31; its installed reload remains blocked by the previously reported browser policy, and no blocked reload was retried. The full-width header changes shipped with Android 1.14/version 15 on November 10, 2026.


### Priority

The ★/☆ Priority control toggles a trailing ` ★` title marker. Enabling normalizes to one trailing star; disabling removes the trailing star and legacy `(pri)` markers. Existing case-insensitive `(pri)` titles remain recognized for compatibility; there is no bulk rewrite of existing titles. Priority events and Tasks sort above every non-priority item, retaining the existing ordering within each group. A star replaces the age dot on priority rows. The extension control follows Calendar; the phone control replaces 2H (Tasks add it alongside their other actions, and all-day/recurring rows also expose it). Search results include the toggle too. Priority in the next-day preview is allowed.

The change updates the row and ordering immediately, then saves only Calendar `summary` or Tasks `title` in the background. Each write reads the current title, checks for conflicting edits and uses its ETag; it does not change dates, guests or descriptions. Failed saves revert the optimistic title/order and show an error. Repeated toggles on an in-flight item are blocked; tap the star again after saving to reverse priority. This title toggle is separate from move/dismiss Undo. Refresh imports title markers created on another client. The widget retains its existing action buttons.

Pencil now explicitly targets the installed Google Calendar app (or Google Tasks for tasks), using the browser editor only if the native activity cannot be opened. The phone event row continues to open its action flyout.

Validation: 67 Android and 105 extension tests pass. Mocked priority UI checks covered toggling both ways, priority-first ordering, correct button placement, stars replacing age dots, title-only writes and failure rollback. No real event or Task write, edit-launch, or permission grant was used for verification. Native launch routing was checked in code; it was not exercised on a personal event. Extension source is 0.3.32; installed reload remains blocked by the previously reported browser policy. Android 1.14/version 15 was published to internal testing on November 10, 2026.

API references: [conditional writes](https://developers.google.com/workspace/calendar/api/guides/version-resources), [partial updates and POST method override](https://developers.google.com/workspace/calendar/api/guides/performance).


### Personal-event priority restriction

Priority now uses **Event Name ★**, visible in Google Calendar/Tasks. For Calendar events, priority changes are allowed only when there are no other invitees. The cached UI disables Priority for shared events; the fresh API read rechecks attendee eligibility before any conditional title write. Resource invitees, unknown attendee identities, omitted attendee lists and a different organizer also block the change. The ETag check protects against invitees being added between the read and write. The cached eligibility flag persists on Android; older cache entries still receive the mandatory fresh API check. Tasks retain their toggle because they do not have Calendar invitees.

Validation: 68 Android and 106 extension tests pass, including star idempotency, legacy markers, self/alias attendees, resource/unknown attendees, omitted lists, organizer checks, and zero writes when new invitees appear in fresh data. Mocked UI verified disabled shared-event buttons, trailing-star toggle-on/off and rejection/rollback for an invitee added after loading. No real Calendar/Tasks writes occurred. Extension source is 0.3.33; installed reload remains blocked by the previously reported policy and was not retried. Android remains 1.14/version 15; this follow-up awaits an explicit phone release request.


### Preview action visibility fix

Next-day preview rows now use the same disclosure behavior as normal rows: the phone flyout starts closed and opens on row tap, and extension actions remain hidden until hover/focus. The prior forced-open overrides are removed. Relative day/hour moves remain disabled in previews; permitted buttons, links and priority eligibility are unchanged.

Validation: 68 Android and 106 extension tests pass. A synthetic browser fixture confirmed preview actions initially hidden, shown on row focus, hidden on blur and still disabled for relative moves, with every write blocked. No real events/Tasks were changed. Extension source is 0.3.34; installed reload remains blocked by the previously reported browser policy and no workaround was attempted. Android 1.15/version 16 is being prepared for the explicitly requested internal release.
