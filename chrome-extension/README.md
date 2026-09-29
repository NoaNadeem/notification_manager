# Notification Manager Chrome extension

This is a local, unpacked Chrome extension for the same primary Google Calendar used by the Android app. When the Chrome profile starts, it opens a 520 × 720 dedicated popup **window**. If Chrome remains running after all normal browser windows close, opening the first normal browser window opens or focuses the manager again. The toolbar button also reopens it.

The window loads all pages of past events in the selected lookback period (7 days by default), then scrolls within a fixed-size list. It shows title, rounded age, and location; titles open Google Calendar in a new tab. `1D` is always visible. Hover or focus the `⋯` button for more actions. The ribbon opens above events near the bottom of the list. It provides 1H/4H/8H/Calendar/Dismiss and 2D/3D/4D/7D/Open; all-day events get 0D instead of hour options. Moves use the current computer time and preserve event duration.

The header shows the computer's local date, time to the minute, and current time-zone abbreviation and name. The connected account appears in the settings menu below Disconnect. The clock updates once per minute without a network request. Hovering or focusing a day move tile shows its destination date; an hour move tile shows the destination date, time, and time zone. These tooltips recalculate when the pointer enters the tile or it gains focus.

All-day events appear first. Events at least 48 hours old get a colored dot before the title. All-day events, timed events lasting at least one hour, and events with another invitee get a colored background. **Skins** in settings offers Green, Blue, Purple, and Rose presets. Optional hex colors customize the dot, highlighted events, base events, header/footer, titles, and action tiles. Each override applies in both light and dark mode and is saved locally in this Chrome profile.

Move and dismiss tiles show a 30-second **Undo** state before the change is sent to Google. Clicking another action or leaving/minimizing the manager window commits the pending action. A forced browser quit may cancel it. Dismissals use the Android app's JSON format in Google Drive `appDataFolder`, plus local Chrome storage. Data older than 365 days is pruned on sync.

Click the magnifying-glass button beside the title to filter the loaded list, or the adjacent circular-arrow button to refresh. **Search Calendar** looks across past and future events in the primary calendar and shows read-only results. The top-right menu has Disconnect, lookback (7/14/30 or custom 1–365 days), a one-year dismissal storage estimate, dark mode, and Skins. Dark mode is the default. Disconnect clears the extension's cached Google authorization and stops automatic reconnect until **Connect Google Calendar** is clicked; switching to a different account requires another Chrome profile because `chrome.identity.getAuthToken` normally uses the profile's primary Google account.

## One-time Google setup

1. The Chrome Extension OAuth client has been created in Google Cloud Console project **411250810503**, with Item ID `halmnakmjhbkchjgmbonmhadenodlhhd`. Its public client ID is already configured in [`manifest.json`](manifest.json). The extension's public manifest key fixes this ID for unpacked installs.
2. Confirm the **Google Calendar API** and **Google Drive API** are enabled in the same project. If the OAuth app is in Testing mode, add the Google account you will use under **Google Auth platform → Audience → Test users**.

## Install in Chrome

1. In the Chrome profile for the same Google account as Android, open `chrome://extensions`.
2. Turn on **Developer mode**, then click **Load unpacked** and choose this repo's `chrome-extension` folder.
3. The extension ID shown in Chrome should be `halmnakmjhbkchjgmbonmhadenodlhhd`. If it differs, stop and check the folder and manifest key before signing in.
4. Click the Notification Manager toolbar button once to open its window, then click **Connect Google Calendar** and approve the requested Calendar and Drive access. The account shown in the settings menu should match the Android app's account.
5. Quit Chrome completely with **Chrome → Quit Google Chrome**, then reopen it. The manager should open in its own window. Closing all regular browser windows and opening Chrome again should also open or focus the manager.

After any extension code change, click the extension's **Reload** button on `chrome://extensions`, then close and reopen its manager window. The event list refreshes on each manager-window open, when the window regains focus, and when you click `↻`; it does not yet use push or background polling.

The Google Cloud OAuth client and interactive Google sign-in are required before Calendar data can be displayed. This repo never contains an access token or client secret. Calendar move and dismissal actions make live changes after you click their tiles and let the Undo period expire, take another action, or leave the window. Test with newly created events, never with existing personal events.

## Local checks

From this folder, run `npm test`. Tests use fixture events and do not access Google Calendar or Drive.
