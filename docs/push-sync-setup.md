# Calendar push sync setup

The Android app currently loads the signed-in account's primary calendar when opened, refreshes when it returns to the foreground, and has a manual Refresh action. It does not yet receive Google Calendar push messages.

## Why a server is required

Google Calendar's `events.watch` sends change notices to a public HTTPS webhook. It cannot send them directly to an Android device. A small relay must receive each notice and send a Firebase Cloud Messaging (FCM) data message to the phone. The phone then fetches its own calendar events using its existing Calendar authorization. The relay does not need to store event titles or details.

Google's change notice does not identify which event changed. It only signals that the watched calendar changed. Calendar watch channels expire (the default lifetime is seven days) and must be renewed. Delivery is not guaranteed, so the app's foreground and manual refreshes remain useful.

## Google/Firebase setup needed before implementation can be finished

1. Locate the Google Cloud project that owns the Android OAuth client already used by this app. If possible, add Firebase to that project rather than creating a second Calendar API project.
2. In Firebase, register Android package `com.noanadeem.notificationmanager` and download its `google-services.json` into `app/`.
3. Enable Firebase Cloud Messaging. Choose a Google Cloud project and region for a small public HTTPS relay, for example Cloud Run. The relay's URL will be the `address` in the Calendar `events.watch` request.
4. Provide the Firebase/Google Cloud project ID and relay URL to the app configuration. The app can then register its FCM installation, create a watch for **only the signed-in user's primary calendar**, and renew the channel before it expires.
5. The relay must verify the webhook's channel ID, resource ID, and secret token before sending an FCM **data** message. It should persist channel-to-installation mappings, handle overlapping channel renewals, and never include Calendar access tokens or event contents in FCM payloads.

The relay and FCM client should be implemented and tested together after the project and public HTTPS endpoint are available. Until then, labeling the app as “real-time synced” would be inaccurate.

References: [Checker Plus push behavior](https://jasonsavard.com/wiki/Push_Notifications), [Google Calendar push guide](https://developers.google.com/workspace/calendar/api/guides/push), [events.watch reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/watch), [Firebase Android setup](https://firebase.google.com/docs/android/setup).
