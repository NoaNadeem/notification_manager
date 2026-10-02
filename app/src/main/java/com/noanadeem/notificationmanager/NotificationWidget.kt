package com.noanadeem.notificationmanager

import android.accounts.Account
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import com.google.android.gms.tasks.Tasks
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

private const val WIDGET_PREFS = "notification_widget"
private const val REFRESH_WORK = "notification-widget-hourly-wifi-refresh"
private const val ACTION_WIDGET = "com.noanadeem.notificationmanager.WIDGET_ACTION"
private const val EXTRA_COMMAND = "command"
private const val EXTRA_EVENT_ID = "event_id"
private const val EXTRA_EVENT_START = "event_start"
private const val EXTRA_WIDGET_ID = "widget_id"
private const val EXTRA_PENDING_KEY = "pending_key"
private const val EXTRA_ACTION_ID = "action_id"
private const val EXTRA_SECRET = "widget_secret"
private const val EXTRA_FORCE = "force"
private const val HELD_WIDGET_ROW = "held_widget_row"
private const val CALENDAR_READ_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"
private const val CALENDAR_EDIT_SCOPE = "https://www.googleapis.com/auth/calendar.events"
private const val DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata"

internal fun nextWidgetHourDelay(now: Long): Long {
    val next = java.time.ZonedDateTime.ofInstant(Instant.ofEpochMilli(now), ZoneId.systemDefault())
        .plusHours(1).withMinute(0).withSecond(0).withNano(0)
    return (next.toInstant().toEpochMilli() - now).coerceAtLeast(1L)
}

internal fun widgetRefreshDue(calendarAt: Long, now: Long): Boolean =
    calendarAt <= 0 || now - calendarAt >= 59 * 60_000L

internal fun isWifiConnected(context: Context): Boolean {
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val capabilities = manager.getNetworkCapabilities(manager.activeNetwork) ?: return false
    return capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
        capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
}

private fun wifiConstraints(): Constraints {
    val builder = Constraints.Builder()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        builder.setRequiredNetworkRequest(request, NetworkType.UNMETERED)
    } else builder.setRequiredNetworkType(NetworkType.UNMETERED)
    return builder.build()
}

private fun prefs(context: Context) = context.getSharedPreferences(WIDGET_PREFS, Context.MODE_PRIVATE)
private fun widgetSecret(context: Context): String {
    val saved = prefs(context).getString(EXTRA_SECRET, null)
    if (saved != null) return saved
    val created = UUID.randomUUID().toString()
    prefs(context).edit().putString(EXTRA_SECRET, created).commit()
    return prefs(context).getString(EXTRA_SECRET, created) ?: created
}
private fun account(context: Context): String? = context.getSharedPreferences("calendar_connection", Context.MODE_PRIVATE)
    .takeIf { it.getBoolean("auto_connect", true) }?.getString("account_name", null)
private fun eventKey(event: CalendarEvent) = "${event.id}/${event.start.toEpochMilli()}"
private fun pendingKey(event: CalendarEvent) = "pending_${eventKey(event).hashCode().toUInt().toString(16)}"
private fun workName(key: String) = "notification-widget-action-$key"

private data class PendingWidgetAction(
    val id: String, val eventId: String, val start: Long, val command: String,
    val account: String, val description: String
) {
    fun json(): String = JSONObject().put("id", id).put("eventId", eventId)
        .put("start", start).put("command", command).put("account", account)
        .put("description", description).toString()

    companion object {
        fun read(raw: String?): PendingWidgetAction? = runCatching {
            val json = JSONObject(raw ?: return null)
            PendingWidgetAction(json.getString("id"), json.getString("eventId"),
                json.getLong("start"), json.getString("command"),
                json.getString("account"), json.getString("description"))
        }.getOrNull()
    }
}

private data class HeldWidgetRow(
    val account: String, val actionId: String, val event: CalendarEvent,
    val index: Int, val description: String
) {
    fun json(): String = JSONObject().put("account", account).put("actionId", actionId)
        .put("event", calendarEventToLocalJson(event)).put("index", index)
        .put("description", description).toString()

    companion object {
        fun read(raw: String?): HeldWidgetRow? = runCatching {
            val json = JSONObject(raw ?: return null)
            HeldWidgetRow(json.getString("account"), json.getString("actionId"),
                calendarEventFromLocalJson(json.getJSONObject("event")),
                json.getInt("index"), json.getString("description"))
        }.getOrNull()
    }
}

