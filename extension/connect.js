"use strict";

const API = "https://xkrpxvswdkreglmefuot.supabase.co/functions/v1/agent-api";
const SUPABASE_AUTH = "https://xkrpxvswdkreglmefuot.supabase.co/auth/v1/authorize";
const GMAIL_RECONNECT_STORAGE = "caughtup_gmail_reconnect_required";
const Core = globalThis.CaughtUpCore;
const $ = (id) => document.getElementById(id);
const flow = new URL(location.href).searchParams.get("flow") || "google";

let session = null;
let running = false;
let connectedProfile = null;
let forwardingState = null;
let forwardingConfirmationUrl = null;
let forwardingGmailSettingsUrl = "https://mail.google.com/mail/#settings/fwdandpop";
let forwardingPollTimer = null;
let intakeConfirmAlias = "";

function setProgress(percent, message, kind = "") {
  $("progress").style.width = `${percent}%`;
  $("detail").textContent = message;
  $("detail").className = `detail ${kind}`.trim();
}

function apiError(data, status) {
  const code = String(data?.code || data?.error || "request_failed").toLowerCase();
  if (status === 401 || code === "unauthorized" || code === "invalid_session") {
    return new Core.ApiError("Your Google session expired. Try connecting again.", status, "unauthorized");
  }
  if (code === "gmail_already_connected") {
    return new Core.ApiError("That Gmail inbox is already connected to another CaughtUp account.", status, code);
  }
  if (status === 400 || status === 422) {
    return new Core.ApiError("Google connection could not be verified. Try again.", status, code);
  }
  return new Core.ApiError("CaughtUp could not finish connecting. Try again.", status, code);
}

async function fetchApi(action, extra = {}, publicRequest = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(API, {
      method: "POST",
      headers: Core.authHeaders(publicRequest ? null : session),
      body: JSON.stringify({ action, ...extra }),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* use a safe error below */ }
    if (!response.ok || data?.error) throw apiError(data, response.status);
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Core.ApiError("CaughtUp took too long to respond. Try again.", 0, "timeout");
    if (error instanceof Core.ApiError) throw error;
    throw new Core.ApiError("CaughtUp could not connect. Check your internet connection and try again.", 0, "network");
  } finally {
    clearTimeout(timeout);
  }
}

async function saveSession(nextSession) {
  const normalized = Core.normalizeAuthSession(nextSession);
  if (!normalized) throw new Core.ApiError("Google did not return a reusable CaughtUp session. Try connecting again.", 401, "invalid_session");
  session = normalized;
  await chrome.storage.local.set({ caughtup_session: session });
}

async function clearSession() {
  session = null;
  await chrome.storage.local.remove("caughtup_session");
}

async function refreshSession() {
  const result = await chrome.runtime.sendMessage({ type: "caughtup-refresh-session", force: true })
    .catch(() => ({ ok: false, status: 503, code: "auth_unavailable" }));
  if (!result?.ok) {
    throw new Core.ApiError("Your session could not be refreshed.", result?.status || 503, result?.code || "auth_unavailable");
  }
  const normalized = Core.normalizeAuthSession(result.session);
  if (!normalized) throw new Core.ApiError("Your session could not be refreshed.", 401, "invalid_session");
  session = normalized;
}

async function api(action, extra = {}) {
  if (Core.shouldRefreshSession(session)) await refreshSession();
  try {
    return await fetchApi(action, extra);
  } catch (error) {
    if (error.status === 401 && session?.refresh_token && action !== "auth_refresh") {
      await refreshSession();
      return fetchApi(action, extra);
    }
    throw error;
  }
}

async function launchAuthFlow(url) {
  if (!chrome.identity?.launchWebAuthFlow) {
    throw new Core.ApiError("Reload CaughtUp as an unpacked Chrome extension and try again.", 0, "identity_unavailable");
  }
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectUrl) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError || !redirectUrl) {
        reject(new Core.ApiError(`${flow === "tiktok" ? "TikTok" : "Google"} connection was canceled or could not finish.`, 0, "oauth_canceled"));
        return;
      }
      resolve(redirectUrl);
    });
  });
}

