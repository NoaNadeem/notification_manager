// Reconnect deliberately requests Google's UI rather than silently reusing an old token.
export async function reconnectGoogleAccess(identity, connect) {
  await identity.clearAllCachedAuthTokens();
  return connect(true);
}

export function needsGoogleConsent(error) {
  if (error?.status === 401 || ["ACCESS_TOKEN_SCOPE_INSUFFICIENT", "insufficientPermissions"].includes(error?.reason)) return true;
  return /oauth2? not granted|oauth.*consent|insufficient.*scope|permission.*required|authorization.*required|not signed in/i.test(error?.message || "");
}