private fun heldWidgetRow(context: Context, selectedAccount: String): HeldWidgetRow? =
    HeldWidgetRow.read(prefs(context).getString(HELD_WIDGET_ROW, null))
        ?.takeIf { it.account.equals(selectedAccount, ignoreCase = true) }

private fun visibleEvents(context: Context, selectedAccount: String): List<CalendarEvent> {
    val settings = context.getSharedPreferences("calendar_connection", Context.MODE_PRIVATE)
    val back = settings.getInt("lookback_days", 7).coerceIn(1, 365)
    val ahead = settings.getInt("lookahead_days", 0).coerceIn(0, 36500)
    val preset = runCatching {
        settings.getString("window_preset", null)?.let(WindowPreset::valueOf)
    }.getOrNull()
    val now = Instant.now()
    val dismissals = DismissalStore(context).read(selectedAccount)
    val events = LocalStateStore(context).readEvents(selectedAccount).withoutDismissals(dismissals)
        .filter { isInDisplayWindow(it.start, now, back, ahead, preset = preset) }
    val sorted = sortCalendarEvents(events)
    val held = heldWidgetRow(context, selectedAccount) ?: return sorted
    return displayEventsWithHeldAction(sorted, held.event, held.index)
}

internal class NotificationWidget : AppWidgetProvider() {
    override fun onEnabled(context: Context) {
        scheduleHourlyRefresh(context)
    }

