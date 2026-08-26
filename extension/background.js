"use strict";

// Keeps the saved Supabase session fresh even when the popup is closed. All
// extension surfaces refresh through this worker so rotating refresh tokens
// are serialized instead of being exchanged concurrently.

importScripts("core.js");

const API = "https://xkrpxvswdkreglmefuot.supabase.co/functions/v1/agent-api";
const Core = globalThis.CaughtUpCore;
const ALARM_NAME = "caughtup-session-refresh";
const REFRESH_AHEAD_MS = 30 * 60_000;
let refreshInFlight = null;

function ensureAlarm() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 20 });
}

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void refreshPersistedSession(false);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "caughtup-refresh-session") return false;
  void refreshPersistedSession(message.force === true).then(sendResponse);
  return true;
});

async function performSessionRefresh(force) {
  let stored;
  try {
    stored = (await chrome.storage.local.get("caughtup_session")).caughtup_session;
  } catch {
    return { ok: false, status: 503, code: "auth_unavailable" };
  }
  const session = Core.normalizeAuthSession(stored);
  if (!session) return { ok: false, status: 401, code: "invalid_session" };
  const expiry = Core.expiryToMs(session.expires_at);
  if (!force && (expiry === null || expiry > Date.now() + REFRESH_AHEAD_MS)) {
    return { ok: true, session };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "auth_refresh", refresh_token: session.refresh_token }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      return {
        ok: false,
        status: response.status,
        code: response.status === 401 ? "invalid_session" : (payload?.code || "auth_unavailable"),
      };
    }
    const next = Core.normalizeAuthSession(await response.json());
    if (!next) return { ok: false, status: 401, code: "invalid_session" };
    const current = Core.normalizeAuthSession(
      (await chrome.storage.local.get("caughtup_session")).caughtup_session,
    );
    if (current && current.refresh_token !== session.refresh_token) return { ok: true, session: current };
    await chrome.storage.local.set({ caughtup_session: next });
    return { ok: true, session: next };
  } catch {
    return { ok: false, status: 503, code: "auth_unavailable" };
  }
}

function refreshPersistedSession(force) {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = performSessionRefresh(force).finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

// Recreate the idempotent alarm when a reloaded service worker starts too.
ensureAlarm();