async function rememberReconnect(required) {
  if (required) await chrome.storage.local.set({ [GMAIL_RECONNECT_STORAGE]: true });
  else await chrome.storage.local.remove(GMAIL_RECONNECT_STORAGE);
}

async function signInWithGoogle() {
  setProgress(22, "Complete Google sign-in in the window that opened.");
  const redirectUrl = chrome.identity.getRedirectURL("caughtup");
  const authorize = new URL(SUPABASE_AUTH);
  authorize.searchParams.set("provider", "google");
  authorize.searchParams.set("redirect_to", redirectUrl);
  authorize.searchParams.set("scopes", "openid email profile");
  authorize.searchParams.set("prompt", "select_account");
  const auth = Core.parseOAuthCallback(await launchAuthFlow(authorize.toString()));
  if (auth.error) throw new Core.ApiError("Google sign-in did not finish. Try again.", 0, "oauth_error");
  if (!auth.access_token) throw new Core.ApiError("Google sign-in did not create a CaughtUp session.", 0, "missing_session");
  const nextSession = Core.normalizeAuthSession(auth);
  if (!nextSession) throw new Core.ApiError("Google did not return a reusable CaughtUp session. Try connecting again.", 401, "invalid_session");
  await saveSession(nextSession);
  return redirectUrl;
}

const Forwarding = globalThis.CaughtUpForwarding;
const INTAKE_CONFIRM_STORAGE = "caughtup_intake_confirm_alias";

async function rememberIntakeConfirm(alias) {
  intakeConfirmAlias = alias || "";
  try {
    if (intakeConfirmAlias) await chrome.storage.local.set({ [INTAKE_CONFIRM_STORAGE]: intakeConfirmAlias });
    else await chrome.storage.local.remove(INTAKE_CONFIRM_STORAGE);
  } catch { /* in-memory flag still drives this page */ }
}

function renderForwardingSetup(result = {}) {
  const view = Forwarding.wizardView(result, { confirmOpened: Boolean(intakeConfirmAlias) && intakeConfirmAlias === result.forwarding?.alias_address });
  forwardingState = view.forwarding;
  forwardingConfirmationUrl = view.confirmationUrl;
  forwardingGmailSettingsUrl = view.gmailSettingsUrl;
  const forwarding = view.forwarding;
  $("forwardingSetup").classList.remove("hidden");
  $("forwardingAddressRow").classList.toggle("hidden", !forwarding.alias_address);
  $("forwardingAddress").textContent = forwarding.alias_address || "";
  $("forwardingCode").classList.toggle("hidden", !forwarding.verification_code);
  $("forwardingCode").textContent = forwarding.verification_code ? `Google confirmation code: ${forwarding.verification_code}` : "";
  $("forwardingInstructions").textContent = view.copy;
  $("intakePrimary").classList.toggle("hidden", view.hiddenPrimary);
  $("intakeNewAddress").classList.add("hidden");
  if (!view.hiddenPrimary) {
    $("intakePrimary").textContent = view.label;
    $("intakePrimary").dataset.label = view.label;
    $("intakePrimary").dataset.action = view.action;
  }
  if (view.status === "route_verified") {
    setProgress(100, "Gmail sending and forwarded intake are connected.", "success");
    $("statusMark").textContent = "OK";
    $("title").textContent = view.heading;
    $("message").textContent = view.summary;
    $("forwardingTestStatus").textContent = view.copy;
    $("close").classList.remove("hidden");
  } else {
    setProgress(view.status === "verifying_route" ? 98 : view.status === "google_verification_received" ? 96 : 92, "Finish the forwarding steps below.");
    $("title").textContent = view.heading;
    $("message").textContent = view.summary;
    $("forwardingTestStatus").textContent = view.probe?.status === "failed"
      ? "The connection check did not return yet. After Save Changes, retry verification."
      : "";
    $("close").classList.add("hidden");
  }
  if (forwardingPollTimer) clearTimeout(forwardingPollTimer);
  if (Forwarding.shouldPoll(view)) {
    forwardingPollTimer = setTimeout(async () => {
      try { renderForwardingSetup(await api("forwarding_setup_get")); } catch { /* keep current recoverable setup state */ }
    }, 5000);
  }
}

