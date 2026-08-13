"use strict";

// Keeps the saved Supabase session fresh even when the popup is closed, so
// opening CaughtUp never lands on the sign-in screen just because the access
// token expired. The popup remains the only place that may sign the user out;
// this worker never deletes the stored session.

importScripts("core.js");

const API = "https://xkrpxvswdkreglmefuot.supabase.co/functions/v1/agent-api";
const Core = globalThis.CaughtUpCore;
const ALARM_NAME = "caughtup-session-refresh";
const REFRESH_AHEAD_MS = 30 * 60_000;

function ensureAlarm() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 20 });
}

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void refreshSoonExpiringSession();
});

async function refreshSoonExpiringSession() {
  let stored;
  try {
    stored = (await chrome.storage.local.get("caughtup_session")).caughtup_session;
  } catch {
    return;
  }
  const session = Core.normalizeAuthSession(stored);
  if (!session) return;
  const expiry = Core.expiryToMs(session.expires_at);
  if (expiry === null || expiry > Date.now() + REFRESH_AHEAD_MS) return;
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
    if (!response.ok) return;
    const next = Core.normalizeAuthSession(await response.json());
    if (!next) return;
    // If the popup rotated the session while this refresh was in flight, its
    // newer tokens win; saving ours would clobber a fresher pair.
    const current = Core.normalizeAuthSession(
      (await chrome.storage.local.get("caughtup_session")).caughtup_session,
    );
    if (current && current.refresh_token !== session.refresh_token) return;
    await chrome.storage.local.set({ caughtup_session: next });
  } catch {
    /* transient failure — the next alarm retries; the popup handles real expiry */
  }
}
