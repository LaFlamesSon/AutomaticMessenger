"use strict";

const API = "https://xkrpxvswdkreglmefuot.supabase.co/functions/v1/agent-api";
const SUPABASE_AUTH = "https://xkrpxvswdkreglmefuot.supabase.co/auth/v1/authorize";
const GMAIL_RECONNECT_STORAGE = "caughtup_gmail_reconnect_required";
const Core = globalThis.CaughtUpCore;
const $ = (id) => document.getElementById(id);
const flow = new URL(location.href).searchParams.get("flow") || "google";

let session = null;
let running = false;

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
  if (code === "gmail_provider_unavailable") {
    return new Core.ApiError("Continue with the Gmail permission step.", status, code);
  }
  if (code === "gmail_already_connected") {
    return new Core.ApiError("That Gmail inbox is already connected to another CaughtUp account.", status, code);
  }
  if (code === "probe_unavailable") {
    return new Core.ApiError("The Gmail send test has not been enabled yet.", status, code);
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
  authorize.searchParams.set("scopes", "openid email profile https://www.googleapis.com/auth/gmail.modify");
  authorize.searchParams.set("access_type", "offline");
  authorize.searchParams.set("prompt", "consent");
  const auth = Core.parseOAuthCallback(await launchAuthFlow(authorize.toString()));
  if (auth.error) throw new Core.ApiError("Google sign-in did not finish. Try again.", 0, "oauth_error");
  if (!auth.access_token) throw new Core.ApiError("Google sign-in did not create a CaughtUp session.", 0, "missing_session");
  const nextSession = Core.normalizeAuthSession(auth);
  if (!nextSession) throw new Core.ApiError("Google did not return a reusable CaughtUp session. Try connecting again.", 401, "invalid_session");
  await saveSession(nextSession);
  const providerTokens = auth.provider_token && auth.provider_refresh_token ? {
    provider_access_token: auth.provider_token,
    provider_refresh_token: auth.provider_refresh_token,
  } : null;
  return { providerTokens, redirectUrl };
}

