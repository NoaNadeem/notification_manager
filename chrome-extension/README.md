# Notification Manager Chrome extension

This is a local, unpacked Chrome extension for the same primary Google Calendar used by the Android app. When the Chrome profile starts, it opens a 520 × 720 dedicated popup **window**. If Chrome remains running after all normal browser windows close, opening the first normal browser window opens or focuses the manager again. The toolbar button also reopens it.

The window loads all pages of past events in the selected lookback period (7 days by default), then scrolls within a fixed-size list. It shows title, rounded age, and location; titles open Google Calendar in a new tab. `1D` is always visible. Hover or focus the `⋯` button for more actions, or click it to keep the ribbon open. The ribbon provides 1H/4H/8H/Cal/Dismiss and 2D/3D/4D/7D/Open; all-day events get 0D instead of hour options. Moves use the current computer time and preserve event duration. Dismissals use the Android app's JSON format in Google Drive `appDataFolder`, plus local Chrome storage. Data older than 365 days is pruned on sync.

## One-time Google setup

1. Open Google Cloud Console project **411250810503**. Go to **Google Auth platform → Clients → Create client**.
2. Choose **Chrome Extension**. Name it `Notification Manager Chrome`. In **Item ID**, enter `halmnakmjhbkchjgmbonmhadenodlhhd`. Create the client. The extension's public manifest key fixes this ID for unpacked installs.
3. Copy the new client ID into [`manifest.json`](manifest.json), replacing `REPLACE_WITH_CHROME_EXTENSION_CLIENT_ID.apps.googleusercontent.com`. The client ID is public; do not put a client secret here.
4. Confirm the **Google Calendar API** and **Google Drive API** are enabled in the same project. If the OAuth app is in Testing mode, add the Google account you will use under **Google Auth platform → Audience → Test users**.

## Install in Chrome

1. In the Chrome profile for the same Google account as Android, open `chrome://extensions`.
2. Turn on **Developer mode**, then click **Load unpacked** and choose this repo's `chrome-extension` folder.
3. The extension ID shown in Chrome should be `halmnakmjhbkchjgmbonmhadenodlhhd`. If it differs, stop and check the folder and manifest key before signing in.
4. Click the Notification Manager toolbar button once to open its window, then click **Connect Google Calendar** and approve the requested Calendar and Drive access. The account under the header should match the Android app's account.
5. Quit Chrome completely with **Chrome → Quit Google Chrome**, then reopen it. The manager should open in its own window. Closing all regular browser windows and opening Chrome again should also open or focus the manager.

If you change `manifest.json` later, click the extension's **Reload** button on `chrome://extensions`. The event list refreshes on each manager-window open and when you click `↻`; it does not yet use push or background polling.

The Google Cloud OAuth client and interactive Google sign-in are required before Calendar data can be displayed. This repo never contains an access token or client secret. Calendar move and dismissal actions make live changes **only when you click their tiles**. Test with newly created events, never with existing personal events.

## Local checks

From this folder, run `npm test`. Tests use fixture events and do not access Google Calendar or Drive.