async function handleIntakePrimaryClick() {
  const button = $("intakePrimary");
  const action = button.dataset.action || Forwarding.wizardView({
    forwarding: forwardingState || { status: "not_started" },
    gmail_settings_url: forwardingGmailSettingsUrl,
  }, { confirmOpened: intakeConfirmAlias === forwardingState?.alias_address }).action;
  if (action === "confirm_google" && forwardingConfirmationUrl) {
    chrome.tabs.create({ url: forwardingConfirmationUrl });
    await rememberIntakeConfirm(forwardingState?.alias_address || "");
    renderForwardingSetup({ forwarding: forwardingState, gmail_settings_url: forwardingGmailSettingsUrl });
    $("forwardingTestStatus").textContent = "Now enable Forward a copy in Gmail, Save Changes, then verify the connection.";
    return;
  }
  button.disabled = true;
  try {
    if (action === "start") {
      const result = await api("forwarding_setup_start");
      renderForwardingSetup(result);
      if (result.forwarding?.alias_address) {
        try { await navigator.clipboard.writeText(result.forwarding.alias_address); } catch { /* Copy remains available */ }
      }
      chrome.tabs.create({ url: forwardingGmailSettingsUrl });
      $("forwardingTestStatus").textContent = "Paste this address in Gmail. Wait here until Confirm appears.";
    } else if (action === "open_gmail") {
      if (forwardingState?.alias_address) {
        try { await navigator.clipboard.writeText(forwardingState.alias_address); } catch { /* Copy remains available */ }
      }
      chrome.tabs.create({ url: forwardingGmailSettingsUrl });
      $("forwardingTestStatus").textContent = "Paste this address in Gmail. Wait here until Confirm appears.";
    } else if (action === "verify_route") {
      chrome.tabs.create({ url: forwardingGmailSettingsUrl });
      const status = Forwarding.canonicalStatus(forwardingState?.status);
      const result = status === "google_verification_received"
        ? await api("forwarding_setup_activate", { confirm: true })
        : await api("forwarding_route_probe", { confirm: true });
      renderForwardingSetup(result);
      $("forwardingTestStatus").textContent = "CaughtUp is checking that Gmail forwarded the connection message.";
    }
  } catch (error) {
    try { renderForwardingSetup(await api("forwarding_setup_get")); } catch { /* keep wizard */ }
    $("forwardingTestStatus").textContent = Core.safeErrorMessage(error);
  } finally {
    button.disabled = false;
  }
}

async function beginForwardingSetup(profile) {
  connectedProfile = Core.normalizeProfile(profile?.profile || profile || {});
  try {
    const stored = await chrome.storage.local.get(INTAKE_CONFIRM_STORAGE);
    intakeConfirmAlias = typeof stored[INTAKE_CONFIRM_STORAGE] === "string" ? stored[INTAKE_CONFIRM_STORAGE] : "";
  } catch { intakeConfirmAlias = ""; }
  try {
    renderForwardingSetup(await api("forwarding_setup_start"));
  } catch {
    renderForwardingSetup(await api("forwarding_setup_get"));
  }
}