    override fun onDisabled(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(REFRESH_WORK)
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        scheduleHourlyRefresh(context)
        updateAll(context, manager, ids)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action != ACTION_WIDGET) return
        if (intent.getStringExtra(EXTRA_SECRET) != widgetSecret(context)) return
        val command = intent.getStringExtra(EXTRA_COMMAND) ?: return
        val widgetId = intent.getIntExtra(EXTRA_WIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        if (command == "refresh") {
            prefs(context).edit().remove(HELD_WIDGET_ROW).apply()
            // The explicit button is also Wi-Fi only, matching the scheduled check.
            if (isWifiConnected(context)) {
                WorkManager.getInstance(context).enqueueUniqueWork(
                    "notification-widget-manual-refresh", ExistingWorkPolicy.KEEP,
                    OneTimeWorkRequestBuilder<WidgetRefreshWorker>()
                        .setInputData(workDataOf(EXTRA_FORCE to true))
                        .setConstraints(wifiConstraints())
                        .build())
            } else {
                prefs(context).edit().putString("status", "Connect to Wi-Fi to refresh").apply()
                updateAll(context)
            }
            return
        }
        if (command == "real") {
            prefs(context).edit().putBoolean("real_$widgetId",
                !prefs(context).getBoolean("real_$widgetId", false)).apply()
            updateAll(context)
            return
        }
        val selectedAccount = account(context) ?: return
        val eventId = intent.getStringExtra(EXTRA_EVENT_ID) ?: return
        val start = intent.getLongExtra(EXTRA_EVENT_START, Long.MIN_VALUE)
        heldWidgetRow(context, selectedAccount)?.let { held ->
            if (held.event.id == eventId && held.event.start.toEpochMilli() == start) return
        }
        val event = visibleEvents(context, selectedAccount).find {
            it.id == eventId && it.start.toEpochMilli() == start
        } ?: return
        if (command !in setOf("more", "location")) {
            prefs(context).edit().remove(HELD_WIDGET_ROW).apply()
        }
        val key = pendingKey(event)
        when (command) {
            "more" -> {
                val expanded = prefs(context).getString("expanded_$widgetId", null)
                prefs(context).edit().putString("expanded_$widgetId",
                    if (expanded == eventKey(event)) null else eventKey(event)).apply()
            }
            "undo" -> {
                prefs(context).edit().remove(key).apply()
                WorkManager.getInstance(context).cancelUniqueWork(workName(key))
            }
            "open" -> {
                val link = event.htmlLink?.let { calendarEventOpenLink(it, edit = false) }
                if (link != null) {
                    try {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link))
                            .setPackage("com.google.android.calendar")
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    } catch (_: ActivityNotFoundException) {
                        val editor = calendarEventOpenLink(link, edit = true) ?: link
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(editor))
                            .addCategory(Intent.CATEGORY_BROWSABLE)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }
                } else {
                    context.startActivity(Intent(context, MainActivity::class.java)
                        .putExtra("widget_destination", "open")
                        .putExtra(EXTRA_EVENT_ID, event.id)
                        .putExtra(EXTRA_EVENT_START, event.start.toEpochMilli())
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
                }
            }
            "location" -> {
                val location = event.location ?: return
                val url = Regex("https?://\\S+", RegexOption.IGNORE_CASE).find(location)?.value
                val uri = url?.let(Uri::parse) ?: Uri.parse("https://www.google.com/maps/search/")
                    .buildUpon().appendQueryParameter("api", "1")
                    .appendQueryParameter("query", location).build()
                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            }
            "cal" -> {
                context.startActivity(Intent(context, MainActivity::class.java)
                    .putExtra("widget_destination", "calendar")
                    .putExtra(EXTRA_EVENT_ID, event.id)
                    .putExtra(EXTRA_EVENT_START, event.start.toEpochMilli())
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
            }
            else -> {
                if (command !in setOf("dismiss", "1D", "2D", "3D", "4D", "7D", "0D", "1H", "4H", "8H")) return
                if (event.isRecurring && command != "dismiss") return
                val description = if (command == "dismiss") "Dismissed" else when (command) {
                    "0D" -> "Moved to today"
                    else -> "Moved ${command.dropLast(1)} ${if (command.endsWith("H")) "hour" else "day"}${if (command.dropLast(1) == "1") "" else "s"} later"
                }
                val action = PendingWidgetAction(UUID.randomUUID().toString(), event.id,
                    event.start.toEpochMilli(), command, selectedAccount, description)
                prefs(context).edit().putString(key, action.json()).apply()
                val work = OneTimeWorkRequestBuilder<WidgetActionWorker>()
                    .setInputData(workDataOf(EXTRA_PENDING_KEY to key, EXTRA_ACTION_ID to action.id))
                    .setInitialDelay(30, TimeUnit.SECONDS).build()
                WorkManager.getInstance(context).enqueueUniqueWork(workName(key), ExistingWorkPolicy.REPLACE, work)
            }
        }
        updateAll(context)
    }

    companion object {
        fun clearCompletedRow(context: Context) {
            prefs(context).edit().remove(HELD_WIDGET_ROW).apply()
            updateAll(context)
        }

        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, NotificationWidget::class.java))
            if (ids.isNotEmpty()) updateAll(context, manager, ids)
        }

        private fun updateAll(context: Context, manager: AppWidgetManager, ids: IntArray) {
            val selectedAccount = account(context)
            val events = selectedAccount?.let { visibleEvents(context, it) } ?: emptyList()
            for (id in ids) {
                val realOnly = prefs(context).getBoolean("real_$id", false)
                val count = if (realOnly) events.count(CalendarEvent::isEmphasized) else events.size
                val serviceIntent = Intent(context, NotificationWidgetService::class.java)
                    .putExtra(EXTRA_WIDGET_ID, id).apply { data = Uri.parse("widget://events/$id") }
                val views = RemoteViews(context.packageName, R.layout.notification_widget).apply {
                    setTextViewText(R.id.widget_clock, java.time.ZonedDateTime.now()
                        .format(DateTimeFormatter.ofPattern("EEE MMM d, z", Locale.US)))
                    setTextViewText(R.id.widget_count, "$count event${if (count == 1) "" else "s"}")
                    val explicitStatus = prefs(context).getString("status", "").orEmpty()
                    val stale = selectedAccount?.let {
                        widgetRefreshDue(LocalStateStore(context).readSync(it).calendarAt,
                            System.currentTimeMillis())
                    } == true
                    setTextViewText(R.id.widget_status,
                        explicitStatus.ifBlank { if (stale) "Refresh needed" else "" })
                    setRemoteAdapter(R.id.widget_list, serviceIntent)
                    setEmptyView(R.id.widget_list, R.id.widget_empty)
                    prefs(context).getString("expanded_$id", null)?.let { expanded ->
                        val displayed = if (realOnly) events.filter(CalendarEvent::isEmphasized) else events
                        val position = displayed.indexOfFirst { eventKey(it) == expanded }
                        if (position >= 0) setScrollPosition(R.id.widget_list, position)
                    }
                    setTextViewText(R.id.widget_empty, if (selectedAccount == null)
                        "Open the app to connect Google Calendar" else "No events in this review window")
                    setOnClickPendingIntent(R.id.widget_title, appIntent(context, id, "home"))
                    setOnClickPendingIntent(R.id.widget_search, appIntent(context, id, "search"))
                    setOnClickPendingIntent(R.id.widget_menu, appIntent(context, id, "menu"))
                    setOnClickPendingIntent(R.id.widget_real_events, commandIntent(context, id, "real"))
                    setOnClickPendingIntent(R.id.widget_refresh, commandIntent(context, id, "refresh"))
                    val template = Intent(context, NotificationWidget::class.java).setAction(ACTION_WIDGET)
                        .putExtra(EXTRA_WIDGET_ID, id).putExtra(EXTRA_SECRET, widgetSecret(context))
                    setPendingIntentTemplate(R.id.widget_list, PendingIntent.getBroadcast(context, id + 10_000,
                        template, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE))
                }
                manager.updateAppWidget(id, views)
                manager.notifyAppWidgetViewDataChanged(id, R.id.widget_list)
            }
        }

        private fun appIntent(context: Context, id: Int, destination: String): PendingIntent {
            val intent = Intent(context, MainActivity::class.java).putExtra("widget_destination", destination)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            return PendingIntent.getActivity(context, id * 10 + destination.hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }

        private fun commandIntent(context: Context, id: Int, command: String): PendingIntent {
            val intent = Intent(context, NotificationWidget::class.java).setAction(ACTION_WIDGET)
                .putExtra(EXTRA_WIDGET_ID, id).putExtra(EXTRA_COMMAND, command)
                .putExtra(EXTRA_SECRET, widgetSecret(context))
            return PendingIntent.getBroadcast(context, id * 10 + command.hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }

        private fun scheduleHourlyRefresh(context: Context) {
            val work = PeriodicWorkRequestBuilder<WidgetRefreshWorker>(1, TimeUnit.HOURS)
                .setInitialDelay(nextWidgetHourDelay(System.currentTimeMillis()), TimeUnit.MILLISECONDS)
                .setConstraints(wifiConstraints())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                REFRESH_WORK, ExistingPeriodicWorkPolicy.KEEP, work)
        }
    }
}

