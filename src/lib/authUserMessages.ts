/**
 * Maps Supabase Auth errors to short, end-user-facing copy.
 * Unknown errors fall back to the server message.
 */
type AuthLikeError = {
  message: string;
  code?: string;
  status?: number;
};

export function friendlyAuthErrorMessage(error: AuthLikeError): string {
  const code = (error.code ?? "").toLowerCase();
  const raw = (error.message ?? "").trim();
  const msg = raw.toLowerCase();

  if (
    code === "over_email_send_rate_limit" ||
    msg.includes("email rate limit") ||
    (msg.includes("rate limit") && (msg.includes("email") || msg.includes("smtp")))
  ) {
    return "Too many sign-in emails were sent recently. Wait a little while, then try again—or use Continue with Google.";
  }

  if (code === "over_request_rate_limit") {
    return "Too many sign-in attempts from this network right now. Wait a few minutes and try again.";
  }

  if (error.status === 429) {
    return "Too many sign-in attempts right now. Wait a few minutes, then try again—or use Continue with Google.";
  }

  if (code === "email_address_not_authorized") {
    return "This app cannot send a sign-in email to that address yet. Try Google sign-in, or ask the site owner to configure email (SMTP) for this project.";
  }

  if (code === "email_address_invalid") {
    return "That email address cannot be used here. Try a different one.";
  }

  if (code === "otp_disabled" || code === "email_provider_disabled") {
    return "Email sign-in is turned off for this app. Try Google—or contact the site owner.";
  }

  if (code === "signup_disabled") {
    return "New accounts are disabled for this app right now.";
  }

  if (code === "provider_disabled") {
    return "That sign-in option is disabled. Try another method.";
  }

  if (code === "captcha_failed") {
    return "The security check did not pass. Refresh the page and try again.";
  }

  if (code === "user_banned") {
    return "This account cannot sign in right now.";
  }

  if (code === "email_not_confirmed") {
    return "Confirm your email address first, then try signing in again.";
  }

  if (code === "flow_state_expired" || code === "flow_state_not_found") {
    return "That sign-in session expired. Start over from the login page.";
  }

  if (code === "unexpected_failure" || code === "request_timeout") {
    return "Something went wrong on our side. Please try again in a moment.";
  }

  if (code && !raw) {
    return `Sign-in could not complete (${code}). Please try again.`;
  }

  return raw || "Something went wrong. Please try again.";
}