async function connectGoogle() {
  if (running) return;
  running = true;
  $("retry").classList.add("hidden");
  $("close").classList.add("hidden");
  $("title").textContent = "Connecting CaughtUp";
  $("message").textContent = "Keep this page open while Google sign-in and Gmail sending access finish.";
  setProgress(10, "Checking your CaughtUp session...");
  try {
    const stored = await chrome.storage.local.get(["caughtup_session", GMAIL_RECONNECT_STORAGE]);
    session = Core.normalizeAuthSession(stored.caughtup_session);
    if (stored.caughtup_session && !session) await clearSession();
    let profile = null;
    if (session) {
      try {
        profile = await api("profile_get");
      } catch (error) {
        if (error?.code !== "unauthorized" && error?.status !== 401) throw error;
        await clearSession();
      }
    }

    let redirectUrl = chrome.identity.getRedirectURL("caughtup");
    if (!session) {
      redirectUrl = await signInWithGoogle();
      setProgress(48, "Google sign-in saved. Verifying your CaughtUp account...");
      profile = await api("profile_get");
    }

    const reconnectState = await chrome.storage.local.get(GMAIL_RECONNECT_STORAGE);
    if (profile?.gmail_connected !== true || reconnectState[GMAIL_RECONNECT_STORAGE] === true) {
      setProgress(70, "Allow CaughtUp to send Gmail replies in the window that opened.");
      const gmailStart = await api("gmail_connect_start", { redirect_url: redirectUrl });
      if (!gmailStart.authorization_url) throw new Core.ApiError("Gmail connection is not available yet.", 0, "missing_gmail_url");
      const gmailAuth = Core.parseOAuthCallback(await launchAuthFlow(gmailStart.authorization_url));
      if (gmailAuth.error || gmailAuth.caughtup_gmail !== "connected") {
        throw new Core.ApiError("Gmail connection did not finish. Try again.", 0, "gmail_oauth_error");
      }
      setProgress(88, "Confirming Gmail sending access...");
      profile = await api("profile_get");
      if (profile.gmail_connected !== true) {
        throw new Core.ApiError("Gmail connection is still being confirmed. Try again.", 0, "gmail_not_connected");
      }
      await rememberReconnect(false);
    }

    await beginForwardingSetup(profile);
  } catch (error) {
    setProgress(100, Core.safeErrorMessage(error), "error");
    $("statusMark").textContent = "!";
    $("title").textContent = "Connection needs attention";
    $("message").textContent = "No email was sent. You can safely retry the connection.";
    $("retry").classList.remove("hidden");
  } finally {
    running = false;
  }
}

async function connectTikTok() {
  if (running) return;
  running = true;
  $("retry").classList.add("hidden");
  $("close").classList.add("hidden");
  $("title").textContent = "Connecting TikTok Shop";
  $("message").textContent = "Keep this page open while TikTok verifies your creator account.";
  setProgress(12, "Checking your CaughtUp session...");
  try {
    const stored = await chrome.storage.local.get("caughtup_session");
    session = stored.caughtup_session || null;
    if (!session) throw new Core.ApiError("Open CaughtUp and connect Google first.", 401, "unauthorized");
    await api("profile_get");
    setProgress(35, "Opening TikTok creator authorization...");
    const redirectUrl = chrome.identity.getRedirectURL("caughtup_tiktok");
    const start = await api("tiktok_connect_start", { redirect_url: redirectUrl });
    if (!start.authorization_url) throw new Core.ApiError("TikTok connection is not available yet.", 0, "missing_tiktok_url");
    const callback = Core.parseOAuthCallback(await launchAuthFlow(start.authorization_url));
    if (callback.error || callback.caughtup_tiktok !== "connected") {
      throw new Core.ApiError("TikTok creator authorization did not finish.", 0, callback.error || "tiktok_oauth_error");
    }
    setProgress(82, "Finding relevant TikTok Shop products...");
    const result = await api("opportunity_refresh");
    const connection = (result.affiliate_connections || []).find((item) => item.provider === "tiktok_shop");
    if (connection?.status !== "connected") throw new Core.ApiError("TikTok access still needs attention. Try connecting again.", 0, "tiktok_not_connected");
    setProgress(100, "TikTok Shop is connected.", "success");
    $("statusMark").textContent = "OK";
    $("title").textContent = "TikTok is connected";
    $("message").textContent = "Close this page and open Opportunities to see product matches.";
    $("close").classList.remove("hidden");
  } catch (error) {
    setProgress(100, Core.safeErrorMessage(error), "error");
    $("statusMark").textContent = "!";
    $("title").textContent = "TikTok connection needs attention";
    $("message").textContent = "No email was sent. You can safely retry the connection.";
    $("retry").classList.remove("hidden");
  } finally { running = false; }
}

function connect() {
  if (flow === "tiktok") return connectTikTok();
  return connectGoogle();
}

$("retry").addEventListener("click", connect);
$("close").addEventListener("click", () => window.close());
$("copyForwarding").addEventListener("click", async () => {
  if (!forwardingState?.alias_address) return;
  await navigator.clipboard.writeText(forwardingState.alias_address);
  $("forwardingTestStatus").textContent = "Forwarding address copied.";
});
$("intakePrimary").addEventListener("click", () => { void handleIntakePrimaryClick(); });
$("intakeNewAddress").addEventListener("click", () => {
  $("forwardingTestStatus").textContent = "CaughtUp keeps this address. Finish Confirm and Verify connection instead of creating a new one.";
});
connect();
