package com.noanadeem.notificationmanager

import android.app.Activity
import android.content.ActivityNotFoundException
import android.accounts.Account
import android.content.Context
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.ui.draw.alpha
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PlainTooltip
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTooltipState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.auth.api.identity.RevokeAccessRequest
import com.google.android.gms.common.api.Scope
import com.noanadeem.notificationmanager.ui.theme.NotificationManagerTheme
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.Duration
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

private const val CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"
private const val CALENDAR_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events"
private const val DRIVE_APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata"
private const val CONNECTION_PREFERENCES = "calendar_connection"
private const val AUTO_CONNECT_KEY = "auto_connect"
private const val ACCOUNT_NAME_KEY = "account_name"
private const val LOOKBACK_DAYS_KEY = "lookback_days"
private const val LOOKAHEAD_DAYS_KEY = "lookahead_days"
private const val WINDOW_PRESET_KEY = "window_preset"
private const val DARK_MODE_KEY = "dark_mode"

private enum class ConnectionScreen { Checking, Disconnected, Connected, Error }
private data class PendingMove(val event: CalendarEvent, val target: MoveTarget)
internal sealed interface UndoableAction {
    val event: CalendarEvent
    val createdAtNanos: Long

    data class Move(
        override val event: CalendarEvent,
        val target: MoveTarget,
        val accessToken: String,
        override val createdAtNanos: Long = System.nanoTime()
    ) : UndoableAction

    data class Dismiss(
        override val event: CalendarEvent,
        override val createdAtNanos: Long = System.nanoTime()
    ) : UndoableAction
}

internal sealed interface UndoState {
    data object Idle : UndoState
    data class Pending(val action: UndoableAction) : UndoState
    data class Committing(val action: UndoableAction) : UndoState
    data class Failed(val action: UndoableAction, val message: String) : UndoState
}

private val UndoState.pendingAction: UndoableAction?
    get() = (this as? UndoState.Pending)?.action

internal fun UndoState.beginCommit(action: UndoableAction): UndoState =
    if (this is UndoState.Pending && this.action == action) UndoState.Committing(action) else this

internal fun UndoState.finishCommit(action: UndoableAction, error: String? = null): UndoState =
    if (this is UndoState.Committing && this.action == action) {
        if (error == null) UndoState.Idle else UndoState.Failed(action, error)
    } else this

private fun UndoableAction.description(): String = when (this) {
    is UndoableAction.Dismiss -> "Dismissed"
    is UndoableAction.Move -> when (val destination = target) {
        is MoveTarget.OnDate -> "Moved to ${destination.date.format(DateTimeFormatter.ofPattern("MMM d"))}"
        is MoveTarget.After -> {
            val duration = destination.duration
            if (duration == Duration.ZERO) "Moved to today"
            else if (duration.toHours() < 24) {
                val hours = duration.toHours()
                "Moved $hours ${if (hours == 1L) "hour" else "hours"} later"
            } else {
                val days = duration.toDays()
                "Moved $days ${if (days == 1L) "day" else "days"} later"
            }
        }
    }
}

private const val UNDO_WINDOW_MILLIS = 30_000L

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val preferences = remember {
                getSharedPreferences(CONNECTION_PREFERENCES, Context.MODE_PRIVATE)
            }
            var darkMode by remember {
                mutableStateOf(preferences.getBoolean(DARK_MODE_KEY, true))
            }
            var skin by remember { mutableStateOf(readSkin(preferences)) }
            NotificationManagerTheme(darkTheme = darkMode) {
                CompositionLocalProvider(LocalSkin provides skin, LocalSkinDark provides darkMode) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    SelectionContainer {
                        CalendarLoginScreen(
                            darkMode = darkMode,
                            skin = skin,
                            onSkinChange = { updated ->
                                skin = updated
                                saveSkin(preferences, updated)
                            },
                            onDarkModeChange = { enabled ->
                                darkMode = enabled
                                preferences.edit().putBoolean(DARK_MODE_KEY, enabled).apply()
                            }
                        )
                    }
                }
                }
            }
        }
    }
}

