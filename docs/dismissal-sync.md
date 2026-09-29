# Dismissal storage and Google Drive setup

Dismiss hides an event occurrence in Notification Manager. It does not change or delete the Google Calendar event and does not dismiss Checker Plus's separate reminder state.

The Android app and Chrome extension both save a local record containing only the event ID, original start time, and dismissal time. In the signed-in account's hidden Google Drive `appDataFolder`, each new dismissal is created as its own immutable metadata record named `notification-manager-dismissal-v2-<uuid>.json`. Its description contains `eventId`, `start` (milliseconds since the epoch), and `dismissed` (milliseconds since the epoch). Both clients still read the previous `notification-manager-dismissals-v1.json` file but never replace it. Concurrent clients can therefore create independent records without overwriting one another. Both OAuth clients belong to Cloud project `411250810503` and request `drive.appdata`. Each side keeps the union of its local records and the Drive records, preferring the newer dismissal timestamp for duplicate event occurrences. This folder is accessible to this app, not to unrelated Drive apps or in the normal Drive UI.

Android syncs on launch/foreground, Refresh, and after a dismissal. Chrome syncs when the manager opens/regains focus, on Refresh, and after a dismissal. There is no push channel, so a dismissal on one device becomes visible on the other at its next refresh. If Drive sync fails, each side retains its local copy and shows a warning; Refresh retries it. A row saying **Dismissed** during the 30-second Undo period has not yet been saved locally or to Drive.

The maximum lookback setting is 365 days. Cleanup is not scheduled: the clients prune local records when they open, refresh, or save a dismissal. A successful Drive sync deletes immutable records whose event start is more than 365 days old. The legacy single file remains read-only for migration and is not pruned. If neither client opens, or Drive remains unavailable, cleanup waits for a later successful sync. Storage therefore grows with dismissals within the last year during normal use, plus the fixed legacy file. If Drive is unavailable, the local copy continues to work and the app displays a sync warning. Reopening/refreshing retries sync.

On September 28, 2026, a read-only scan of `noamaan@gmail.com` found 1,278 events in the past 365 days. The former single-file JSON format would have been 145,047 bytes (141.6 KiB) if every event were dismissed. The new format uses one Drive file per dismissal, so actual Drive usage and listing overhead are higher. This is an upper-bound count based on event occurrences, including events that may not have reminders. No events were changed for this measurement. The app's three-dot menu has **Estimate 1-year storage** to calculate current record payload bytes; the message notes that Drive file metadata is additional.

## One-time Google Cloud setup

If Drive returns HTTP 403 because the Drive API is disabled, enable it in Cloud project **411250810503**:

1. Sign into Google Cloud Console with an account that can manage project 411250810503. Open the [Google Drive API page for that project](https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=411250810503). Check that the project selector shows 411250810503, then click **Enable**. Enabling the API is a project setting, not a setting in `noamaan@gmail.com`'s personal Drive.
2. If Google prompts for consent when the app reconnects, allow its Google Drive application-data permission. The app requests only `https://www.googleapis.com/auth/drive.appdata`, not full Drive access.
3. On the phone, open Notification Manager and choose **⋮ → Refresh**. Google says a newly enabled API can take a few minutes to propagate. If the warning remains, wait a few minutes and refresh again.
4. Only if Google says the app or user is not authorized, open **Google Auth platform → Audience** in the same Cloud project and verify `noamaan@gmail.com` is a test user; in **Data Access**, add `drive.appdata` if it is absent.

No `google-services.json`, Firebase, or full Drive access is needed for dismissal sync. The app requests only the Drive application-data scope.

Google reference: [Store application-specific data](https://developers.google.com/workspace/drive/api/guides/appdata).