internal class NotificationWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = Factory(applicationContext,
        intent.getIntExtra(EXTRA_WIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID))

    private class Factory(private val context: Context, private val widgetId: Int) : RemoteViewsFactory {
        private var events = emptyList<CalendarEvent>()

        override fun onCreate() = Unit
        override fun onDestroy() = Unit
        override fun onDataSetChanged() {
            val selectedAccount = account(context)
            events = selectedAccount?.let { visibleEvents(context, it) } ?: emptyList()
            if (prefs(context).getBoolean("real_$widgetId", false)) {
                events = events.filter(CalendarEvent::isEmphasized)
            }
        }
        override fun getCount() = events.size
        override fun getViewTypeCount() = 2
        override fun hasStableIds() = true
        override fun getItemId(position: Int) = eventKey(events[position]).hashCode().toLong()
        override fun getLoadingView(): RemoteViews? = null

        override fun getViewAt(position: Int): RemoteViews? {
            val event = events.getOrNull(position) ?: return null
            val key = eventKey(event)
            val pending = PendingWidgetAction.read(prefs(context).getString(pendingKey(event), null))
            val held = account(context)?.let { heldWidgetRow(context, it) }
                ?.takeIf { eventKey(it.event) == key }
            val locked = pending != null || held != null
            val expanded = prefs(context).getString("expanded_$widgetId", null) == key && !locked
            val views = RemoteViews(context.packageName,
                if (event.isEmphasized()) R.layout.notification_widget_event_green
                else R.layout.notification_widget_event)
            views.setTextViewText(R.id.widget_event_title, event.title)
            views.setTextColor(R.id.widget_event_title, if (locked) 0xFFBFC7C9.toInt() else 0xFFFFFFFF.toInt())
            views.setTextViewText(R.id.widget_event_age, held?.description ?: pending?.description ?: event.ageDescription())
            views.setViewVisibility(R.id.widget_event_dot,
                if (event.start.isBefore(Instant.now().minus(Duration.ofDays(2)))) View.VISIBLE else View.GONE)
            views.setViewVisibility(R.id.widget_event_one_day, if (locked) View.GONE else View.VISIBLE)
            views.setTextViewText(R.id.widget_event_one_day, if (event.isRecurring) "✎" else "1D")
            views.setViewVisibility(R.id.widget_event_undo, if (locked) View.VISIBLE else View.GONE)
            views.setTextColor(R.id.widget_event_undo,
                if (held != null) 0xFF8D969A.toInt() else 0xFFFFFFFF.toInt())
            views.setContentDescription(R.id.widget_event_undo,
                if (held != null) "Action committed; Undo unavailable" else "Undo pending action")
            views.setBoolean(R.id.widget_event_undo, "setEnabled", held == null)
            views.setViewVisibility(R.id.widget_event_options, if (expanded) View.VISIBLE else View.GONE)
            views.setInt(R.id.widget_event_title, "setMaxLines", if (expanded) 100 else 3)
            views.setViewVisibility(R.id.widget_event_location,
                if (event.location != null && !locked) View.VISIBLE else View.GONE)
            views.setTextViewText(R.id.widget_event_location, event.location ?: "")
            if (!locked) {
                click(views, R.id.widget_event_title, event, "more")
                click(views, R.id.widget_event_age, event, "more")
                click(views, R.id.widget_event_one_day, event, if (event.isRecurring) "open" else "1D")
                click(views, R.id.widget_event_location, event, "location")
            } else if (held == null) click(views, R.id.widget_event_undo, event, "undo")
            if (expanded) {
                val firstRow = if (event.allDayDate != null) listOf("0D", "2D", "4D")
                    else listOf("1H", "4H", "8H")
                listOf(R.id.widget_tile_a, R.id.widget_tile_b, R.id.widget_tile_c).forEachIndexed { index, id ->
                    views.setTextViewText(id, firstRow[index])
                    if (!event.isRecurring) click(views, id, event, firstRow[index])
                    views.setViewVisibility(id, if (event.isRecurring) View.GONE else View.VISIBLE)
                }
                click(views, R.id.widget_tile_calendar, event, "cal")
                views.setViewVisibility(R.id.widget_tile_calendar, if (event.isRecurring) View.GONE else View.VISIBLE)
                click(views, R.id.widget_tile_dismiss, event, "dismiss")
                listOf(R.id.widget_tile_2d to "2D", R.id.widget_tile_3d to "3D",
                    R.id.widget_tile_4d to "4D", R.id.widget_tile_7d to "7D").forEach { (id, command) ->
                    views.setViewVisibility(id, if (event.isRecurring) View.GONE else View.VISIBLE)
                    if (!event.isRecurring) click(views, id, event, command)
                }
                click(views, R.id.widget_tile_open, event, "open")
            }
            return views
        }

        private fun click(views: RemoteViews, viewId: Int, event: CalendarEvent, command: String) {
            views.setOnClickFillInIntent(viewId, Intent().putExtra(EXTRA_COMMAND, command)
                .putExtra(EXTRA_EVENT_ID, event.id)
                .putExtra(EXTRA_EVENT_START, event.start.toEpochMilli()))
        }
    }
}

