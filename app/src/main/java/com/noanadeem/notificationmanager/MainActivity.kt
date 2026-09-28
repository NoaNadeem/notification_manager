package com.noanadeem.notificationmanager

import android.app.Activity
import android.accounts.Account
import android.content.Context
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
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.clickable
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.style.TextDecoration
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
import java.time.ZoneOffset
import kotlinx.coroutines.Dispatchers
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
private const val DARK_MODE_KEY = "dark_mode"

private enum class ConnectionScreen { Checking, Disconnected, Connected, Error }
private data class PendingMove(val event: CalendarEvent, val target: MoveTarget)

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
            NotificationManagerTheme(darkTheme = darkMode) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    SelectionContainer {
                        CalendarLoginScreen(
                            darkMode = darkMode,
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

@Composable
private fun CalendarLoginScreen(
    darkMode: Boolean,
    onDarkModeChange: (Boolean) -> Unit
) {
    val activity = LocalContext.current as ComponentActivity
    val authorizationClient = remember(activity) { Identity.getAuthorizationClient(activity) }
    val preferences = remember(activity) {
        activity.getSharedPreferences(CONNECTION_PREFERENCES, Context.MODE_PRIVATE)
    }
    val coroutineScope = rememberCoroutineScope()
    val dismissalStore = remember(activity) { DismissalStore(activity) }
    val dismissalMutex = remember { Mutex() }

    var screen by remember {
        mutableStateOf(
            if (preferences.getBoolean(AUTO_CONNECT_KEY, true)) {
                ConnectionScreen.Checking
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
    var recentEvents by remember { mutableStateOf<List<CalendarEvent>>(emptyList()) }
    var eventsLoading by remember { mutableStateOf(false) }
    var eventsError by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var pendingMove by remember { mutableStateOf<PendingMove?>(null) }
    var movingEventId by remember { mutableStateOf<String?>(null) }
    var dismissals by remember { mutableStateOf<List<DismissalRecord>>(emptyList()) }
    var driveError by remember { mutableStateOf<String?>(null) }
    var currentAccessToken by remember { mutableStateOf<String?>(null) }
    var storageEstimate by remember { mutableStateOf<String?>(null) }

    fun useAuthorizationResult(result: AuthorizationResult, interactive: Boolean) {
        val move = pendingMove
        val refreshing = !interactive && screen == ConnectionScreen.Connected
        val accessToken = result.accessToken
        if (accessToken.isNullOrEmpty()) {
            loading = false
            if (move != null) {
                actionError = "Google did not authorize the event move."
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
            coroutineScope.launch {
                try {
                    val movedEvent = moveCalendarEvent(accessToken, move.event, move.target)
                    val now = Instant.now()
                    recentEvents = recentEvents.mapNotNull {
                        if (it.calendarId == move.event.calendarId && it.id == move.event.id) {
                            movedEvent.takeIf { updated ->
                                isInPastWindow(updated.start, now, lookbackDays)
                            }
                        } else {
                            it
                        }
                    }.sortedByDescending { it.start }
                    actionError = null
                } catch (e: Exception) {
                    actionError = e.message ?: "Could not move the event."
                } finally {
                    movingEventId = null
                }
            }
            return
        }

        coroutineScope.launch {
            try {
                val primaryCalendarId = verifyCalendarAccess(accessToken)
                // Primary calendar IDs normally match the Google account email address.
                // Keep only the account name; never persist an access token.
                accountName = result.toGoogleSignInAccount()?.account?.name
                    ?: primaryCalendarId.takeIf { "@" in it }
                    ?: accountName
                preferences.edit().apply {
                    putBoolean(AUTO_CONNECT_KEY, true)
                    if (accountName != null) putString(ACCOUNT_NAME_KEY, accountName)
                    apply()
                }
                val selectedAccount = accountName ?: primaryCalendarId
                dismissals = dismissalStore.read(selectedAccount)
                screen = ConnectionScreen.Connected
                errorMessage = null
                eventsLoading = true
                eventsError = null
                driveError = null
                try {
                    val fetched = fetchRecentEvents(accessToken, primaryCalendarId, lookbackDays)
                    recentEvents = fetched.withoutDismissals(dismissals)
                    try {
                        val merged = dismissalMutex.withLock {
                            syncDismissals(accessToken, dismissalStore, selectedAccount)
                        }
                        dismissals = merged
                        recentEvents = fetched.withoutDismissals(merged)
                    } catch (e: Exception) {
                        driveError = "Dismissals are saved on this phone, but Drive sync is unavailable: ${e.message}"
                    }
                } catch (e: Exception) {
                    eventsError = e.message ?: "Could not load recent events."
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
                pendingMove = null
                movingEventId = null
                actionError = "Event move was cancelled."
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
                    pendingMove = null
                    movingEventId = null
                    actionError = e.message ?: "Could not authorize event move."
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
        if (movingEventId != null) return
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
                        actionError = "Google authorization was unavailable."
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
                actionError = e.message ?: "Could not authorize event move."
            }
    }

    fun dismissEvent(event: CalendarEvent) {
        val selectedAccount = accountName ?: event.calendarId
        val now = Instant.now()
        val record = DismissalRecord(event.id, event.start.toEpochMilli(), now.toEpochMilli())
        coroutineScope.launch {
            try {
                val merged = dismissalMutex.withLock {
                    val saved = mergeDismissals(dismissalStore.read(selectedAccount, now), listOf(record), now)
                    dismissalStore.write(selectedAccount, saved)
                    saved
                }
                dismissals = merged
                recentEvents = recentEvents.withoutDismissals(merged)
                actionError = null
                currentAccessToken?.let { token ->
                    try {
                        dismissals = dismissalMutex.withLock {
                            syncDismissals(token, dismissalStore, selectedAccount)
                        }
                        driveError = null
                    } catch (e: Exception) {
                        driveError = "Dismissal saved on this phone; Drive sync failed: ${e.message}"
                    }
                } ?: run { driveError = "Dismissal saved on this phone; reconnect to sync with Drive." }
            } catch (e: Exception) {
                actionError = e.message ?: "Could not save dismissal."
            }
        }
    }

    fun estimateStorage() {
        val token = currentAccessToken
        if (token == null) {
            storageEstimate = "Reconnect Calendar before estimating storage."
            return
        }
        storageEstimate = "Counting events from the past year…"
        coroutineScope.launch {
            storageEstimate = try {
                val primaryId = verifyCalendarAccess(token)
                val events = fetchRecentEvents(token, primaryId, 365)
                val bytes = estimateFullYearDismissalBytes(events)
                "${events.size} events in the past year. If every one were dismissed, the Drive file would be $bytes bytes (${String.format(java.util.Locale.US, "%.1f", bytes / 1024.0)} KiB)."
                    .also { Log.i("NotificationManagerStorage", it) }
            } catch (e: Exception) {
                "Could not estimate storage: ${e.message}"
            }
        }
    }

    fun logout() {
        loading = true
        errorMessage = null
        val selectedAccount = accountName
        if (selectedAccount == null) {
            preferences.edit().putBoolean(AUTO_CONNECT_KEY, false).remove(ACCOUNT_NAME_KEY).apply()
            recentEvents = emptyList()
            dismissals = emptyList()
            currentAccessToken = null
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
        if (screen == ConnectionScreen.Checking) authorizeCalendar(interactive = false)
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
            eventsLoading = eventsLoading,
            eventsError = eventsError,
            actionError = actionError,
            driveError = driveError,
            storageEstimate = storageEstimate,
            darkMode = darkMode,
            movingEventId = movingEventId,
            lookbackDays = lookbackDays,
            onRefresh = { authorizeCalendar(interactive = false) },
            onLookbackChange = { days ->
                lookbackDays = days
                preferences.edit().putInt(LOOKBACK_DAYS_KEY, days).apply()
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
    eventsLoading: Boolean,
    eventsError: String?,
    actionError: String?,
    driveError: String?,
    storageEstimate: String?,
    darkMode: Boolean,
    movingEventId: String?,
    lookbackDays: Int,
    onRefresh: () -> Unit,
    onLookbackChange: (Int) -> Unit,
    onMove: (CalendarEvent, MoveTarget) -> Unit,
    onDismiss: (CalendarEvent) -> Unit,
    onEstimateStorage: () -> Unit,
    onDarkModeChange: (Boolean) -> Unit,
    onLogout: () -> Unit
) {
    var menuExpanded by remember { mutableStateOf(false) }
    var expandedEventId by remember { mutableStateOf<String?>(null) }
    var showLookbackPicker by remember { mutableStateOf(false) }
    var customLookbackText by remember { mutableStateOf(lookbackDays.toString()) }
    var datePickerEvent by remember { mutableStateOf<CalendarEvent?>(null) }
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Calendar connected", style = MaterialTheme.typography.headlineMedium)
            Spacer(modifier = Modifier.weight(1f))
            Column {
                IconButton(onClick = { menuExpanded = true }) {
                    Text("⋮", style = MaterialTheme.typography.headlineMedium)
                }
                DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                    DropdownMenuItem(
                        text = { Text("Refresh") },
                        leadingIcon = { Text("↻") },
                        enabled = !eventsLoading && !loading && movingEventId == null,
                        onClick = {
                            menuExpanded = false
                            onRefresh()
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Logout / Switch Account") },
                        leadingIcon = { Text("⇥") },
                        enabled = !loading && movingEventId == null,
                        onClick = {
                            menuExpanded = false
                            onLogout()
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Lookback: $lookbackDays days") },
                        leadingIcon = { Text("◷") },
                        enabled = !eventsLoading && !loading && movingEventId == null,
                        onClick = {
                            menuExpanded = false
                            customLookbackText = lookbackDays.toString()
                            showLookbackPicker = true
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Estimate 1-year storage") },
                        enabled = !eventsLoading && !loading,
                        onClick = {
                            menuExpanded = false
                            onEstimateStorage()
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Dark mode: ${if (darkMode) "On" else "Off"}") },
                        onClick = {
                            menuExpanded = false
                            onDarkModeChange(!darkMode)
                        }
                    )
                }
            }
        }
        accountName?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium)
        }
        if (loading) {
            CircularProgressIndicator(modifier = Modifier.padding(top = 24.dp))
        }
        errorMessage?.let { message ->
            SelectableLinkedText(message, modifier = Modifier.padding(top = 16.dp))
        }
        actionError?.let { message ->
            Text(
                message,
                color = MaterialTheme.colorScheme.error,
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
        storageEstimate?.let { Text(it, modifier = Modifier.padding(top = 8.dp)) }
        Text(
            "Events from the last $lookbackDays days",
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.padding(top = 24.dp)
        )
        Text(
            "Calendar events, including ones whose reminders may already be dismissed",
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(top = 4.dp, bottom = 8.dp)
        )
        when {
            eventsLoading -> CircularProgressIndicator(modifier = Modifier.padding(top = 16.dp))
            eventsError != null -> Text(eventsError, modifier = Modifier.padding(top = 16.dp))
            events.isEmpty() -> Text("No events started in the last $lookbackDays days.", modifier = Modifier.padding(top = 16.dp))
            else -> LazyColumn(modifier = Modifier.fillMaxWidth()) {
                items(events, key = { "${it.calendarId}/${it.id}" }) { event ->
                    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                        Column(
                            modifier = Modifier.fillMaxWidth().clickable {
                                expandedEventId = if (expandedEventId == event.id) null else event.id
                            }.padding(vertical = 4.dp)
                        ) {
                            Text(event.title, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyLarge)
                            Text(
                                event.startDescription(),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(top = 2.dp)
                            )
                        }
                        if (expandedEventId == event.id) {
                            Surface(
                                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant,
                                shape = RoundedCornerShape(8.dp)
                            ) {
                                Column(modifier = Modifier.padding(8.dp)) {
                                    val choices = listOf(
                                        "1D" to MoveTarget.After(Duration.ofDays(1)),
                                        "3D" to MoveTarget.After(Duration.ofDays(3)),
                                        "7D" to MoveTarget.After(Duration.ofDays(7)),
                                    ) + if (event.allDayDate == null) {
                                        listOf("4H" to MoveTarget.After(Duration.ofHours(4)))
                                    } else {
                                        emptyList()
                                    }
                                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        for ((label, target) in choices) {
                                            MoveTile(
                                                label = label,
                                                enabled = movingEventId == null,
                                                modifier = Modifier.weight(1f),
                                                onClick = { onMove(event, target) }
                                            )
                                        }
                                        MoveTile(
                                            label = "Cal",
                                            enabled = movingEventId == null,
                                            modifier = Modifier.weight(1f),
                                            onClick = { datePickerEvent = event }
                                        )
                                    }
                                    if (movingEventId == event.id) {
                                        Text("Moving event…", modifier = Modifier.padding(top = 8.dp))
                                    } else {
                                        TextButton(onClick = { onDismiss(event) }) {
                                            Text("Dismiss")
                                        }
                                    }
                                }
                            }
                        }
                    }
                    HorizontalDivider()
                }
            }
        }
    }

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

@Composable
private fun MoveTile(
    label: String,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Surface(
        modifier = modifier.aspectRatio(1f).clickable(enabled = enabled, onClick = onClick),
        color = MaterialTheme.colorScheme.surface,
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