@Composable
private fun CalendarLoginScreen(
    darkMode: Boolean,
    skin: Skin,
    onSkinChange: (Skin) -> Unit,
    onDarkModeChange: (Boolean) -> Unit
) {
    val activity = LocalContext.current as ComponentActivity
    val authorizationClient = remember(activity) { Identity.getAuthorizationClient(activity) }
    val preferences = remember(activity) {
        activity.getSharedPreferences(CONNECTION_PREFERENCES, Context.MODE_PRIVATE)
    }
    val coroutineScope = rememberCoroutineScope()
    val dismissalStore = remember(activity) { DismissalStore(activity) }
    val localStateStore = remember(activity) { LocalStateStore(activity) }
    val connectivity = remember(activity) {
        activity.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    }
    var online by remember { mutableStateOf(
        connectivity.getNetworkCapabilities(connectivity.activeNetwork)
            ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
    ) }
    var onlineRecovery by remember { mutableStateOf(0) }
    DisposableEffect(connectivity) {
        val callback = object : ConnectivityManager.NetworkCallback() {
            private fun refresh() = activity.runOnUiThread {
                val wasOnline = online
                online = connectivity.getNetworkCapabilities(connectivity.activeNetwork)
                    ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
                if (!wasOnline && online) onlineRecovery += 1
            }
            override fun onAvailable(network: Network) = refresh()
            override fun onLost(network: Network) = refresh()
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = refresh()
        }
        connectivity.registerDefaultNetworkCallback(callback)
        onDispose { connectivity.unregisterNetworkCallback(callback) }
    }
    val dismissalMutex = remember { Mutex() }

    var screen by remember {
        mutableStateOf(
            if (preferences.getBoolean(AUTO_CONNECT_KEY, true)) {
                if (preferences.getString(ACCOUNT_NAME_KEY, null) != null) ConnectionScreen.Connected
                else ConnectionScreen.Checking
            } else {
                ConnectionScreen.Disconnected
            }
        )
    }
    var loading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var accountName by remember { mutableStateOf(preferences.getString(ACCOUNT_NAME_KEY, null)) }
    var lookbackDays by remember {
        mutableStateOf(preferences.getInt(LOOKBACK_DAYS_KEY, 7).coerceIn(1, 365))
    }
    var lookaheadDays by remember {
        mutableStateOf(preferences.getInt(LOOKAHEAD_DAYS_KEY, 0).coerceIn(0, 36500))
    }
    var windowPreset by remember {
        mutableStateOf(runCatching {
            preferences.getString(WINDOW_PRESET_KEY, null)?.let(WindowPreset::valueOf)
        }.getOrNull())
    }
    var recentEvents by remember { mutableStateOf(
        preferences.getString(ACCOUNT_NAME_KEY, null)?.let { account ->
            localStateStore.readEvents(account).withoutDismissals(dismissalStore.read(account))
        } ?: emptyList()
    ) }
    var eventsLoading by remember { mutableStateOf(false) }
    var eventsError by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var pendingMove by remember { mutableStateOf<PendingMove?>(null) }
    var undoState by remember { mutableStateOf<UndoState>(UndoState.Idle) }
    var movingEventId by remember { mutableStateOf<String?>(null) }
    var committingActionIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var dismissals by remember { mutableStateOf<List<DismissalRecord>>(emptyList()) }
    var driveError by remember { mutableStateOf<String?>(null) }
    var syncState by remember { mutableStateOf(
        preferences.getString(ACCOUNT_NAME_KEY, null)?.let(localStateStore::readSync) ?: LocalSyncState()
    ) }

    fun saveSync(account: String, updated: LocalSyncState) {
        syncState = updated
        runCatching { localStateStore.writeSync(account, updated) }
            .onFailure { Log.w("NotificationManagerSync", "Could not persist sync status", it) }
    }
    var currentAccessToken by remember { mutableStateOf<String?>(null) }
    var storageEstimate by remember { mutableStateOf<String?>(null) }
    var storageEstimateRequest by remember { mutableStateOf(0) }
    var calendarSearchQuery by remember { mutableStateOf<String?>(null) }
    var calendarSearchResults by remember { mutableStateOf<CalendarSearchResults?>(null) }
    var calendarSearchLoading by remember { mutableStateOf(false) }
    var calendarSearchError by remember { mutableStateOf<String?>(null) }
    var calendarSearchRequest by remember { mutableStateOf(0) }

    LaunchedEffect(storageEstimate, storageEstimateRequest) {
        val message = storageEstimate
        if (message != null && message != "Counting events from the past year…") {
            delay(30_000L)
            if (storageEstimate == message) storageEstimate = null
        }
    }

    fun searchCalendar(query: String) {
        val term = query.trim()
        if (term.isEmpty()) return
        calendarSearchRequest += 1
        val request = calendarSearchRequest
        calendarSearchQuery = term
        calendarSearchResults = null
        calendarSearchError = null
        calendarSearchLoading = true
        coroutineScope.launch {
            try {
                val token = currentAccessToken ?: throw IllegalStateException("Reconnect Calendar before searching.")
                val primaryId = verifyCalendarAccess(token)
                val results = searchPrimaryCalendar(token, primaryId, term)
                if (request == calendarSearchRequest) calendarSearchResults = results
            } catch (e: Exception) {
                if (request == calendarSearchRequest) {
                    calendarSearchError = e.message ?: "Could not search Calendar."
                }
            } finally {
                if (request == calendarSearchRequest) calendarSearchLoading = false
            }
        }
    }

    fun commitAction(action: UndoableAction) {
        if (undoState.pendingAction != action) return
        val committing = undoState.beginCommit(action)
        if (committing !is UndoState.Committing) return
        undoState = committing
        coroutineScope.launch {
            var commitError: String? = null
            when (action) {
                is UndoableAction.Move -> {
                    committingActionIds = committingActionIds + action.event.id
                    try {
                        val movedEvent = moveCalendarEvent(action.accessToken, action.event, action.target)
                        val now = Instant.now()
                        recentEvents = recentEvents.mapNotNull {
                            if (it.calendarId == action.event.calendarId && it.id == action.event.id) {
                                movedEvent.takeIf { updated ->
                                    isInDisplayWindow(updated.start, now, lookbackDays, lookaheadDays, preset = windowPreset)
                                }
                            } else it
                        }.let(::sortCalendarEvents)
                        val cacheAccount = accountName ?: action.event.calendarId
                        runCatching { localStateStore.writeEvents(cacheAccount, recentEvents) }
                            .onFailure { Log.w("NotificationManagerSync", "Could not update offline event cache", it) }
                        actionError = null
                        val selectedAccount = accountName ?: action.event.calendarId
                        saveSync(selectedAccount, syncState.addHistory(ActionEntry("move", action.event.id,
                            action.event.start.toEpochMilli(), System.currentTimeMillis(), "synced")))
                    } catch (e: Exception) {
                        actionError = "Could not move “${action.event.title}”: ${e.message ?: "Calendar update failed."}"
                        commitError = actionError
                        val selectedAccount = accountName ?: action.event.calendarId
                        saveSync(selectedAccount, syncState.copy(error = e.message ?: "Move failed").addHistory(ActionEntry("move", action.event.id,
                            action.event.start.toEpochMilli(), System.currentTimeMillis(), "failed", e.message)))
                    } finally {
                        committingActionIds = committingActionIds - action.event.id
                    }
                }
                is UndoableAction.Dismiss -> {
                    committingActionIds = committingActionIds + action.event.id
                    val selectedAccount = accountName ?: action.event.calendarId
                    val now = Instant.now()
                    val record = DismissalRecord(action.event.id, action.event.start.toEpochMilli(), now.toEpochMilli())
                    try {
                        val merged = dismissalMutex.withLock {
                            val saved = mergeDismissals(dismissalStore.read(selectedAccount, now), listOf(record), now)
                            dismissalStore.write(selectedAccount, saved)
                            saved
                        }
                        dismissals = merged
                        recentEvents = recentEvents.withoutDismissals(merged)
                        actionError = null
                        saveSync(selectedAccount, syncState.copy(
                            pending = syncState.pending + record.key
                        ).addHistory(ActionEntry("dismiss", action.event.id, record.eventStartMillis,
                            now.toEpochMilli(), "local-only")))
                        currentAccessToken?.let { token ->
                            try {
                                val localKeys = dismissals.mapTo(HashSet()) { it.key }
                                dismissals = dismissalMutex.withLock {
                                    syncDismissals(token, dismissalStore, selectedAccount)
                                }
                                val remoteNewer = dismissals.any { it.key !in localKeys }
                                saveSync(selectedAccount, syncState.copy(
                                    dismissalAt = System.currentTimeMillis(), pending = emptySet(),
                                    error = null, remoteNewer = remoteNewer,
                                    conflictResolved = syncState.pending.isNotEmpty() && remoteNewer,
                                    history = syncState.history.map { entry ->
                                        if (entry.status == "local-only") entry.copy(status = "synced") else entry
                                    }
                                ))
                                driveError = null
                            } catch (e: Exception) {
                                driveError = "Dismissal of “${action.event.title}” was saved on this phone, but Drive sync failed: ${e.message}"
                                commitError = driveError
                                saveSync(selectedAccount, syncState.copy(error = e.message ?: "Drive sync failed",
                                    history = syncState.history.map { entry ->
                                        if (entry.eventId == record.eventId && entry.start == record.eventStartMillis &&
                                            entry.status == "local-only") entry.copy(error = e.message) else entry
                                    }))
                            }
                        } ?: run {
                            driveError = "Dismissal of “${action.event.title}” was saved on this phone; reconnect to sync with Drive."
                            commitError = driveError
                            saveSync(selectedAccount, syncState.copy(error = "Reconnect to sync with Drive"))
                        }
                    } catch (e: Exception) {
                        actionError = "Could not dismiss “${action.event.title}”: ${e.message ?: "Saving failed."}"
                        commitError = actionError
                        saveSync(selectedAccount, syncState.addHistory(ActionEntry("dismiss", action.event.id,
                            action.event.start.toEpochMilli(), System.currentTimeMillis(), "failed", e.message)))
                    } finally {
                        committingActionIds = committingActionIds - action.event.id
                    }
                }
            }
            undoState = undoState.finishCommit(action, commitError)
        }
    }

    fun openEvent(event: CalendarEvent) {
        undoState.pendingAction?.let(::commitAction)
        coroutineScope.launch {
            try {
                val link = event.htmlLink ?: fetchEventWebLink(
                    currentAccessToken ?: throw IllegalStateException("Reconnect Calendar before opening this event."),
                    event
                )
                val targetLink = calendarEventOpenLink(link, edit = true)
                    ?: throw IllegalStateException("Google Calendar returned an invalid event link.")
                val uri = Uri.parse(targetLink)
                try {
                    if (targetLink != link) {
                        activity.startActivity(Intent(Intent.ACTION_VIEW, uri).setPackage("com.android.chrome"))
                    } else {
                        activity.startActivity(Intent(Intent.ACTION_VIEW, uri).setPackage("com.google.android.calendar"))
                    }
                } catch (_: ActivityNotFoundException) {
                    activity.startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
                }
                actionError = null
            } catch (e: Exception) {
                actionError = e.message ?: "Could not open this Calendar event."
            }
        }
    }

    fun openLocation(location: String) {
        undoState.pendingAction?.let(::commitAction)
        try {
            val text = location.trim()
            val url = Regex("https?://[^\\s<>]+", RegexOption.IGNORE_CASE)
                .find(text)?.value?.trimEnd('.', ',', ';', ')')
                ?: text.takeIf { it.startsWith("www.", ignoreCase = true) }?.let { "https://$it" }
            val uri = if (url != null) Uri.parse(url) else {
                Uri.parse("https://www.google.com/maps/search/").buildUpon()
                    .appendQueryParameter("api", "1")
                    .appendQueryParameter("query", text)
                    .build()
            }
            activity.startActivity(Intent(Intent.ACTION_VIEW, uri))
            actionError = null
        } catch (e: Exception) {
            actionError = e.message ?: "Could not open this location."
        }
    }

    LaunchedEffect(undoState.pendingAction?.createdAtNanos) {
        val action = undoState.pendingAction ?: return@LaunchedEffect
        delay(UNDO_WINDOW_MILLIS)
        commitAction(action)
    }

    fun useAuthorizationResult(result: AuthorizationResult, interactive: Boolean) {
        val move = pendingMove
        val refreshing = !interactive && screen == ConnectionScreen.Connected
        val accessToken = result.accessToken
        if (accessToken.isNullOrEmpty()) {
            loading = false
            if (move != null) {
                actionError = "Google did not authorize moving “${move.event.title}”."
                pendingMove = null
                movingEventId = null
            } else if (refreshing) {
                eventsError = "Could not refresh: Google did not return an access token."
            } else {
                screen = if (interactive) ConnectionScreen.Disconnected else ConnectionScreen.Error
                errorMessage = "Google did not return an access token."
            }
            return
        }
        currentAccessToken = accessToken

        if (move != null) {
            pendingMove = null
            undoState.pendingAction?.let(::commitAction)
            undoState = UndoState.Pending(UndoableAction.Move(move.event, move.target, accessToken))
            movingEventId = null
            return
        }

        coroutineScope.launch {
            try {
                val primaryCalendarId = verifyCalendarAccess(accessToken)
                // Primary calendar IDs normally match the Google account email address.
                // Keep only the account name; never persist an access token.
                val previousAccount = accountName
                accountName = result.toGoogleSignInAccount()?.account?.name
                    ?: primaryCalendarId.takeIf { "@" in it }
                    ?: accountName
                if (previousAccount != accountName) {
                    calendarSearchRequest += 1
                    calendarSearchQuery = null
                    calendarSearchResults = null
                    calendarSearchLoading = false
                    calendarSearchError = null
                }
                preferences.edit().apply {
                    putBoolean(AUTO_CONNECT_KEY, true)
                    if (accountName != null) putString(ACCOUNT_NAME_KEY, accountName)
                    apply()
                }
                val selectedAccount = accountName ?: primaryCalendarId
                syncState = localStateStore.readSync(selectedAccount)
                dismissals = dismissalStore.read(selectedAccount)
                if (previousAccount != accountName) {
                    recentEvents = localStateStore.readEvents(selectedAccount).withoutDismissals(dismissals)
                }
                screen = ConnectionScreen.Connected
                errorMessage = null
                eventsLoading = true
                eventsError = null
                driveError = null
                try {
                    val fetched = fetchRecentEvents(accessToken, primaryCalendarId, lookbackDays, lookaheadDays,
                        preset = windowPreset)
                    runCatching { localStateStore.writeEvents(selectedAccount, fetched) }
                        .onFailure { Log.w("NotificationManagerSync", "Could not update offline event cache", it) }
                    saveSync(selectedAccount, syncState.copy(calendarAt = System.currentTimeMillis(), error = null))
                    recentEvents = fetched.withoutDismissals(dismissals)
                    try {
                        val localKeys = dismissals.mapTo(HashSet()) { it.key }
                        val hadPending = syncState.pending.isNotEmpty()
                        val merged = dismissalMutex.withLock {
                            syncDismissals(accessToken, dismissalStore, selectedAccount)
                        }
                        dismissals = merged
                        recentEvents = fetched.withoutDismissals(merged)
                        val remoteNewer = merged.any { it.key !in localKeys }
                        saveSync(selectedAccount, syncState.copy(
                            dismissalAt = System.currentTimeMillis(), pending = emptySet(), error = null,
                            remoteNewer = remoteNewer, conflictResolved = hadPending && remoteNewer,
                            history = syncState.history.map { entry ->
                                if (entry.status == "local-only") entry.copy(status = "synced") else entry
                            }
                        ))
                    } catch (e: Exception) {
                        driveError = "Dismissals are saved on this phone, but Drive sync is unavailable: ${e.message}"
                        saveSync(selectedAccount, syncState.copy(error = e.message ?: "Drive sync failed"))
                    }
                } catch (e: Exception) {
                    eventsError = e.message ?: "Could not load recent events."
                    saveSync(selectedAccount, syncState.copy(error = eventsError))
                } finally {
                    eventsLoading = false
                }
            } catch (e: Exception) {
                if (refreshing) {
                    eventsError = e.message ?: "Calendar refresh failed."
                } else {
                    screen = if (interactive) ConnectionScreen.Disconnected else ConnectionScreen.Error
                    errorMessage = e.message ?: "Calendar request failed."
                }
            } finally {
                loading = false
            }
        }
    }

    val authorizationLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartIntentSenderForResult()
    ) { result ->
        if (result.resultCode != Activity.RESULT_OK) {
            loading = false
            if (pendingMove != null) {
                val title = pendingMove?.event?.title
                pendingMove = null
                movingEventId = null
                actionError = "Move cancelled for “$title”."
            } else {
                errorMessage = "Google authorization was cancelled."
            }
        } else {
            try {
                val intent = result.data
                    ?: throw IllegalStateException("Google authorization returned no result.")
                val authorizationResult = authorizationClient.getAuthorizationResultFromIntent(intent)
                useAuthorizationResult(authorizationResult, interactive = true)
            } catch (e: Exception) {
                loading = false
                if (pendingMove != null) {
                    val title = pendingMove?.event?.title
                    pendingMove = null
                    movingEventId = null
                    actionError = "Could not authorize moving “$title”: ${e.message ?: "Authorization failed."}"
                } else {
                    errorMessage = e.message ?: "Authorization failed."
                }
            }
        }
    }

    fun authorizeCalendar(interactive: Boolean) {
        loading = interactive
        if (interactive) {
            screen = ConnectionScreen.Disconnected
        } else if (screen != ConnectionScreen.Connected) {
            screen = ConnectionScreen.Checking
        }
        errorMessage = null

        val requestBuilder = AuthorizationRequest.builder()
            .setRequestedScopes(listOf(Scope(CALENDAR_SCOPE), Scope(DRIVE_APPDATA_SCOPE)))
        if (interactive) {
            requestBuilder.setPrompt(AuthorizationRequest.Prompt.SELECT_ACCOUNT)
        } else {
            accountName?.let { requestBuilder.setAccount(Account(it, "com.google")) }
        }

        authorizationClient.authorize(requestBuilder.build())
            .addOnSuccessListener { result ->
                if (result.hasResolution()) {
                    if (!interactive) {
                        if (screen == ConnectionScreen.Connected) {
                            eventsError = "Reconnect Google Calendar to refresh events."
                        } else {
                            screen = ConnectionScreen.Disconnected
                        }
                    } else {
                        val pendingIntent = result.pendingIntent
                        if (pendingIntent == null) {
                            loading = false
                            errorMessage = "Authorization resolution was unavailable."
                        } else {
                            authorizationLauncher.launch(
                                IntentSenderRequest.Builder(pendingIntent.intentSender).build()
                            )
                        }
                    }
                } else {
                    useAuthorizationResult(result, interactive)
                }
            }
            .addOnFailureListener { e ->
                loading = false
                if (!interactive && screen == ConnectionScreen.Connected) {
                    eventsError = e.message ?: "Could not refresh Calendar."
                } else {
                    screen = if (interactive) ConnectionScreen.Disconnected else ConnectionScreen.Error
                    errorMessage = e.message ?: "Google authorization failed."
                }
            }
    }

    fun moveEvent(event: CalendarEvent, target: MoveTarget) {
        if (event.isRecurring) {
            actionError = "Recurring events can only be dismissed or edited in Google Calendar."
            return
        }
        if (!online) {
            actionError = "Internet connection is required to move an event. Dismissals can still be saved offline."
            return
        }
        if (movingEventId != null) return
        undoState.pendingAction?.let(::commitAction)
        pendingMove = PendingMove(event, target)
        movingEventId = event.id
        actionError = null
        val request = AuthorizationRequest.builder()
            .setRequestedScopes(listOf(Scope(CALENDAR_SCOPE), Scope(CALENDAR_WRITE_SCOPE), Scope(DRIVE_APPDATA_SCOPE)))
            .apply { accountName?.let { setAccount(Account(it, "com.google")) } }
            .build()
        authorizationClient.authorize(request)
            .addOnSuccessListener { result ->
                if (result.hasResolution()) {
                    val pendingIntent = result.pendingIntent
                    if (pendingIntent == null) {
                        pendingMove = null
                        movingEventId = null
                        actionError = "Google authorization to move “${event.title}” was unavailable."
                    } else {
                        authorizationLauncher.launch(
                            IntentSenderRequest.Builder(pendingIntent.intentSender).build()
                        )
                    }
                } else {
                    useAuthorizationResult(result, interactive = false)
                }
            }
            .addOnFailureListener { e ->
                pendingMove = null
                movingEventId = null
                actionError = "Could not authorize moving “${event.title}”: ${e.message ?: "Authorization failed."}"
            }
    }

    fun dismissEvent(event: CalendarEvent) {
        if (event.id in committingActionIds) return
        undoState.pendingAction?.let(::commitAction)
        undoState = UndoState.Pending(UndoableAction.Dismiss(event))
        actionError = null
    }

    fun estimateStorage() {
        storageEstimateRequest += 1
        val request = storageEstimateRequest
        val token = currentAccessToken
        if (token == null) {
            storageEstimate = "Reconnect Calendar before estimating storage."
            return
        }
        storageEstimate = "Counting events from the past year…"
        coroutineScope.launch {
            val result = try {
                val primaryId = verifyCalendarAccess(token)
                val now = Instant.now()
                val events = fetchRecentEvents(token, primaryId, 365)
                    .filter { isInPastWindow(it.start, now, 365) }
                val bytes = estimateFullYearMarkerPayloadBytes(events)
                "${events.size} events in the past year. If every one were dismissed, their Drive record payloads would total $bytes bytes (${String.format(java.util.Locale.US, "%.1f", bytes / 1024.0)} KiB), plus Drive file metadata for each dismissal."
                    .also { Log.i("NotificationManagerStorage", it) }
            } catch (e: Exception) {
                "Could not estimate storage: ${e.message}"
            }
            if (request == storageEstimateRequest) storageEstimate = result
        }
    }

    fun logout() {
        storageEstimateRequest += 1
        storageEstimate = null
        loading = true
        errorMessage = null
        val selectedAccount = accountName
        if (selectedAccount == null) {
            preferences.edit().putBoolean(AUTO_CONNECT_KEY, false).remove(ACCOUNT_NAME_KEY).apply()
            recentEvents = emptyList()
            dismissals = emptyList()
            currentAccessToken = null
            calendarSearchRequest += 1
            calendarSearchResults = null
            calendarSearchQuery = null
            eventsError = null
            actionError = null
            screen = ConnectionScreen.Disconnected
            loading = false
            return
        }

        val request = RevokeAccessRequest.builder()
            .setAccount(Account(selectedAccount, "com.google"))
            .setScopes(listOf(Scope(CALENDAR_SCOPE), Scope(CALENDAR_WRITE_SCOPE), Scope(DRIVE_APPDATA_SCOPE)))
            .build()
        authorizationClient.revokeAccess(request)
            .addOnSuccessListener {
                preferences.edit().putBoolean(AUTO_CONNECT_KEY, false).remove(ACCOUNT_NAME_KEY).apply()
                accountName = null
                recentEvents = emptyList()
                dismissals = emptyList()
                currentAccessToken = null
                calendarSearchRequest += 1
                calendarSearchResults = null
                calendarSearchQuery = null
                eventsError = null
                actionError = null
                screen = ConnectionScreen.Disconnected
                loading = false
            }
            .addOnFailureListener { e ->
                loading = false
                errorMessage = e.message ?: "Could not disconnect Google Calendar."
            }
    }

    LaunchedEffect(Unit) {
        if (preferences.getBoolean(AUTO_CONNECT_KEY, true)) authorizeCalendar(interactive = false)
    }
    LaunchedEffect(onlineRecovery) {
        if (onlineRecovery > 0 && screen == ConnectionScreen.Connected && !eventsLoading &&
            (syncState.pending.isNotEmpty() || syncState.error != null)) {
            authorizeCalendar(interactive = false)
        }
    }

    DisposableEffect(activity, screen) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> {
                    if (screen == ConnectionScreen.Connected &&
                        !eventsLoading && movingEventId == null) {
                        authorizeCalendar(interactive = false)
                    }
                }
                Lifecycle.Event.ON_STOP -> undoState.pendingAction?.let(::commitAction)
                else -> Unit
            }
        }
        activity.lifecycle.addObserver(observer)
        onDispose { activity.lifecycle.removeObserver(observer) }
    }

    when (screen) {
        ConnectionScreen.Checking -> Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            CircularProgressIndicator()
            Text("Checking Calendar connection", modifier = Modifier.padding(top = 16.dp))
        }

        ConnectionScreen.Connected -> CalendarConnectedScreen(
            loading = loading,
            errorMessage = errorMessage,
            accountName = accountName,
            events = recentEvents,
            calendarSearchQuery = calendarSearchQuery,
            calendarSearchResults = calendarSearchResults,
            calendarSearchLoading = calendarSearchLoading,
            calendarSearchError = calendarSearchError,
            onSearchCalendar = ::searchCalendar,
            onOpenEvent = ::openEvent,
            onOpenLocation = ::openLocation,
            eventsLoading = eventsLoading,
            eventsError = eventsError,
            actionError = actionError,
            driveError = driveError,
            syncState = syncState,
            online = online,
            storageEstimate = storageEstimate,
            darkMode = darkMode,
            skin = skin,
            onSkinChange = onSkinChange,
            movingEventId = movingEventId,
            committingActionIds = committingActionIds,
            undoableEventId = undoState.pendingAction?.event?.id,
            undoableActionDescription = undoState.pendingAction?.description(),
            onUndo = {
                undoState.pendingAction?.let { action ->
                    val selectedAccount = accountName ?: action.event.calendarId
                    saveSync(selectedAccount, syncState.addHistory(ActionEntry(
                        if (action is UndoableAction.Dismiss) "dismiss" else "move",
                        action.event.id, action.event.start.toEpochMilli(),
                        System.currentTimeMillis(), "undone"
                    )))
                }
                undoState = UndoState.Idle
            },
            onOtherAction = { undoState.pendingAction?.let(::commitAction) },
            lookbackDays = lookbackDays,
            lookaheadDays = lookaheadDays,
            windowPreset = windowPreset,
            onRefresh = { authorizeCalendar(interactive = false) },
            onLookbackChange = { days ->
                lookbackDays = days
                windowPreset = null
                preferences.edit().putInt(LOOKBACK_DAYS_KEY, days).remove(WINDOW_PRESET_KEY).apply()
                authorizeCalendar(interactive = false)
            },
            onLookaheadChange = { days ->
                lookaheadDays = days
                windowPreset = null
                preferences.edit().putInt(LOOKAHEAD_DAYS_KEY, days).remove(WINDOW_PRESET_KEY).apply()
                authorizeCalendar(interactive = false)
            },
            onPresetChange = { preset ->
                windowPreset = preset
                lookbackDays = preset.backDays
                lookaheadDays = preset.aheadDays
                preferences.edit().putString(WINDOW_PRESET_KEY, preset.name)
                    .putInt(LOOKBACK_DAYS_KEY, preset.backDays)
                    .putInt(LOOKAHEAD_DAYS_KEY, preset.aheadDays).apply()
                authorizeCalendar(interactive = false)
            },
            onMove = ::moveEvent,
            onDismiss = ::dismissEvent,
            onEstimateStorage = ::estimateStorage,
            onDarkModeChange = onDarkModeChange,
            onLogout = ::logout
        )

        ConnectionScreen.Disconnected, ConnectionScreen.Error -> Column(
            modifier = Modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text("Notification Manager", style = MaterialTheme.typography.headlineMedium)
            if (loading) {
                CircularProgressIndicator(modifier = Modifier.padding(top = 24.dp))
            } else {
                Button(
                    modifier = Modifier.padding(top = 24.dp),
                    onClick = { authorizeCalendar(interactive = screen != ConnectionScreen.Error) }
                ) {
                    Text(if (screen == ConnectionScreen.Error) "Retry connection" else "Connect Google Calendar")
                }
                if (screen == ConnectionScreen.Error) {
                    TextButton(onClick = { authorizeCalendar(interactive = true) }) {
                        Text("Choose another account")
                    }
                }
            }
            errorMessage?.let { message ->
                SelectableLinkedText(message, modifier = Modifier.padding(top = 16.dp))
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CalendarConnectedScreen(
    loading: Boolean,
    errorMessage: String?,
    accountName: String?,
    events: List<CalendarEvent>,
    calendarSearchQuery: String?,
    calendarSearchResults: CalendarSearchResults?,
    calendarSearchLoading: Boolean,
    calendarSearchError: String?,
    onSearchCalendar: (String) -> Unit,
    onOpenEvent: (CalendarEvent) -> Unit,
    onOpenLocation: (String) -> Unit,
    eventsLoading: Boolean,
    eventsError: String?,
    actionError: String?,
    driveError: String?,
    syncState: LocalSyncState,
    online: Boolean,
    storageEstimate: String?,
    darkMode: Boolean,
    skin: Skin,
    onSkinChange: (Skin) -> Unit,
    movingEventId: String?,
    committingActionIds: Set<String>,
    undoableEventId: String?,
    undoableActionDescription: String?,
    onUndo: () -> Unit,
    onOtherAction: () -> Unit,
    lookbackDays: Int,
    lookaheadDays: Int,
    windowPreset: WindowPreset?,
    onRefresh: () -> Unit,
    onLookbackChange: (Int) -> Unit,
    onLookaheadChange: (Int) -> Unit,
    onPresetChange: (WindowPreset) -> Unit,
    onMove: (CalendarEvent, MoveTarget) -> Unit,
    onDismiss: (CalendarEvent) -> Unit,
    onEstimateStorage: () -> Unit,
    onDarkModeChange: (Boolean) -> Unit,
    onLogout: () -> Unit
) {
    var menuExpanded by remember { mutableStateOf(false) }
    var expandedEventId by remember { mutableStateOf<String?>(null) }
    var showLookbackPicker by remember { mutableStateOf(false) }
    var showLookaheadPicker by remember { mutableStateOf(false) }
    var showPresets by remember { mutableStateOf(false) }
    var showSyncDetails by remember { mutableStateOf(false) }
    var showHistory by remember { mutableStateOf(false) }
    var showSkins by remember { mutableStateOf(false) }
    var customLookbackText by remember { mutableStateOf(lookbackDays.toString()) }
    var customLookaheadText by remember { mutableStateOf(lookaheadDays.toString()) }
    var datePickerEvent by remember { mutableStateOf<CalendarEvent?>(null) }
    var searchActive by remember { mutableStateOf(false) }
    var realEventsOnly by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    val keyboardController = LocalSoftwareKeyboardController.current
    val searchFocusRequester = remember { FocusRequester() }
    val filteredEvents = remember(events, searchQuery, searchActive, realEventsOnly) {
        val matching = if (searchActive) filterLoadedEvents(events, searchQuery) else events
        if (realEventsOnly) matching.filter(CalendarEvent::isEmphasized) else matching
    }
    LaunchedEffect(searchActive) {
        if (searchActive) searchFocusRequester.requestFocus()
    }
    Column(modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = skin.color("panel", darkMode, MaterialTheme.colorScheme.surfaceContainerLow)
        ) {
            Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (searchActive) {
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    modifier = Modifier.weight(1f).focusRequester(searchFocusRequester),
                    singleLine = true,
                    placeholder = { Text("Search loaded events") }
                )
                IconButton(modifier = Modifier.semantics { contentDescription = "Close search" }, onClick = {
                    searchActive = false
                    searchQuery = ""
                }) { Text("×", style = MaterialTheme.typography.headlineMedium) }
            } else {
                Text(
                    "Notification Manager",
                    style = MaterialTheme.typography.titleMedium
                )
                IconButton(modifier = Modifier.size(40.dp), onClick = {
                        onOtherAction()
                        searchActive = true
                }) {
                    Icon(
                        painter = painterResource(android.R.drawable.ic_menu_search),
                        contentDescription = "Search events",
                        modifier = Modifier.size(20.dp)
                    )
                }
                IconButton(
                    modifier = Modifier.size(40.dp).semantics {
                        contentDescription = if (realEventsOnly) "Show all events" else "Show real events only"
                    },
                    onClick = {
                        onOtherAction()
                        realEventsOnly = !realEventsOnly
                        expandedEventId = null
                    }
                ) {
                    Text("▤", style = MaterialTheme.typography.titleLarge,
                        color = if (realEventsOnly) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.onSurface)
                }
                Spacer(modifier = Modifier.weight(1f))
            }
            Column {
                IconButton(modifier = Modifier.size(40.dp).semantics { contentDescription = "Notification Manager menu" }, onClick = {
                    onOtherAction()
                    menuExpanded = true
                }) {
                    Text("⋮", style = MaterialTheme.typography.headlineMedium)
                }
                DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                    DropdownMenuItem(
                        text = { Text("Logout / Switch Account") },
                        leadingIcon = { Text("⇥") },
                        enabled = !loading && movingEventId == null,
                        onClick = {
                            menuExpanded = false
                            onLogout()
                        }
                    )
                    accountName?.let { name ->
                        Text(name, style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp))
                    }
                    val headline = syncState.headline(online)
                    DropdownMenuItem(
                        text = { Text(if (headline == "Synced just now") "Synced just now" else "Sync issues",
                            color = if (headline == "Synced just now") MaterialTheme.colorScheme.onSurface
                                else MaterialTheme.colorScheme.error) },
                        onClick = { menuExpanded = false; showSyncDetails = true }
                    )
                    DropdownMenuItem(
                        text = { Text("Refresh events") },
                        leadingIcon = { Text("↻") },
                        enabled = !eventsLoading && !loading && movingEventId == null,
                        onClick = {
                            menuExpanded = false
                            onOtherAction()
                            onRefresh()
                        }
                    )
                    DropdownMenuItem(
                        text = {
                            Text(
                                "Window: " + when (windowPreset) {
                                    WindowPreset.CURRENT -> "Current: 7 days back to today"
                                    null -> if (lookbackDays == 7 && lookaheadDays == 0)
                                        "Current: 7 days back to today"
                                    else "Custom: $lookbackDays days back, $lookaheadDays ahead"
                                    else -> windowPreset.label
                                },
                                style = MaterialTheme.typography.bodySmall,
                                maxLines = 1, overflow = TextOverflow.Ellipsis
                            )
                        },
                        enabled = !eventsLoading && !loading && movingEventId == null,
                        onClick = { menuExpanded = false; showPresets = true }
                    )
                    DropdownMenuItem(
                        text = { Text("Dark mode: ${if (darkMode) "On" else "Off"}") },
                        onClick = {
                            menuExpanded = false
                            onDarkModeChange(!darkMode)
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Skins") },
                        onClick = { menuExpanded = false; showSkins = true }
                    )
                }
            }
        }
        if (accountName != null) AccountClock(syncState, online, eventsError != null || driveError != null)
            }
        }
        PullToRefreshBox(
            isRefreshing = loading || eventsLoading,
            onRefresh = {
                if (!eventsLoading && !loading && movingEventId == null) onRefresh()
            },
            modifier = Modifier.weight(1f).fillMaxWidth()
        ) {
        Column(modifier = Modifier.fillMaxSize().padding(horizontal = 24.dp)) {
        if (loading) {
            CircularProgressIndicator(modifier = Modifier.padding(top = 24.dp))
        }
        errorMessage?.let { message ->
            SelectableLinkedText(message, modifier = Modifier.padding(top = 16.dp))
        }
        actionError?.let { message ->
            SelectableLinkedText(
                message,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 8.dp)
            )
        }
        eventsError?.let { message ->
            SelectableLinkedText(
                message,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 8.dp)
            )
        }
        driveError?.let { message ->
            SelectableLinkedText(
                message,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 8.dp)
            )
        }
        storageEstimate?.let {
            Text(
                it,
                color = if (it.startsWith("Could not") || it.startsWith("Reconnect"))
                    MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(top = 8.dp)
            )
        }
        when {
            eventsLoading && !searchActive -> LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f)) {
                item { CircularProgressIndicator(modifier = Modifier.padding(top = 16.dp)) }
            }
            events.isEmpty() && !searchActive -> LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f)) {
                item {
                    Text(
                        if (eventsError != null) "Events could not be loaded. Pull down to try again."
                        else "No events in the selected lookback and lookahead range.",
                        modifier = Modifier.padding(top = 16.dp)
                    )
                }
            }
            else -> LazyColumn(
                modifier = Modifier.fillMaxWidth().weight(1f),
                contentPadding = PaddingValues(bottom = 16.dp)
            ) {
                if (eventsLoading) item { CircularProgressIndicator(modifier = Modifier.padding(16.dp)) }
                if (filteredEvents.isEmpty() && realEventsOnly && !searchActive && !eventsLoading) item {
                    Text("No real events in this range.", modifier = Modifier.padding(vertical = 16.dp))
                }
                items(filteredEvents, key = { "${it.calendarId}/${it.id}" }) { event ->
                    val actionBringIntoViewRequester = remember(event.id) { BringIntoViewRequester() }
                    val awaitingUndo = undoableEventId == event.id
                    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)
                        .background(
                            skin.color(
                                if (event.isEmphasized()) "emphasized" else "event",
                                darkMode,
                                if (event.isEmphasized()) MaterialTheme.colorScheme.surfaceVariant
                                else MaterialTheme.colorScheme.background
                            ), RoundedCornerShape(8.dp)
                        ).padding(horizontal = 8.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Column(modifier = Modifier.fillMaxWidth()
                                    .clickable(enabled = !awaitingUndo) {
                                    onOtherAction()
                                    expandedEventId = if (expandedEventId == event.id) null else event.id
                                }) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    if (event.isTwoDaysOld()) Box(
                                        modifier = Modifier.padding(end = 7.dp).size(8.dp)
                                            .background(skin.color("dot", darkMode, Color.Green), androidx.compose.foundation.shape.CircleShape)
                                    )
                                Text(
                                    event.title,
                                    fontWeight = FontWeight.Bold,
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = skin.color("title", darkMode, MaterialTheme.colorScheme.onSurface),
                                    maxLines = if (expandedEventId == event.id) Int.MAX_VALUE else 3,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.alpha(if (awaitingUndo) 0.35f else 1f)
                                )
                                }
                                Text(
                                    if (awaitingUndo) undoableActionDescription.orEmpty() else event.ageDescription(),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(top = 2.dp)
                                )
                                }
                                if (!awaitingUndo) event.location?.let { location ->
                                    Text(
                                        text = location,
                                        style = MaterialTheme.typography.bodySmall.copy(textDecoration = TextDecoration.Underline),
                                        color = MaterialTheme.colorScheme.primary,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.fillMaxWidth().padding(top = 4.dp)
                                            .clickable(onClickLabel = "Open event location") { onOpenLocation(location) }
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.width(8.dp))
                            if (awaitingUndo) MoveTile(
                                label = "Undo",
                                description = "Undo pending action for ${event.title}",
                                enabled = true,
                                modifier = Modifier.size(52.dp),
                                onClick = {
                                    expandedEventId = null
                                    onUndo()
                                }
                            )
                            else if (event.isRecurring) MoveTile(
                                label = "✎",
                                description = "Edit recurring occurrence in Google Calendar",
                                enabled = true,
                                modifier = Modifier.size(44.dp),
                                onClick = { onOpenEvent(event) }
                            )
                            else MoveTile(
                                label = "1D",
                                description = "Move event one day from now",
                                tooltip = { event.moveDestinationTooltip(MoveTarget.After(Duration.ofDays(1))) },
                                enabled = movingEventId == null && event.id !in committingActionIds,
                                modifier = Modifier.size(44.dp),
                                onClick = {
                                    expandedEventId = null
                                    onMove(event, MoveTarget.After(Duration.ofDays(1)))
                                }
                            )
                        }
                        if (expandedEventId == event.id && !awaitingUndo) {
                            LaunchedEffect(event.id) {
                                withFrameNanos { }
                                actionBringIntoViewRequester.bringIntoView()
                            }
                            Surface(
                                modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                                    .bringIntoViewRequester(actionBringIntoViewRequester),
                                color = MaterialTheme.colorScheme.surfaceVariant,
                                shape = RoundedCornerShape(8.dp)
                            ) {
                                Column(modifier = Modifier.padding(8.dp)) {
                                    if (event.isRecurring) Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.End
                                    ) {
                                        MoveTile(
                                            label = "✓",
                                            description = "Dismiss only this occurrence in this app",
                                            enabled = movingEventId == null && event.id !in committingActionIds,
                                            modifier = Modifier.size(44.dp),
                                            onClick = {
                                                expandedEventId = null
                                                onDismiss(event)
                                            }
                                        )
                                    } else {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween
                                    ) {
                                        val hourChoices = if (event.allDayDate == null) {
                                            listOf(
                                                "1H" to MoveTarget.After(Duration.ofHours(1)),
                                                "4H" to MoveTarget.After(Duration.ofHours(4)),
                                                "8H" to MoveTarget.After(Duration.ofHours(8))
                                            )
                                        } else {
                                            listOf("0D" to MoveTarget.After(Duration.ZERO))
                                        }
                                        for ((label, target) in hourChoices) {
                                            MoveTile(
                                                label = label,
                                                description = if (label == "0D") "Move all-day event to today"
                                                    else "Move event $label from now",
                                                tooltip = { event.moveDestinationTooltip(target) },
                                                enabled = movingEventId == null && event.id !in committingActionIds,
                                                modifier = Modifier.size(44.dp),
                                                onClick = { onMove(event, target) }
                                            )
                                        }
                                        repeat(3 - hourChoices.size) { Spacer(modifier = Modifier.size(44.dp)) }
                                        MoveTile(
                                            label = "📅",
                                            description = "Choose a calendar date",
                                            enabled = movingEventId == null && event.id !in committingActionIds,
                                            modifier = Modifier.size(44.dp),
                                            onClick = {
                                                onOtherAction()
                                                datePickerEvent = event
                                            }
                                        )
                                        MoveTile(
                                            label = "✓",
                                            description = "Dismiss event in this app",
                                            enabled = movingEventId == null && event.id !in committingActionIds,
                                            modifier = Modifier.size(44.dp),
                                            onClick = {
                                                expandedEventId = null
                                                onDismiss(event)
                                            }
                                        )
                                    }
                                    Row(
                                        modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                                        horizontalArrangement = Arrangement.SpaceBetween
                                    ) {
                                        for ((label, days) in listOf("2D" to 2L, "3D" to 3L, "4D" to 4L, "7D" to 7L)) {
                                            MoveTile(
                                                label = label,
                                                description = "Move event $label from now",
                                                tooltip = { event.moveDestinationTooltip(MoveTarget.After(Duration.ofDays(days))) },
                                                enabled = movingEventId == null && event.id !in committingActionIds,
                                                modifier = Modifier.size(44.dp),
                                                onClick = { onMove(event, MoveTarget.After(Duration.ofDays(days))) }
                                            )
                                        }
                                        MoveTile(
                                            label = "✎",
                                            description = "Open event in Google Calendar to edit",
                                            enabled = true,
                                            modifier = Modifier.size(44.dp),
                                            onClick = { onOpenEvent(event) }
                                        )
                                    }
                                    if (movingEventId == event.id || event.id in committingActionIds) {
                                        Text("Saving action…", modifier = Modifier.padding(top = 8.dp))
                                    }
                                    }
                                }
                            }
                        }
                    }
                    HorizontalDivider()
                }
                if (searchActive) {
                    if (filteredEvents.isEmpty() && !eventsLoading) item {
                        Text("No loaded events match this search.", modifier = Modifier.padding(vertical = 16.dp))
                    }
                    item {
                        Button(
                            onClick = {
                                keyboardController?.hide()
                                onSearchCalendar(searchQuery)
                            },
                            enabled = searchQuery.isNotBlank() && !calendarSearchLoading,
                            modifier = Modifier.fillMaxWidth().padding(top = 16.dp)
                        ) { Text("Search Calendar") }
                    }
                    if (calendarSearchQuery == searchQuery.trim()) {
                        if (calendarSearchLoading) item {
                            CircularProgressIndicator(modifier = Modifier.padding(16.dp))
                        }
                        if (calendarSearchError != null) item {
                            Text(
                                calendarSearchError,
                                color = MaterialTheme.colorScheme.error,
                                modifier = Modifier.padding(vertical = 12.dp)
                            )
                        }
                        calendarSearchResults?.let { results ->
                            item {
                                Text(
                                    "Calendar results · read only",
                                    style = MaterialTheme.typography.titleMedium,
                                    modifier = Modifier.padding(top = 24.dp, bottom = 8.dp)
                                )
                            }
                            if (results.events.isEmpty()) item {
                                Text("No Calendar events match this search.")
                            }
                            items(results.events, key = { "calendar-search/${it.calendarId}/${it.id}/${it.start}" }) { event ->
                                Row(
                                    modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp)
                                        .background(skin.color(
                                            if (event.isEmphasized()) "emphasized" else "event", darkMode,
                                            if (event.isEmphasized()) MaterialTheme.colorScheme.surfaceVariant
                                            else MaterialTheme.colorScheme.background
                                        ), RoundedCornerShape(8.dp)).padding(horizontal = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            if (event.isTwoDaysOld()) Box(
                                                modifier = Modifier.padding(end = 7.dp).size(8.dp)
                                                    .background(skin.color("dot", darkMode, Color.Green), androidx.compose.foundation.shape.CircleShape)
                                            )
                                            Text(event.title, fontWeight = FontWeight.Bold,
                                                color = skin.color("title", darkMode, MaterialTheme.colorScheme.onSurface),
                                                style = MaterialTheme.typography.bodyLarge,
                                                maxLines = 3, overflow = TextOverflow.Ellipsis)
                                        }
                                        Text(
                                            event.searchDateDescription(),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                        event.location?.let { location ->
                                            Text(location, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                                style = MaterialTheme.typography.bodySmall.copy(textDecoration = TextDecoration.Underline),
                                                color = MaterialTheme.colorScheme.primary,
                                                modifier = Modifier.fillMaxWidth().padding(top = 4.dp)
                                                    .clickable(onClickLabel = "Open event location") { onOpenLocation(location) })
                                        }
                                    }
                                    MoveTile(
                                        label = "✎",
                                        description = "Open event in Google Calendar to edit",
                                        enabled = true,
                                        modifier = Modifier.size(44.dp),
                                        onClick = { onOpenEvent(event) }
                                    )
                                }
                                HorizontalDivider()
                            }
                            if (results.hasMore) item {
                                Text(
                                    "Showing the first 100 matches. Narrow your search to find more.",
                                    style = MaterialTheme.typography.bodySmall,
                                    modifier = Modifier.padding(top = 12.dp)
                                )
                            }
                        }
                    }
                }
            }
        }
        }
        }
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = skin.color("panel", darkMode, MaterialTheme.colorScheme.surfaceContainerLow)
        ) {
        val eventCount = filteredEvents.size
            Box(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 12.dp),
                contentAlignment = Alignment.CenterEnd
            ) {
                Text(
                    if (eventsLoading) "Loading…" else "$eventCount event${if (eventCount == 1) "" else "s"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }

    if (showSyncDetails && !showHistory) AlertDialog(
        onDismissRequest = { showSyncDetails = false },
        title = { Text("Sync details") },
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                Text(syncState.headline(online))
                Text("Calendar refreshed: ${formatSyncTime(syncState.calendarAt)}")
                Text("Dismissals synced: ${formatSyncTime(syncState.dismissalAt)}")
                Text("Local-only dismissals: ${syncState.pending.size}")
                Text("Newer state from another device: ${if (syncState.remoteNewer) "Yes, merged" else "No new state detected"}")
                Text("Conflict resolved: ${if (syncState.conflictResolved) "Yes, dismissal union preserved" else "None detected"}")
                syncState.error?.let { Text("Last error: $it", color = MaterialTheme.colorScheme.error) }
                Text("Recent actions is a 3-day log on this device of moves, dismissals, Undo, and failures.",
                    style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { showHistory = true }) {
                    Text("View recent actions")
                }
            }
        },
        confirmButton = { TextButton(onClick = { showSyncDetails = false }) { Text("Close") } }
    )
    if (showHistory) {
        val context = LocalContext.current
        var copied by remember { mutableStateOf(false) }
        val entries = syncState.history.filter { it.at >= System.currentTimeMillis() - HISTORY_MILLIS }
            .asReversed()
        val export = buildString {
            appendLine("Notification Manager action log (Android, last 3 days)")
            if (entries.isEmpty()) append("No actions.")
            entries.forEach { entry ->
                appendLine(JSONObject().put("at", Instant.ofEpochMilli(entry.at).toString())
                    .put("action", entry.action).put("eventId", entry.eventId)
                    .put("eventStart", Instant.ofEpochMilli(entry.start).toString())
                    .put("status", entry.status).put("error", entry.error).toString())
            }
        }
        AlertDialog(
            onDismissRequest = { showHistory = false },
            title = { Text("Recent actions") },
            text = {
                SelectionContainer {
                    Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                        Text(export, style = MaterialTheme.typography.bodySmall)
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("Notification Manager action log", export))
                    copied = true
                }) { Text(if (copied) "Copied" else "Copy log") }
            },
            dismissButton = { TextButton(onClick = { showHistory = false }) { Text("Back") } }
        )
    }
    if (showPresets) AlertDialog(
        onDismissRequest = { showPresets = false },
        title = { Text("Review window") },
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                WindowPreset.entries.forEach { preset ->
                    TextButton(onClick = {
                        showPresets = false
                        onPresetChange(preset)
                    }) { Text(preset.label) }
                }
                TextButton(onClick = {
                    showPresets = false
                    customLookbackText = lookbackDays.toString()
                    showLookbackPicker = true
                }) { Text("Custom lookback: $lookbackDays days") }
                TextButton(onClick = {
                    showPresets = false
                    customLookaheadText = lookaheadDays.toString()
                    showLookaheadPicker = true
                }) { Text("Custom lookahead: $lookaheadDays days") }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = { showPresets = false }) { Text("Cancel") } }
    )
    if (showLookbackPicker) {
        val customDays = customLookbackText.toIntOrNull()
        AlertDialog(
            onDismissRequest = { showLookbackPicker = false },
            title = { Text("Show past events") },
            text = {
                Column {
                    for (days in listOf(7, 14, 30)) {
                        TextButton(onClick = {
                            showLookbackPicker = false
                            onLookbackChange(days)
                        }) { Text("Last $days days") }
                    }
                    OutlinedTextField(
                        value = customLookbackText,
                        onValueChange = { customLookbackText = it.filter(Char::isDigit).take(3) },
                        label = { Text("Custom days (1–365)") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true
                    )
                }
            },
            confirmButton = {
                TextButton(
                    enabled = customDays != null && customDays in 1..365,
                    onClick = {
                        showLookbackPicker = false
                        onLookbackChange(customDays!!)
                    }
                ) { Text("Apply") }
            },
            dismissButton = { TextButton(onClick = { showLookbackPicker = false }) { Text("Cancel") } }
        )
    }

    if (showLookaheadPicker) {
        val customDays = customLookaheadText.toIntOrNull()
        AlertDialog(
            onDismissRequest = { showLookaheadPicker = false },
            title = { Text("Show upcoming events") },
            text = {
                Column {
                    for (days in listOf(0, 1, 3, 7, 14, 30)) {
                        TextButton(onClick = {
                            showLookaheadPicker = false
                            onLookaheadChange(days)
                        }) { Text(if (days == 0) "Through today" else "Through $days days ahead") }
                    }
                    OutlinedTextField(
                        value = customLookaheadText,
                        onValueChange = { customLookaheadText = it.filter(Char::isDigit).take(5) },
                        label = { Text("Custom days (0–36500)") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true
                    )
                }
            },
            confirmButton = {
                TextButton(
                    enabled = customDays != null && customDays in 0..36500,
                    onClick = {
                        showLookaheadPicker = false
                        onLookaheadChange(customDays!!)
                    }
                ) { Text("Apply") }
            },
            dismissButton = { TextButton(onClick = { showLookaheadPicker = false }) { Text("Cancel") } }
        )
    }

    if (showSkins) SkinDialog(
        current = skin,
        onDismiss = { showSkins = false },
        onApply = { selected -> onSkinChange(selected); showSkins = false }
    )

    datePickerEvent?.let { event ->
        val datePickerState = rememberDatePickerState()
        DatePickerDialog(
            onDismissRequest = { datePickerEvent = null },
            confirmButton = {
                TextButton(
                    enabled = datePickerState.selectedDateMillis != null,
                    onClick = {
                        val selectedMillis = datePickerState.selectedDateMillis
                        if (selectedMillis != null) {
                            val selectedDate = Instant.ofEpochMilli(selectedMillis)
                                .atZone(ZoneOffset.UTC).toLocalDate()
                            datePickerEvent = null
                            onMove(event, MoveTarget.OnDate(selectedDate))
                        }
                    }
                ) { Text("Move") }
            },
            dismissButton = {
                TextButton(onClick = { datePickerEvent = null }) { Text("Cancel") }
            }
        ) {
            DatePicker(state = datePickerState)
        }
    }
}

@Composable
private fun SkinDialog(current: Skin, onDismiss: () -> Unit, onApply: (Skin) -> Unit) {
    var selected by remember(current) { mutableStateOf(current.name) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Skins") },
        text = {
            Column {
                for (name in skinNames) {
                    TextButton(onClick = { selected = name }, modifier = Modifier.fillMaxWidth()) {
                        Text(if (selected == name) "✓ $name" else name)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onApply(Skin(selected)) }) { Text("Apply") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

@Composable
private fun formatSyncTime(millis: Long): String = if (millis <= 0L) "Never" else
    Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("MMM d, h:mm a"))

@Composable
private fun AccountClock(syncState: LocalSyncState, online: Boolean, hasError: Boolean) {
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(Unit) {
        while (true) {
            val millis = System.currentTimeMillis()
            delay(60_000L - millis % 60_000L)
            now = Instant.now()
        }
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(headerClockLabel(now, ZoneId.systemDefault()), style = MaterialTheme.typography.bodyMedium)
        val headline = if (hasError && online) "Sync needs attention" else syncState.headline(online, now.toEpochMilli())
        if (headline != "Synced just now") Text(" · $headline", color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodySmall)
    }
}

private fun CalendarEvent.searchDateDescription(): String =
    if (allDayDate != null) {
        "${allDayDate.format(DateTimeFormatter.ofPattern("MMM d, yyyy"))} · all day"
    } else {
        start.atZone(ZoneId.systemDefault())
            .format(DateTimeFormatter.ofPattern("MMM d, yyyy · h:mm a"))
    }

internal fun CalendarEvent.moveDestinationTooltip(
    target: MoveTarget,
    now: Instant = Instant.now(),
    phoneZone: ZoneId = ZoneId.systemDefault()
): String {
    val date = if (allDayDate != null) {
        shiftAllDayDates(allDayDate, allDayDate.plusDays(1), now, phoneZone, calendarZone, target)
            .first
    } else {
        null
    }
    val destination = if (date != null) date.atStartOfDay(phoneZone)
    else when (target) {
        is MoveTarget.After -> now.plus(target.duration).atZone(phoneZone)
        is MoveTarget.OnDate -> target.date.atTime(now.atZone(phoneZone).toLocalTime()).atZone(phoneZone)
    }
    val dateLabel = destination.format(DateTimeFormatter.ofPattern("EEE MMM d"))
    if (date != null || target is MoveTarget.After && target.duration.toHours() >= 24) {
        return "Move to $dateLabel"
    }
    return "Move to $dateLabel, ${destination.format(DateTimeFormatter.ofPattern("h:mm a z"))}"
}

@Composable
private fun SelectableLinkedText(
    value: String,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyMedium,
    color: Color = MaterialTheme.colorScheme.onSurface
) {
    val urlPattern = remember { Regex("https?://[^\\s)]+") }
    val linkStyle = TextLinkStyles(
        style = SpanStyle(color = MaterialTheme.colorScheme.primary, textDecoration = TextDecoration.Underline)
    )
    val annotated = buildAnnotatedString {
        var position = 0
        for (match in urlPattern.findAll(value)) {
            append(value.substring(position, match.range.first))
            val url = match.value.trimEnd('.', ',', ';')
            withLink(LinkAnnotation.Url(url, styles = linkStyle)) { append(url) }
            append(match.value.substring(url.length))
            position = match.range.last + 1
        }
        append(value.substring(position))
    }
    Text(annotated, modifier = modifier, style = style, color = color)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MoveTile(
    label: String,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    description: String = label,
    tooltip: (() -> String)? = null,
    onClick: () -> Unit
) {
    @Composable fun TileSurface(tileModifier: Modifier) = Surface(
        modifier = tileModifier
            .semantics { contentDescription = description }
            .clickable(enabled = enabled, onClickLabel = description, onClick = onClick),
        color = LocalSkin.current.color("tile", LocalSkinDark.current, MaterialTheme.colorScheme.surfaceContainerHighest),
        shape = RoundedCornerShape(4.dp)
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(
                label,
                style = MaterialTheme.typography.labelLarge,
                color = if (enabled) MaterialTheme.colorScheme.onSurface
                else MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
    if (tooltip == null) {
        TileSurface(modifier)
    } else {
        TooltipBox(
            modifier = modifier,
            positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
            tooltip = { PlainTooltip { Text(tooltip()) } },
            state = rememberTooltipState(),
            enableUserInput = enabled
        ) {
            TileSurface(Modifier.fillMaxSize())
        }
    }
}

private suspend fun verifyCalendarAccess(accessToken: String): String = withContext(Dispatchers.IO) {
    val connection = URL("https://www.googleapis.com/calendar/v3/calendars/primary")
        .openConnection() as HttpURLConnection
    try {
        connection.requestMethod = "GET"
        connection.setRequestProperty("Authorization", "Bearer $accessToken")
        connection.connectTimeout = 15_000
        connection.readTimeout = 15_000

        if (connection.responseCode !in 200..299) {
            throw IllegalStateException("Calendar API returned HTTP ${connection.responseCode}.")
        }

        val response = connection.inputStream.bufferedReader().use { it.readText() }
        JSONObject(response).getString("id")
    } finally {
        connection.disconnect()
    }
}