private suspend fun widgetToken(context: Context, selectedAccount: String, edit: Boolean): String =
    withContext(Dispatchers.IO) {
        val scopes = mutableListOf(Scope(CALENDAR_READ_SCOPE), Scope(DRIVE_SCOPE))
        if (edit) scopes += Scope(CALENDAR_EDIT_SCOPE)
        val request = AuthorizationRequest.builder().setAccount(Account(selectedAccount, "com.google"))
            .setRequestedScopes(scopes).build()
        val result = Tasks.await(Identity.getAuthorizationClient(context).authorize(request))
        if (result.hasResolution()) throw IllegalStateException("Open the app to reconnect Google Calendar")
        result.accessToken ?: throw IllegalStateException("Google did not return an access token")
    }

internal class WidgetRefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val context = applicationContext
        val selectedAccount = account(context) ?: return Result.success()
        if (!isWifiConnected(context)) {
            prefs(context).edit().putString("status", "Waiting for Wi-Fi").apply()
            NotificationWidget.updateAll(context)
            return Result.success()
        }
        val store = LocalStateStore(context)
        val before = store.readSync(selectedAccount)
        if (!inputData.getBoolean(EXTRA_FORCE, false) &&
            !widgetRefreshDue(before.calendarAt, System.currentTimeMillis())) {
            NotificationWidget.updateAll(context)
            return Result.success()
        }
        prefs(context).edit().remove(HELD_WIDGET_ROW).apply()
        return try {
            val token = widgetToken(context, selectedAccount, edit = false)
            val primary = verifyCalendarAccess(token)
            if (!primary.equals(selectedAccount, ignoreCase = true)) {
                throw IllegalStateException("Calendar account changed; open the app to reconnect")
            }
            val settings = context.getSharedPreferences("calendar_connection", Context.MODE_PRIVATE)
            val back = settings.getInt("lookback_days", 7).coerceIn(1, 365)
            val ahead = settings.getInt("lookahead_days", 0).coerceIn(0, 36500)
            val preset = runCatching { settings.getString("window_preset", null)?.let(WindowPreset::valueOf) }.getOrNull()
            val fetched = fetchRecentEvents(token, primary, back, ahead, preset = preset)
            store.writeEvents(selectedAccount, fetched)
            store.writeSync(selectedAccount, before.copy(calendarAt = System.currentTimeMillis(), error = null))
            try {
                val local = DismissalStore(context)
                val merged = dismissalSyncMutex.withLock { syncDismissals(token, local, selectedAccount) }
                store.writeSync(selectedAccount, store.readSync(selectedAccount).copy(
                    dismissalAt = System.currentTimeMillis(), pending = emptySet(), error = null))
                Log.i("NotificationWidget", "Refreshed ${fetched.size} events and ${merged.size} dismissal keys")
            } catch (error: Exception) {
                store.writeSync(selectedAccount, store.readSync(selectedAccount).copy(error = error.message))
            }
            try {
                moveHistoryMutex.withLock {
                    syncMoveHistory(token, MoveHistoryStore(context), selectedAccount)
                }
            } catch (error: Exception) {
                store.writeSync(selectedAccount, store.readSync(selectedAccount).copy(
                    error = "Move history sync failed: ${error.message ?: "Unknown error"}"))
            }
            prefs(context).edit().remove("status").apply()
            NotificationWidget.updateAll(context)
            Result.success()
        } catch (error: Exception) {
            store.writeSync(selectedAccount, store.readSync(selectedAccount).copy(
                error = error.message ?: "Widget refresh failed"))
            prefs(context).edit().putString("status", error.message ?: "Refresh failed").apply()
            NotificationWidget.updateAll(context)
            Result.success()
        }
    }
}