async function connectGoogle() {
  if (running) return;
  running = true;
  $("retry").classList.add("hidden");
  $("close").classList.add("hidden");
  $("title").textContent = "Connecting CaughtUp";
  $("message").textContent = "Keep this page open while Google sign-in and Gmail access finish.";
  setProgress(10, "Checking your CaughtUp session…");
  let providerTokens = null;
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

    const startedWithoutSession = !session;
    let providerHandoffCompleted = false;
    let redirectUrl = chrome.identity.getRedirectURL("caughtup");
    if (!session) {
      const signedIn = await signInWithGoogle();
      providerTokens = signedIn.providerTokens;
      redirectUrl = signedIn.redirectUrl;
      setProgress(48, "Google sign-in saved. Verifying your CaughtUp account…");
      profile = await api("profile_get");
    }

    if (providerTokens) {
      setProgress(62, "Connecting Gmail access…");
      try {
        await api("gmail_connect_provider", providerTokens);
        providerHandoffCompleted = true;
        await rememberReconnect(false);
        profile = await api("profile_get");
      } catch (error) {
        if (error?.code !== "gmail_provider_unavailable") throw error;
        await rememberReconnect(true);
      } finally {
        providerTokens = null;
      }
    }

    if (startedWithoutSession && !providerHandoffCompleted) await rememberReconnect(true);
    const reconnectState = await chrome.storage.local.get(GMAIL_RECONNECT_STORAGE);
    if (profile?.gmail_connected !== true || reconnectState[GMAIL_RECONNECT_STORAGE] === true) {
      setProgress(70, "Complete the Gmail permission step in the window that opened.");
      const gmailStart = await api("gmail_connect_start", { redirect_url: redirectUrl });
      if (!gmailStart.authorization_url) throw new Core.ApiError("Gmail connection is not available yet.", 0, "missing_gmail_url");
      const gmailAuth = Core.parseOAuthCallback(await launchAuthFlow(gmailStart.authorization_url));
      if (gmailAuth.error || gmailAuth.caughtup_gmail !== "connected") {
        throw new Core.ApiError("Gmail connection did not finish. Try again.", 0, "gmail_oauth_error");
      }
      setProgress(88, "Confirming Gmail access…");
      profile = await api("profile_get");
      if (profile.gmail_connected !== true) {
        throw new Core.ApiError("Gmail connection is still being confirmed. Try again.", 0, "gmail_not_connected");
      }
      await rememberReconnect(false);
    }

    setProgress(100, "CaughtUp is connected.", "success");
    $("statusMark").textContent = "✓";
    $("title").textContent = "You’re connected";
    $("message").textContent = "Close this page, then open the CaughtUp extension. Your session is saved for future use.";
    $("close").classList.remove("hidden");
  } catch (error) {
    providerTokens = null;
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
  setProgress(12, "Checking your CaughtUp sessionâ€¦");
  try {
    const stored = await chrome.storage.local.get("caughtup_session");
    session = stored.caughtup_session || null;
    if (!session) throw new Core.ApiError("Open CaughtUp and connect Google first.", 401, "unauthorized");
    await api("profile_get");
    setProgress(35, "Opening TikTok creator authorizationâ€¦");
    const redirectUrl = chrome.identity.getRedirectURL("caughtup_tiktok");
    const start = await api("tiktok_connect_start", { redirect_url: redirectUrl });
    if (!start.authorization_url) throw new Core.ApiError("TikTok connection is not available yet.", 0, "missing_tiktok_url");
    const callback = Core.parseOAuthCallback(await launchAuthFlow(start.authorization_url));
    if (callback.error || callback.caughtup_tiktok !== "connected") {
      throw new Core.ApiError("TikTok creator authorization did not finish.", 0, callback.error || "tiktok_oauth_error");
    }
    setProgress(82, "Finding relevant TikTok Shop productsâ€¦");
    const result = await api("opportunity_refresh");
    const connection = (result.affiliate_connections || []).find((item) => item.provider === "tiktok_shop");
    if (connection?.status !== "connected") throw new Core.ApiError("TikTok access still needs attention. Try connecting again.", 0, "tiktok_not_connected");
    setProgress(100, "TikTok Shop is connected.", "success");
    $("statusMark").textContent = "âœ“";
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

async function runGmailSendProbe() {
  if (running) return;
  running = true;
  $("retry").classList.add("hidden");
  $("close").classList.add("hidden");
  $("title").textContent = "Testing Gmail send access";
  $("message").textContent = "This controlled test sends one fixed email from the authorized company account back to itself.";
  $("safety").textContent = "No inbox mail is read. No Google token is saved by this probe.";
  setProgress(12, "Checking your existing CaughtUp session…");
  try {
    const stored = await chrome.storage.local.get("caughtup_session");
    session = Core.normalizeAuthSession(stored.caughtup_session);
    if (!session) throw new Core.ApiError("Open CaughtUp and connect Google first.", 401, "unauthorized");
    await api("profile_get");
    setProgress(35, "Opening the minimal Gmail consent screen…");
    const redirectUrl = chrome.identity.getRedirectURL("caughtup_gmail_send_probe");
    const start = await api("gmail_send_probe_start", { redirect_url: redirectUrl });
    if (!start.authorization_url) throw new Core.ApiError("The Gmail send test is not available yet.", 0, "missing_probe_url");
    const callback = Core.parseOAuthCallback(await launchAuthFlow(start.authorization_url));
    if (callback.error || callback.caughtup_gmail_probe !== "sent") {
      throw new Core.ApiError("The Gmail send test did not finish.", 0, callback.error || "probe_failed");
    }
    setProgress(100, "One self-addressed Gmail test was sent.", "success");
    $("statusMark").textContent = "✓";
    $("title").textContent = "Gmail send test passed";
    $("message").textContent = "Check the company account's Inbox and Sent folder for the marked CaughtUp OAuth test message.";
    $("close").classList.remove("hidden");
  } catch (error) {
    setProgress(100, Core.safeErrorMessage(error), "error");
    $("statusMark").textContent = "!";
    $("title").textContent = "Gmail send test needs attention";
    $("message").textContent = "No retry happens automatically. Resolve the shown issue before trying again.";
    $("retry").classList.remove("hidden");
  } finally { running = false; }
}

function connect() {
  if (flow === "tiktok") return connectTikTok();
  if (flow === "gmail-send-probe") return runGmailSendProbe();
  return connectGoogle();
}

$("retry").addEventListener("click", connect);
$("close").addEventListener("click", () => window.close());
connect();
