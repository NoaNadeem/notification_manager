export const SUPPORT_EMAIL = "noagoesplaces@gmail.com";
export const REQUEST_ACCESS_MAILTO = `mailto:${SUPPORT_EMAIL}?${new URLSearchParams({
  subject: "Notification Manager access request",
  body: "Hello,\n\nPlease approve my Google account for Notification Manager.\n\nGoogle account email to approve: [enter your Google account email]\n\nThank you!"
}).toString().replace(/\+/g, "%20")}`;

// mailto navigation can succeed without an email handler opening. Keep the
// manual route visible regardless; never infer success from focus or a timer.
export async function requestAccess(openMail, showStatus) {
  showStatus(`If no email draft opens, email ${SUPPORT_EMAIL} to request access. Include the Google account email you want approved.`);
  try {
    await openMail(REQUEST_ACCESS_MAILTO);
  } catch {
    showStatus(`Could not open your email app. Email ${SUPPORT_EMAIL} to request access. Include the Google account email you want approved.`);
  }
}