internal class WidgetActionWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val context = applicationContext
        val key = inputData.getString(EXTRA_PENDING_KEY) ?: return Result.success()
        val id = inputData.getString(EXTRA_ACTION_ID) ?: return Result.success()
        val action = PendingWidgetAction.read(prefs(context).getString(key, null))
            ?.takeIf { it.id == id } ?: return Result.success()
        val event = LocalStateStore(context).readEvents(action.account).find {
            it.id == action.eventId && it.start.toEpochMilli() == action.start
        }
        var applied = false
        try {
            if (event == null) throw IllegalStateException("Event changed; refresh the app before retrying")
            val position = visibleEvents(context, action.account).indexOfFirst { eventKey(it) == eventKey(event) }
                .coerceAtLeast(0)
            check(prefs(context).edit().putString(HELD_WIDGET_ROW,
                HeldWidgetRow(action.account, id, event, position, action.description).json()).commit()) {
                "Could not keep the completed widget action visible."
            }
            NotificationWidget.updateAll(context)
            if (action.command == "dismiss") {
                val store = DismissalStore(context)
                val record = DismissalRecord(event.id, event.start.toEpochMilli(),
                    System.currentTimeMillis(), event.title)
                val stateStore = LocalStateStore(context)
                dismissalSyncMutex.withLock {
                    val merged = mergeDismissals(store.read(action.account), listOf(record), Instant.now())
                    store.write(action.account, merged)
                    applied = true
                    val state = stateStore.readSync(action.account)
                    stateStore.writeSync(action.account, state.copy(pending = state.pending + record.key))
                    try {
                        val token = widgetToken(context, action.account, edit = false)
                        syncDismissals(token, store, action.account)
                        val priorMoveError = stateStore.readSync(action.account).error?.takeIf {
                            it.startsWith("Move history sync failed:")
                        }
                        stateStore.writeSync(action.account, stateStore.readSync(action.account).copy(
                            dismissalAt = System.currentTimeMillis(), pending = emptySet(), error = priorMoveError))
                    } catch (error: Exception) {
                        stateStore.writeSync(action.account, stateStore.readSync(action.account).copy(error = error.message))
                        prefs(context).edit().putString("status", "Dismissed locally; Drive sync pending").apply()
                    }
                }
            } else {
                if (event.isRecurring) throw IllegalStateException("Recurring events cannot be moved")
                val token = widgetToken(context, action.account, edit = true)
                val target = if (action.command == "0D") MoveTarget.After(Duration.ZERO)
                    else if (action.command.endsWith("H")) MoveTarget.After(Duration.ofHours(action.command.dropLast(1).toLong()))
                    else MoveTarget.After(Duration.ofDays(action.command.dropLast(1).toLong()))
                val moved = moveCalendarEvent(token, event, target)
                applied = true
                val stateStore = LocalStateStore(context)
                val settings = context.getSharedPreferences("calendar_connection", Context.MODE_PRIVATE)
                val back = settings.getInt("lookback_days", 7).coerceIn(1, 365)
                val ahead = settings.getInt("lookahead_days", 0).coerceIn(0, 36500)
                val preset = runCatching { settings.getString("window_preset", null)?.let(WindowPreset::valueOf) }.getOrNull()
                val events = stateStore.readEvents(action.account).filterNot { eventKey(it) == eventKey(event) }
                    .toMutableList()
                if (isInDisplayWindow(moved.start, Instant.now(), back, ahead, preset = preset)) events += moved
                if (event.start != moved.start) {
                    try {
                        moveHistoryMutex.withLock {
                            val history = MoveHistoryStore(context)
                            val record = newMoveRecord(event, moved)
                            history.write(action.account, recentMoves(history.read(action.account), listOf(record)))
                            syncMoveHistory(token, history, action.account)
                            val current = stateStore.readSync(action.account)
                            if (current.error?.startsWith("Move history sync failed:") == true) {
                                stateStore.writeSync(action.account, current.copy(error = null))
                            }
                        }
                    } catch (error: Exception) {
                        stateStore.writeSync(action.account, stateStore.readSync(action.account).copy(
                            error = "Move history sync failed: ${error.message ?: "Unknown error"}"))
                        prefs(context).edit().putString("status", "Event moved; recent moves sync pending").apply()
                    }
                }
                runCatching { stateStore.writeEvents(action.account, sortCalendarEvents(events)) }
                    .onFailure {
                        prefs(context).edit().putString("status", "Event moved; refresh app to update widget").apply()
                    }
            }
            if (prefs(context).getString("status", null) != "Dismissed locally; Drive sync pending" &&
                prefs(context).getString("status", null) != "Event moved; recent moves sync pending" &&
                prefs(context).getString("status", null) != "Event moved; refresh app to update widget") {
                prefs(context).edit().remove("status").apply()
            }
        } catch (error: Exception) {
            prefs(context).edit().putString("status", error.message ?: "Action failed; open the app").apply()
        } finally {
            if (!applied && HeldWidgetRow.read(prefs(context).getString(HELD_WIDGET_ROW, null))?.actionId == id) {
                prefs(context).edit().remove(HELD_WIDGET_ROW).apply()
            }
            if (PendingWidgetAction.read(prefs(context).getString(key, null))?.id == id) {
                prefs(context).edit().remove(key).apply()
            }
            NotificationWidget.updateAll(context)
        }
        return Result.success()
    }
}
