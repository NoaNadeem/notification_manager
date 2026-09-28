# Dismissal storage and Google Drive setup

Dismiss hides an event occurrence in Notification Manager. It does not change or delete the Google Calendar event and does not dismiss Checker Plus's separate reminder state.

The app saves a local record containing only the event ID, original start time, and dismissal time. It also merges those records into one JSON file in the signed-in account's hidden Google Drive `appDataFolder`. This folder is accessible to this app, not to other Drive apps or in the normal Drive UI. The app syncs when it refreshes on launch/foreground and after a dismissal; it has no background polling.

The maximum lookback setting is 365 days. Cleanup is not scheduled: the app prunes local records when it opens, refreshes, or saves a dismissal. A successful Drive sync also rewrites the Drive file without expired records. If the app is never opened, or Drive remains unavailable, the existing Drive file is not pruned until a later successful sync. Storage therefore grows with dismissals within the last year during normal use, but not indefinitely. If Drive is unavailable, the phone copy continues to work and the app displays a sync warning. Reopening/refreshing retries sync.

On September 28, 2026, a read-only scan of `noamaan@gmail.com` found 1,278 events in the past 365 days. If every event were dismissed, the current JSON format would be 145,047 bytes (141.6 KiB). This is an upper-bound estimate based on event occurrences, including events that may not have reminders. No events were changed for this measurement. The app's three-dot menu has **Estimate 1-year storage** to repeat the calculation.

## One-time Google Cloud setup

The phone's current HTTP 403 error identifies Cloud project **411250810503** as the one with Drive API disabled:

1. Sign into Google Cloud Console with an account that can manage project 411250810503. Open the [Google Drive API page for that project](https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=411250810503). Check that the project selector shows 411250810503, then click **Enable**. Enabling the API is a project setting, not a setting in `noamaan@gmail.com`'s personal Drive.
2. If Google prompts for consent when the app reconnects, allow its Google Drive application-data permission. The app requests only `https://www.googleapis.com/auth/drive.appdata`, not full Drive access.
3. On the phone, open Notification Manager and choose **⋮ → Refresh**. Google says a newly enabled API can take a few minutes to propagate. If the warning remains, wait a few minutes and refresh again.
4. Only if Google says the app or user is not authorized, open **Google Auth platform → Audience** in the same Cloud project and verify `noamaan@gmail.com` is a test user; in **Data Access**, add `drive.appdata` if it is absent.

No `google-services.json`, Firebase, or full Drive access is needed for dismissal sync. The app requests only the Drive application-data scope.

Google reference: [Store application-specific data](https://developers.google.com/workspace/drive/api/guides/appdata).
