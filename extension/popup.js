"use strict";

const API = "https://xkrpxvswdkreglmefuot.supabase.co/functions/v1/agent-api";
const SUPABASE_AUTH = "https://xkrpxvswdkreglmefuot.supabase.co/auth/v1/authorize";
const Core = globalThis.CaughtUpCore;
const $ = (id) => document.getElementById(id);
const PANELS = ["today", "chat", "kits", "calendar", "settings"];
const PROFILE_FIELDS = ["display_name", "occupation", "services", "tone", "signoff", "custom_rules"];
const MANUAL_SEND_KEYS_STORAGE = "caughtup_manual_send_keys";
const MANUAL_SWEEP_ID_STORAGE = "caughtup_manual_sweep_request_id";
const BOOKING_REQUEST_STORAGE = "caughtup_booking_request";

let session = null;
let currentProfile = null;
let pendingDraft = null;
let pendingSendCard = null;
let manualSendKeys = {};
let manualSweepRequestId = null;
let autoSendChallenge = null;
let kitsLoaded = false;
let calendarLoaded = false;
let currentCalendar = null;
let currentBookings = [];
let pendingBookingRequest = null;
let settingsLoaded = false;
let appEmail = "";
let gmailAddress = "";
let pendingKitEdit = null;

function create(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function setStatus(id, message = "", kind = "") {
  const element = $(id);
  element.textContent = message;
  element.classList.toggle("error", kind === "error");
  element.classList.toggle("success", kind === "success");
}

function setBusy(button, busy, busyText) {
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy && busyText ? busyText : button.dataset.label;
  button.setAttribute("aria-busy", String(busy));
}

function safeApiMessage(data, status) {
  const code = String(data?.code || data?.error || "request_failed").toLowerCase();
  if (status === 401 || code === "unauthorized") return { code: "unauthorized", message: "Your session expired. Connect again." };
  if (code === "confirmation_required") return { code, message: "Auto-send is off. Review the updated policy and confirm it again." };
  if (code === "draft_changed") return { code, message: "This Gmail draft changed after the preview. Review the latest version before sending." };
  if (["duplicate_request", "send_in_progress", "claim_unavailable"].includes(code)) {
    return { code: "send_in_progress", message: "CaughtUp is checking this send. Do not send it again yet." };
  }
  if (code === "already_in_progress") {
    return { code, message: "An inbox sweep is already in progress. Check its status here." };
  }
  if (code === "version_conflict") return { code, message: "These preferences changed elsewhere. Reload and try again." };
  if (code === "booking_conflict") return { code, message: "That time overlaps an existing CaughtUp booking." };
  if (code === "outside_availability") return { code, message: "Choose a time inside your saved weekly availability." };
  if (code === "reconcile_required") {
    return { code, message: "Gmail may have sent this reply. CaughtUp is reconciling its status." };
  }
  if (status === 409 || code.includes("conflict") || code.includes("already")) return { code: "conflict", message: "That changed elsewhere. Refresh and try again." };
  if (status === 413 || code.includes("size")) return { code: "too_large", message: "That file is too large." };
  if (status === 422 || status === 400 || code.includes("invalid")) return { code: "invalid", message: "Check the information and try again." };
  if (status === 404 || code.includes("not_found")) return { code: "not_found", message: "That item is no longer available." };
  return { code: "request_failed", message: "CaughtUp couldn't complete that. Try again." };
}

async function fetchApi(action, extra = {}, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 15000);
  try {
    const response = await fetch(API, {
      method: "POST",
      headers: Core.authHeaders(options.public ? null : session),
      body: JSON.stringify({ action, ...extra }),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* handled as a safe generic error */ }
    if (!response.ok || data?.error) {
      const safe = safeApiMessage(data, response.status);
      throw new Core.ApiError(safe.message, response.status, safe.code);
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Core.ApiError("CaughtUp took too long to respond. Try again.", 0, "timeout");
    if (error instanceof Core.ApiError) throw error;
    throw new Core.ApiError("CaughtUp couldn't connect. Try again.", 0, "network");
  } finally {
    clearTimeout(timeout);
  }
}

async function api(action, extra = {}, options = {}) {
  if (!options.public && !options.noRefresh && Core.shouldRefreshSession(session)) {
    try {
      await refreshSession();
    } catch (error) {
      const expiry = Core.expiryToMs(session?.expires_at);
      if (expiry !== null && expiry <= Date.now()) {
        await expireSession();
        throw error;
      }
    }
  }
  try {
    return await fetchApi(action, extra, options);
  } catch (error) {
    if (error.status === 401 && session?.refresh_token && !options.noRefresh && action !== "auth_refresh") {
      try {
        await refreshSession();
        return await fetchApi(action, extra, { ...options, noRefresh: true });
      } catch { /* reconnect below */ }
    }
    if (error.status === 401 && !options.public) await expireSession();
    throw error;
  }
}

async function refreshSession() {
  const refreshed = await fetchApi("auth_refresh", { refresh_token: session?.refresh_token }, { public: true, noRefresh: true });
  if (!refreshed.access_token || !refreshed.refresh_token) {
    throw new Core.ApiError("Your session could not be refreshed.", 401, "invalid_session");
  }
  session = {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token,
    expires_at: refreshed.expires_at || (refreshed.expires_in ? Math.floor(Date.now() / 1000) + Number(refreshed.expires_in) : null),
    token_type: refreshed.token_type || "bearer",
  };
  await chrome.storage.local.set({ caughtup_session: session });
}

async function expireSession() {
  session = null;
  await Promise.all([
    chrome.storage.local.remove("caughtup_session"),
    chrome.storage.sync.remove("token"),
  ]);
  showSetup(true, "Your session expired. Sign in again.", "app");
}

async function getManualSendKey(draftId) {
  const result = Core.ensureManualSendKey(
    manualSendKeys,
    draftId,
    () => globalThis.crypto?.randomUUID?.() || `fallback-${Date.now()}`,
  );
  manualSendKeys = result.keys;
  if (result.created) {
    try { await chrome.storage.local.set({ [MANUAL_SEND_KEYS_STORAGE]: manualSendKeys }); } catch { /* stable for this popup session */ }
  }
  return result.key;
}

async function forgetManualSendKey(draftId) {
  if (!(draftId in manualSendKeys)) return;
  const next = { ...manualSendKeys };
  delete next[draftId];
  manualSendKeys = next;
  try { await chrome.storage.local.set({ [MANUAL_SEND_KEYS_STORAGE]: manualSendKeys }); } catch { /* server remains authoritative */ }
}

async function getManualSweepRequestId() {
  const result = Core.ensureSweepRequestId(
    manualSweepRequestId,
    () => globalThis.crypto?.randomUUID?.() || `fallback-${Date.now()}`,
  );
  manualSweepRequestId = result.requestId;
  if (result.created) {
    try { await chrome.storage.local.set({ [MANUAL_SWEEP_ID_STORAGE]: manualSweepRequestId }); } catch { /* stable for this popup session */ }
  }
  return manualSweepRequestId;
}

async function forgetManualSweepRequestId() {
  manualSweepRequestId = null;
  try { await chrome.storage.local.remove(MANUAL_SWEEP_ID_STORAGE); } catch { /* server remains authoritative */ }
}

function showSetup(show, message = "", mode = "app") {
  $("setup").classList.toggle("hidden", !show);
  $("tabs").classList.toggle("hidden", show);
  $("sweepBtn").classList.toggle("hidden", show);
  PANELS.forEach((panel) => $(panel).classList.add("hidden"));
  if (!show) activateTab("today", false);
  if (show && mode === "gmail") {
    $("setupTitle").textContent = "Connect your Gmail inbox";
    $("setupCopy").textContent = `Signed in${appEmail ? ` as ${appEmail}` : ""}. Connect the Gmail inbox you want CaughtUp to manage. Scheduled work starts only after Gmail is connected.`;
    $("connectGoogle").textContent = "Connect Gmail";
    $("connectGoogle").dataset.label = "Connect Gmail";
  } else if (show) {
    $("setupTitle").textContent = "Your inbox, handled";
    $("setupCopy").textContent = "Sign in with Google, then connect Gmail so CaughtUp can prepare replies. Nothing sends automatically unless you turn it on later.";
    $("connectGoogle").textContent = "Continue with Google";
    $("connectGoogle").dataset.label = "Continue with Google";
  }
  setStatus("setupStatus", message, message ? "error" : "");
}

function applyIdentity(result = {}) {
  appEmail = result.email || appEmail;
  gmailAddress = result.gmail_address || result.profile?.gmail_address || gmailAddress;
}

function connectedIdentityLabel() {
  if (gmailAddress && appEmail && gmailAddress.toLowerCase() !== appEmail.toLowerCase()) {
    return `Gmail: ${gmailAddress} · Signed in: ${appEmail}`;
  }
  if (gmailAddress) return `Connected Gmail: ${gmailAddress}`;
  if (appEmail) return `Signed in: ${appEmail}`;
  return "Your agent preferences";
}

function activateTab(name, focus = true) {
  if (!PANELS.includes(name)) return;
  document.querySelectorAll("[role=tab]").forEach((tab) => {
    const selected = tab.dataset.tab === name;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  });
  PANELS.forEach((panel) => $(panel).classList.toggle("hidden", panel !== name));
  if (name === "kits" && !kitsLoaded) loadKits();
  if (name === "calendar" && !calendarLoaded) loadCalendar();
  if (name === "settings" && !settingsLoaded) loadProfile();
}

document.querySelectorAll("[role=tab]").forEach((tab, index, tabs) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab, false));
  tab.addEventListener("keydown", (event) => {
    let next = null;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    activateTab(tabs[next].dataset.tab);
  });
});

async function launchAuthFlow(url) {
  if (!chrome.identity?.launchWebAuthFlow) throw new Core.ApiError("Reload CaughtUp as an unpacked Chrome extension to connect.", 0, "identity_unavailable");
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectUrl) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError || !redirectUrl) {
        reject(new Core.ApiError("Google connection was canceled or could not finish.", 0, "oauth_canceled"));
        return;
      }
      resolve(redirectUrl);
    });
  });
}

$("connectGoogle").addEventListener("click", async () => {
  const button = $("connectGoogle");
  setBusy(button, true, "Opening Google…");
  setStatus("setupStatus", "");
  try {
    const redirectUrl = chrome.identity.getRedirectURL("caughtup");
    if (!session) {
      const authorize = new URL(SUPABASE_AUTH);
      authorize.searchParams.set("provider", "google");
      authorize.searchParams.set("redirect_to", redirectUrl);
      const callbackUrl = new URL(await launchAuthFlow(authorize.toString()));
      const auth = new URLSearchParams(callbackUrl.hash.replace(/^#/, ""));
      if (callbackUrl.searchParams.get("error") || auth.get("error")) {
        throw new Core.ApiError("Google connection did not finish. Try again.", 0, "oauth_error");
      }
      const accessToken = auth.get("access_token");
      if (!accessToken) throw new Core.ApiError("Google connection did not create a session.", 0, "missing_session");
      session = {
        access_token: accessToken,
        refresh_token: auth.get("refresh_token") || null,
        expires_at: auth.get("expires_at") || null,
      };
      await chrome.storage.local.set({ caughtup_session: session });
    }
    let profile = await api("profile_get");
    applyIdentity(profile);
    if (profile.gmail_connected !== true) {
      setBusy(button, true, "Connecting Gmail…");
      const gmailStart = await api("gmail_connect_start", { redirect_url: redirectUrl });
      if (!gmailStart.authorization_url) throw new Core.ApiError("Gmail connection is not available yet.", 0, "missing_gmail_url");
      const gmailCallback = new URL(await launchAuthFlow(gmailStart.authorization_url));
      const gmailResult = gmailCallback.searchParams.get("caughtup_gmail");
      if (gmailCallback.searchParams.get("error") || gmailResult !== "connected") {
        throw new Core.ApiError("Gmail connection did not finish. Try again.", 0, "gmail_oauth_error");
      }
      profile = await api("profile_get");
      if (profile.gmail_connected !== true) throw new Core.ApiError("Gmail connection is still being confirmed. Try again.", 0, "gmail_not_connected");
      applyIdentity(profile);
    }
    showSetup(false);
    await loadDigest();
  } catch (error) {
    setStatus("setupStatus", Core.safeErrorMessage(error), "error");
  } finally {
    setBusy(button, false);
  }
});

$("signOut").addEventListener("click", async () => {
  session = null;
  currentProfile = null;
  manualSendKeys = {};
  manualSweepRequestId = null;
  pendingBookingRequest = null;
  kitsLoaded = false;
  calendarLoaded = false;
  settingsLoaded = false;
  appEmail = "";
  gmailAddress = "";
  await Promise.all([
    chrome.storage.local.remove("caughtup_session"),
    chrome.storage.local.remove(MANUAL_SEND_KEYS_STORAGE),
    chrome.storage.local.remove(MANUAL_SWEEP_ID_STORAGE),
    chrome.storage.local.remove(BOOKING_REQUEST_STORAGE),
    chrome.storage.sync.remove("token"),
  ]);
  showSetup(true, "", "app");
});

function stateCard(id, message, kind = "", retry) {
  const container = $(id);
  container.replaceChildren(create("span", "", message));
  container.className = `state-card${kind ? ` ${kind}` : ""}`;
  container.classList.remove("hidden");
  if (retry) {
    const button = create("button", "ghost retry", "Try again");
    button.type = "button";
    button.addEventListener("click", retry);
    container.appendChild(button);
  }
}

function updateModeBadge(mode) {
  const isAuto = mode === "auto_send";
  $("modeBadge").textContent = isAuto ? "Auto-send on" : "Review mode";
  $("modeBadge").classList.toggle("auto", isAuto);
}

function formatLastRun(lastRun) {
  if (!lastRun?.finished_at) return "No completed sweep yet";
  const date = new Date(lastRun.finished_at);
  if (Number.isNaN(date.getTime())) return "Last sweep time unavailable";
  return `Last sweep ${date.toLocaleString()}`;
}

async function loadDigest() {
  stateCard("todayStatus", "Loading your inbox…");
  $("digest").classList.add("hidden");
  try {
    const [result, profileResult] = await Promise.all([
      api("digest"),
      currentProfile ? Promise.resolve(null) : api("profile_get"),
    ]);
    if (profileResult?.profile) {
      currentProfile = Core.normalizeProfile({
        ...profileResult.profile,
        learning: profileResult.learning || profileResult.profile.learning,
      });
    }
    $("lastRun").textContent = formatLastRun(result.last_run);
    updateModeBadge(result.reply_mode || currentProfile?.reply_mode || "draft_only");
    renderDigest(result.emails || []);
  } catch (error) {
    stateCard("todayStatus", Core.safeErrorMessage(error), "error", loadDigest);
  }
}

function renderDigest(emails) {
  const digest = $("digest");
  digest.replaceChildren();
  const byCategory = {};
  emails.forEach((email) => {
    if (!Core.CATEGORIES.includes(email.category)) return;
    (byCategory[email.category] ||= []).push(email);
  });

  let rendered = false;
  Core.CATEGORIES.forEach((category) => {
    const items = byCategory[category] || [];
    if (!items.length) return;
    const group = create("section", `cat ${category}`);
    group.setAttribute("aria-labelledby", `cat-${category}`);
    const heading = create("h2", "cat-heading", `${Core.CATEGORY_LABELS[category]} — ${items.length}`);
    heading.id = `cat-${category}`;
    group.appendChild(heading);
    if (category === "low_priority" || category === "spam_or_poor_fit") {
      heading.textContent += " handled";
    } else {
      items.forEach((email) => group.appendChild(renderEmailCard(email)));
    }
    digest.appendChild(group);
    rendered = true;
  });

  $("todayStatus").classList.toggle("hidden", rendered);
  if (!rendered) stateCard("todayStatus", "All caught up. Nothing needs you right now.");
  digest.classList.toggle("hidden", !rendered);
}

function renderEmailCard(email) {
  const card = create("article", "card");
  const sender = create("div", "card-sender", email.sender || "Unknown sender");
  const subject = create("div", "card-subject", email.subject || "(No subject)");
  const summary = create("div", "card-summary", email.summary || "No summary available.");
  const footer = create("div", "cardfoot");
  const status = create("div", "card-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const delivery = Core.deliveryState(email);
  if (delivery === "sent") forgetManualSendKey(email.id);
  if (delivery !== "none") footer.appendChild(create("span", `badge ${delivery}`, delivery === "sent" ? "Reply sent" : delivery === "failed" ? "Send failed" : "Draft ready"));
  if (delivery === "draft" && email.gmail_draft_id) {
    const button = create("button", "sendbtn", "Review & send");
    button.type = "button";
    button.addEventListener("click", () => openDraftPreview(email, card, button));
    footer.appendChild(button);
  }
  if (email.media_kit_label) footer.appendChild(create("span", "tag", `Kit: ${email.media_kit_label}`));
  footer.appendChild(status);
  card.append(sender, subject, summary, footer);
  return card;
}

async function openDraftPreview(email, card, button) {
  setBusy(button, true, "Loading draft…");
  const status = card.querySelector(".card-status");
  status.textContent = "";
  status.classList.remove("error");
  try {
    const result = await api("draft_get", { id: email.id });
    const draft = result.draft || result;
    const body = draft.draft_text || draft.body;
    const hasFullEnvelope = Array.isArray(draft.to) && Array.isArray(draft.cc) &&
      Array.isArray(draft.bcc) && Array.isArray(draft.attachments) &&
      typeof draft.subject === "string" && typeof body === "string";
    if (!hasFullEnvelope || !draft.to.length || !body.trim()) {
      throw new Core.ApiError("A complete Gmail preview isn't available yet. Try again.", 0, "preview_incomplete");
    }
    if (!draft.preview_version) throw new Core.ApiError("A verified Gmail preview isn't available yet. Try again.", 0, "preview_version_missing");
    const existingSendKey = Core.findManualSendKey(manualSendKeys, email.id);
    pendingDraft = {
      id: email.id,
      to: draft.to.map(String),
      cc: draft.cc.map(String),
      bcc: draft.bcc.map(String),
      subject: draft.subject,
      body,
      attachments: draft.attachments,
      preview_version: draft.preview_version,
      idempotency_key: existingSendKey,
      uncertain: Boolean(existingSendKey),
    };
    pendingSendCard = card;
    $("previewRecipient").textContent = pendingDraft.to.join(", ");
    $("previewCc").textContent = pendingDraft.cc.length ? pendingDraft.cc.join(", ") : "None";
    $("previewBcc").textContent = pendingDraft.bcc.length ? pendingDraft.bcc.join(", ") : "None";
    $("previewSubject").textContent = pendingDraft.subject;
    $("previewBody").textContent = pendingDraft.body;
    const attachments = $("previewAttachments");
    attachments.replaceChildren();
    if (!pendingDraft.attachments.length) {
      attachments.appendChild(create("li", "", "None"));
    } else {
      pendingDraft.attachments.forEach((attachment) => {
        const name = String(attachment.name || attachment.filename || "Unnamed file");
        const size = Core.formatBytes(attachment.byte_size ?? attachment.size);
        const mime = String(attachment.mime_type || attachment.type || "");
        const details = [size, mime].filter(Boolean).join(", ");
        attachments.appendChild(create("li", "", details ? `${name} (${details})` : name));
      });
    }
    const hasPreviousAttempt = Boolean(pendingDraft.idempotency_key);
    $("confirmSend").dataset.label = hasPreviousAttempt ? "Check send status" : "Send reply";
    $("confirmSend").textContent = $("confirmSend").dataset.label;
    setStatus(
      "sendDialogStatus",
      hasPreviousAttempt ? "A previous send is not confirmed. Check its status using the same safe request." : "",
      hasPreviousAttempt ? "error" : "",
    );
    $("sendDialog").showModal();
  } catch (error) {
    status.textContent = Core.safeErrorMessage(error);
    status.classList.add("error");
  } finally {
    setBusy(button, false);
  }
}

$("confirmSend").addEventListener("click", async () => {
  if (!pendingDraft || !pendingSendCard) return;
  const button = $("confirmSend");
  try {
    if (!pendingDraft.idempotency_key) {
      setBusy(button, true, "Preparing…");
      pendingDraft.idempotency_key = await getManualSendKey(pendingDraft.id);
    }
    setBusy(button, true, pendingDraft.uncertain ? "Checking…" : "Sending…");
    setStatus("sendDialogStatus", pendingDraft.uncertain ? "Checking the existing send request…" : "Sending the existing Gmail draft…");
    const result = await api("send_draft", {
      id: pendingDraft.id,
      idempotency_key: pendingDraft.idempotency_key,
      preview_version: pendingDraft.preview_version,
    }, { timeout: 25000 });
    if (result.ok !== true) {
      throw new Core.ApiError("Send is not confirmed yet.", 409, result.code || "send_in_progress");
    }
    const footer = pendingSendCard.querySelector(".cardfoot");
    footer.querySelectorAll(".badge, .sendbtn").forEach((node) => node.remove());
    footer.prepend(create("span", "badge sent", "Reply sent"));
    footer.querySelector(".card-status").textContent = "Sent manually. CaughtUp can learn from edits after the next sweep.";
    await forgetManualSendKey(pendingDraft.id);
    $("sendDialog").close();
    pendingDraft = null;
    pendingSendCard = null;
  } catch (error) {
    if (error.code === "draft_changed") {
      const draftId = pendingDraft.id;
      await forgetManualSendKey(draftId);
      const cardStatus = pendingSendCard.querySelector(".card-status");
      cardStatus.textContent = "Draft changed in Gmail. Open Review & send to preview the latest version.";
      cardStatus.classList.add("error");
      pendingDraft = null;
      pendingSendCard = null;
      $("sendDialog").close();
      return;
    }
    pendingDraft.uncertain = true;
    button.dataset.label = "Check send status";
    setStatus("sendDialogStatus", `${Core.safeErrorMessage(error)} This send is not confirmed. Do not send it again elsewhere; check status here.`, "error");
  } finally {
    setBusy(button, false);
  }
});

$("cancelSend").addEventListener("click", () => {
  pendingDraft = null;
  pendingSendCard = null;
});

$("sweepBtn").addEventListener("click", async () => {
  const button = $("sweepBtn");
  setBusy(button, true, "Sweeping…");
  $("globalStatus").classList.add("hidden");
  try {
    const requestId = await getManualSweepRequestId();
    const result = await api("sweep", { request_id: requestId }, { timeout: 30000 });
    const alreadyInProgress = result?.code === "already_in_progress" || result?.already_in_progress === true ||
      (Array.isArray(result?.results) && result.results.some((item) => item?.reason === "already_in_progress" || item?.reason === "already claimed"));
    if (alreadyInProgress) throw new Core.ApiError("An inbox sweep is already in progress. Check its status here.", 409, "already_in_progress");
    await forgetManualSweepRequestId();
    button.dataset.label = "Sweep now";
    await loadDigest();
  } catch (error) {
    button.dataset.label = manualSweepRequestId ? "Check sweep status" : "Sweep now";
    $("globalStatus").textContent = error.code === "already_in_progress"
      ? "An inbox sweep is already in progress. Check its status here."
      : `${Core.safeErrorMessage(error)} Retry here to safely check the same sweep.`;
    $("globalStatus").classList.remove("hidden");
  } finally {
    setBusy(button, false);
  }
});

function addMessage(kind, text) {
  const message = create("div", `msg ${kind}`, text);
  $("messages").appendChild(message);
  $("messages").scrollTop = $("messages").scrollHeight;
  return message;
}

function showTyping() {
  const typing = create("div", "msg agent typing");
  typing.id = "typing";
  typing.setAttribute("aria-label", "CaughtUp is typing");
  for (let i = 0; i < 3; i += 1) typing.appendChild(create("i"));
  $("messages").appendChild(typing);
}

$("chatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = $("chatInput").value.trim();
  if (!text) return;
  const button = $("chatSend");
  $("chatInput").value = "";
  addMessage("user", text);
  showTyping();
  setBusy(button, true, "Sending…");
  setStatus("chatStatus", "");
  try {
    const result = await api("chat", { message: text }, { timeout: 30000 });
    $("typing")?.remove();
    addMessage("agent", result.reply || "I couldn't form a response.");
    if (result.rule_added) {
      addMessage("rule", `Rule saved: ${result.rule_added}`);
      settingsLoaded = false;
    }
    const reviewFallback = result.auto_send_disabled === true ||
      (result.reply_mode === "draft_only" && currentProfile?.reply_mode === "auto_send");
    if (reviewFallback) {
      if (currentProfile) currentProfile.reply_mode = "draft_only";
      updateModeBadge("draft_only");
      addMessage("rule", "Auto-send is off. Standing rules keep replies in Review.");
      settingsLoaded = false;
    }
  } catch (error) {
    $("typing")?.remove();
    setStatus("chatStatus", Core.safeErrorMessage(error), "error");
  } finally {
    setBusy(button, false);
    $("chatInput").focus();
  }
});

function applyCalendarReviewFallback(result) {
  if (result?.auto_send_disabled !== true && result?.reply_mode !== "draft_only") return "";
  if (currentProfile) currentProfile.reply_mode = "draft_only";
  updateModeBadge("draft_only");
  settingsLoaded = false;
  return " Replies are now in Review mode.";
}

function buildAvailabilityRows() {
  const container = $("availabilityRows");
  Core.WEEKDAYS.forEach((dayName, day) => {
    const row = create("div", "availability-row");
    const enabledLabel = create("label", "check-row");
    const enabled = create("input");
    enabled.type = "checkbox";
    enabled.id = `availability-${day}-enabled`;
    enabled.dataset.day = String(day);
    const name = create("span", "", dayName.slice(0, 3));
    enabledLabel.htmlFor = enabled.id;
    enabledLabel.append(enabled, name);
    const start = create("input");
    start.type = "time";
    start.id = `availability-${day}-start`;
    start.value = "09:00";
    start.setAttribute("aria-label", `${dayName} start time`);
    const end = create("input");
    end.type = "time";
    end.id = `availability-${day}-end`;
    end.value = "17:00";
    end.setAttribute("aria-label", `${dayName} end time`);
    enabled.addEventListener("change", () => {
      start.disabled = !enabled.checked || enabled.disabled;
      end.disabled = !enabled.checked || enabled.disabled;
      start.required = enabled.checked && !enabled.disabled;
      end.required = enabled.checked && !enabled.disabled;
    });
    row.append(enabledLabel, start, end);
    container.appendChild(row);
  });
}

function updateCalendarMode() {
  const mode = document.querySelector('input[name="contactMode"]:checked')?.value || "email_only";
  const phoneMode = mode === "phone";
  const scheduledMode = mode === "scheduled_call";
  $("phoneOptions").classList.toggle("hidden", !phoneMode);
  $("phoneOptions").setAttribute("aria-hidden", String(!phoneMode));
  $("calendarPhone").disabled = !phoneMode;
  $("calendarPhone").required = phoneMode;
  $("scheduledOptions").classList.toggle("hidden", !scheduledMode);
  $("scheduledOptions").setAttribute("aria-hidden", String(!scheduledMode));
  $("calendarBookingUrl").disabled = !scheduledMode;
  $("calendarTimezone").disabled = !scheduledMode;
  const availabilityFieldset = $("availabilityRows").closest("fieldset");
  availabilityFieldset.disabled = !scheduledMode;
  document.querySelectorAll("[data-day]").forEach((enabled) => {
    const day = enabled.dataset.day;
    $(`availability-${day}-start`).disabled = !scheduledMode || !enabled.checked;
    $(`availability-${day}-end`).disabled = !scheduledMode || !enabled.checked;
    $(`availability-${day}-start`).required = scheduledMode && enabled.checked;
    $(`availability-${day}-end`).required = scheduledMode && enabled.checked;
  });
  const canCreateBooking = scheduledMode && currentCalendar?.contact_mode === "scheduled_call";
  $("bookingForm").classList.toggle("hidden", !canCreateBooking);
  $("bookingForm").querySelectorAll("input, select, button").forEach((control) => { control.disabled = !canCreateBooking; });
  $("bookingCreateNote").classList.toggle("hidden", canCreateBooking);
}

document.querySelectorAll('input[name="contactMode"]').forEach((input) => input.addEventListener("change", updateCalendarMode));

function fillCalendar(raw, bookings = currentBookings) {
  currentCalendar = Core.normalizeCalendar(raw);
  if (new Set(currentCalendar.weekly_availability.map((item) => item.day)).size !== currentCalendar.weekly_availability.length) {
    throw new Core.ApiError("Calendar data has more than one window for a day. Reload after the server normalizes it.", 422, "invalid_calendar");
  }
  currentBookings = Array.isArray(bookings) ? bookings : [];
  const modeInput = document.querySelector(`input[name="contactMode"][value="${currentCalendar.contact_mode}"]`);
  if (modeInput) modeInput.checked = true;
  $("calendarPhone").value = currentCalendar.phone_number;
  $("calendarBookingUrl").value = currentCalendar.booking_url;
  $("calendarTimezone").value = currentCalendar.timezone;
  Core.WEEKDAYS.forEach((_, day) => {
    const window = currentCalendar.weekly_availability.find((item) => item.day === day);
    const enabled = $(`availability-${day}-enabled`);
    enabled.checked = Boolean(window);
    $(`availability-${day}-start`).value = window?.start || "09:00";
    $(`availability-${day}-end`).value = window?.end || "17:00";
  });
  updateCalendarMode();
  renderBookings(currentBookings);
}

async function loadCalendar() {
  stateCard("calendarStatus", "Loading contact preferences...");
  $("calendarForm").classList.add("hidden");
  try {
    const result = await api("calendar_get");
    fillCalendar(result.calendar || {}, result.bookings || []);
    $("calendarStatus").classList.add("hidden");
    $("calendarForm").classList.remove("hidden");
    calendarLoaded = true;
  } catch (error) {
    stateCard("calendarStatus", Core.safeErrorMessage(error), "error", loadCalendar);
  }
}

function collectCalendarFields() {
  const mode = document.querySelector('input[name="contactMode"]:checked')?.value || "email_only";
  const availability = [];
  if (mode === "scheduled_call") {
    document.querySelectorAll("[data-day]").forEach((enabled) => {
      if (!enabled.checked) return;
      const day = Number(enabled.dataset.day);
      availability.push({ day, start: $(`availability-${day}-start`).value, end: $(`availability-${day}-end`).value });
    });
  }
  const fields = {
    contact_mode: mode,
    phone_number: mode === "phone" ? $("calendarPhone").value.trim() : null,
    booking_url: mode === "scheduled_call" ? $("calendarBookingUrl").value.trim() || null : null,
    timezone: $("calendarTimezone").value.trim() || currentCalendar?.timezone || "UTC",
    weekly_availability: availability,
  };
  const validation = Core.validateCalendarSettings(fields);
  if (!validation.ok) throw new Core.ApiError(validation.message, 400, "invalid_calendar");
  return fields;
}

$("calendarForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentCalendar) return;
  const button = $("saveCalendar");
  let fields;
  try {
    fields = collectCalendarFields();
  } catch (error) {
    setStatus("calendarSaveStatus", Core.safeErrorMessage(error), "error");
    return;
  }
  setBusy(button, true, "Saving...");
  setStatus("calendarSaveStatus", "");
  try {
    const result = await api("calendar_set", { fields, expected_settings_version: currentCalendar.settings_version });
    fillCalendar(result.calendar || fields);
    const reviewNote = applyCalendarReviewFallback(result);
    setStatus("calendarSaveStatus", `Contact preferences saved.${reviewNote}`, "success");
  } catch (error) {
    setStatus("calendarSaveStatus", Core.safeErrorMessage(error), "error");
    if (error.code === "version_conflict") {
      calendarLoaded = false;
      await loadCalendar();
      setStatus("calendarSaveStatus", "Preferences changed elsewhere. Review the latest values before saving again.", "error");
    }
  } finally {
    setBusy(button, false);
  }
});

function renderBookings(bookings) {
  const list = $("bookingList");
  list.replaceChildren();
  if (!bookings.length) {
    stateCard("bookingsStatus", "No internal bookings yet.");
    list.classList.add("hidden");
    return;
  }
  $("bookingsStatus").classList.add("hidden");
  bookings.forEach((booking) => {
    const card = create("article", "booking-card");
    const head = create("div", "booking-head");
    const identity = create("div");
    identity.append(
      create("div", "booking-title", booking.title || "Untitled booking"),
      create("div", "booking-time", Core.formatBookingRange(booking, currentCalendar.timezone)),
    );
    const status = create("span", `badge ${booking.status === "booked" ? "sent" : "draft"}`, booking.status === "booked" ? "Booked" : "Held");
    head.append(identity, status);
    const remove = create("button", "ghost danger", "Delete");
    remove.type = "button";
    remove.addEventListener("click", () => deleteBooking(booking, remove));
    card.append(head, remove);
    list.appendChild(card);
  });
  list.classList.remove("hidden");
}

async function clearPendingBookingRequest() {
  pendingBookingRequest = null;
  try { await chrome.storage.local.remove(BOOKING_REQUEST_STORAGE); } catch { /* server remains authoritative */ }
}

$("bookingForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("createBooking");
  const title = $("bookingTitle").value.trim();
  const startAt = Core.zonedLocalToIso($("bookingStart").value, currentCalendar?.timezone);
  const endAt = Core.zonedLocalToIso($("bookingEnd").value, currentCalendar?.timezone);
  if (!title || !startAt || !endAt || startAt >= endAt) {
    setStatus("bookingFormStatus", "Enter a title and a valid start time before the end time.", "error");
    return;
  }
  const kind = $("bookingKind").value;
  const fingerprint = JSON.stringify({ title, start_at: startAt, end_at: endAt, kind });
  const validPendingRequest = pendingBookingRequest?.fingerprint === fingerprint &&
    /^booking-[a-zA-Z0-9-]{8,200}$/.test(String(pendingBookingRequest?.request_id || ""));
  if (!validPendingRequest) {
    pendingBookingRequest = { fingerprint, request_id: `booking-${globalThis.crypto?.randomUUID?.() || Date.now()}` };
    try { await chrome.storage.local.set({ [BOOKING_REQUEST_STORAGE]: pendingBookingRequest }); } catch { /* stable for this popup session */ }
  }
  setBusy(button, true, "Adding...");
  setStatus("bookingFormStatus", "");
  try {
    const result = await api("booking_create", { title, start_at: startAt, end_at: endAt, kind, request_id: pendingBookingRequest.request_id });
    await clearPendingBookingRequest();
    $("bookingForm").reset();
    applyCalendarReviewFallback(result);
    await loadCalendar();
    setStatus("bookingFormStatus", result.already_exists ? "Booking already existed; no duplicate was created." : "Internal booking added. Replies are in Review mode.", "success");
  } catch (error) {
    if (["booking_conflict", "outside_availability", "invalid"].includes(error.code)) await clearPendingBookingRequest();
    setStatus("bookingFormStatus", `${Core.safeErrorMessage(error)}${pendingBookingRequest ? " Retry here to safely check the same request." : ""}`, "error");
  } finally {
    setBusy(button, false);
  }
});

async function deleteBooking(booking, button) {
  if (!confirm(`Delete the internal booking "${booking.title || "Untitled booking"}"?`)) return;
  setBusy(button, true, "Deleting...");
  try {
    const result = await api("booking_delete", { id: booking.id });
    applyCalendarReviewFallback(result);
    await loadCalendar();
    setStatus("bookingActionStatus", "Internal booking deleted. Replies are in Review mode.", "success");
  } catch (error) {
    setStatus("bookingActionStatus", Core.safeErrorMessage(error), "error");
    setBusy(button, false);
  }
}

function showKitForm(show) {
  $("kitForm").classList.toggle("hidden", !show);
  $("showKitForm").setAttribute("aria-expanded", String(show));
  if (show) $("kitFile").focus();
  else {
    $("kitForm").reset();
    $("kitProgress").classList.add("hidden");
    setStatus("kitFormStatus", "");
  }
}

$("showKitForm").addEventListener("click", () => showKitForm($("kitForm").classList.contains("hidden")));
$("cancelKit").addEventListener("click", () => showKitForm(false));

async function loadKits() {
  stateCard("kitsStatus", "Loading kits…");
  $("kitList").classList.add("hidden");
  try {
    const result = await api("media_kit_list");
    renderKits(result.kits || []);
    kitsLoaded = true;
  } catch (error) {
    stateCard("kitsStatus", Core.safeErrorMessage(error), "error", loadKits);
  }
}

function renderKits(kits) {
  const list = $("kitList");
  list.replaceChildren();
  if (!kits.length) {
    stateCard("kitsStatus", "Add a kit and CaughtUp can attach it when a brand asks for work samples.");
    list.classList.add("hidden");
    return;
  }
  $("kitsStatus").classList.add("hidden");
  kits.forEach((kit) => list.appendChild(renderKitCard(kit)));
  list.classList.remove("hidden");
}

function renderKitCard(kit) {
  const card = create("article", "kit-card");
  const head = create("div", "kit-head");
  const identity = create("div");
  identity.append(
    create("div", "kit-label", kit.label || "Untitled kit"),
    create("div", "kit-file", `${kit.original_filename || "File"}${kit.byte_size ? ` · ${Core.formatBytes(kit.byte_size)}` : ""}`),
  );
  head.appendChild(identity);
  if (kit.is_default) head.appendChild(create("span", "badge draft", "Fallback"));
  card.appendChild(head);
  if (kit.description) card.appendChild(create("p", "kit-description", kit.description));
  const tags = create("div", "kit-tags");
  (kit.brand_names || []).forEach((brand) => tags.appendChild(create("span", "tag", `Brand: ${brand}`)));
  (kit.sender_domains || []).forEach((domain) => tags.appendChild(create("span", "tag", domain)));
  (kit.keywords || []).forEach((keyword) => tags.appendChild(create("span", "tag", `Keyword: ${keyword}`)));
  if (kit.allow_auto_send) tags.appendChild(create("span", "tag", "Auto-attach allowed"));
  if (tags.childElementCount) card.appendChild(tags);
  const actions = create("div", "kit-actions");
  const editButton = create("button", "ghost", "Edit matching");
  editButton.type = "button";
  editButton.addEventListener("click", () => openKitEdit(kit));
  actions.appendChild(editButton);
  if (!kit.is_default) {
    const defaultButton = create("button", "ghost", "Make fallback");
    defaultButton.type = "button";
    defaultButton.addEventListener("click", () => updateKit(kit.id, { is_default: true }, defaultButton));
    actions.appendChild(defaultButton);
  }
  const autoAttachButton = create("button", "ghost", kit.allow_auto_send ? "Disable auto-attach" : "Allow auto-attach");
  autoAttachButton.type = "button";
  autoAttachButton.addEventListener("click", () => {
    if (!kit.allow_auto_send && !confirm(`Allow “${kit.label || "this kit"}” to be attached to otherwise eligible Auto-send replies?`)) return;
    updateKit(kit.id, { allow_auto_send: !kit.allow_auto_send }, autoAttachButton);
  });
  actions.appendChild(autoAttachButton);
  const removeButton = create("button", "ghost danger", "Delete");
  removeButton.type = "button";
  removeButton.addEventListener("click", () => deleteKit(kit, removeButton));
  actions.appendChild(removeButton);
  card.appendChild(actions);
  const status = create("p", "status-text");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  card.appendChild(status);
  return card;
}

function openKitEdit(kit) {
  pendingKitEdit = kit;
  $("editKitLabel").value = kit.label || "";
  $("editKitDescription").value = kit.description || kit.best_for || "";
  $("editKitBrands").value = (kit.brand_names || []).join(", ");
  $("editKitDomains").value = (kit.sender_domains || []).join(", ");
  $("editKitKeywords").value = (kit.keywords || []).join(", ");
  setStatus("kitEditStatus", "");
  $("kitEditDialog").showModal();
  $("editKitLabel").focus();
}

$("cancelKitEdit").addEventListener("click", () => {
  pendingKitEdit = null;
  $("kitEditDialog").close();
});

$("kitEditForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingKitEdit) return;
  const button = $("saveKitEdit");
  const label = $("editKitLabel").value.trim();
  if (!label) {
    setStatus("kitEditStatus", "Add a label for this kit.", "error");
    return;
  }
  setBusy(button, true, "Saving…");
  try {
    await api("media_kit_update", {
      id: pendingKitEdit.id,
      fields: {
        label,
        description: $("editKitDescription").value.trim(),
        brand_names: Core.normalizeTags($("editKitBrands").value),
        sender_domains: Core.normalizeDomains($("editKitDomains").value),
        keywords: Core.normalizeTags($("editKitKeywords").value, 30),
      },
    });
    pendingKitEdit = null;
    $("kitEditDialog").close();
    await loadKits();
  } catch (error) {
    setStatus("kitEditStatus", Core.safeErrorMessage(error), "error");
  } finally {
    setBusy(button, false);
  }
});

async function updateKit(id, fields, button) {
  setBusy(button, true, "Saving…");
  try {
    await api("media_kit_update", { id, fields });
    await loadKits();
  } catch (error) {
    const status = button.closest(".kit-card").querySelector(".status-text");
    status.textContent = Core.safeErrorMessage(error);
    status.classList.add("error");
  } finally {
    setBusy(button, false);
  }
}

async function deleteKit(kit, button) {
  if (!confirm(`Delete “${kit.label || "this kit"}”? The file will no longer be attached.`)) return;
  setBusy(button, true, "Deleting…");
  try {
    await api("media_kit_delete", { id: kit.id });
    await loadKits();
  } catch (error) {
    const status = button.closest(".kit-card").querySelector(".status-text");
    status.textContent = Core.safeErrorMessage(error);
    status.classList.add("error");
    setBusy(button, false);
  }
}

function uploadFile(url, file, headers = {}, method = "PUT") {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, String(value)));
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      $("kitProgress").value = Math.round((event.loaded / event.total) * 100);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Core.ApiError("The upload could not finish. Try again.", xhr.status, "upload_failed"));
    });
    xhr.addEventListener("error", () => reject(new Core.ApiError("The upload could not finish. Try again.", 0, "upload_failed")));
    xhr.send(file);
  });
}

$("kitForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = $("kitFile").files[0];
  const validation = Core.validateMediaFile(file);
  const label = $("kitLabel").value.trim();
  if (!validation.ok || !label) {
    setStatus("kitFormStatus", validation.ok ? "Add a label for this kit." : validation.message, "error");
    return;
  }
  const button = $("uploadKit");
  setBusy(button, true, "Preparing…");
  setStatus("kitFormStatus", "Preparing a private upload…");
  $("kitProgress").value = 0;
  $("kitProgress").classList.remove("hidden");
  try {
    const prepared = await api("media_kit_upload_prepare", {
      label,
      description: $("kitDescription").value.trim(),
      original_filename: file.name,
      mime_type: file.type,
      byte_size: file.size,
      brand_names: Core.normalizeTags($("kitBrands").value),
      sender_domains: Core.normalizeDomains($("kitDomains").value),
      keywords: Core.normalizeTags($("kitKeywords").value, 30),
      is_default: $("kitDefault").checked,
      allow_auto_send: $("kitAutoAttach").checked,
    });
    if (!prepared.upload_url || !prepared.kit_id) throw new Core.ApiError("The upload could not start. Try again.", 0, "upload_contract");
    setBusy(button, true, "Uploading…");
    await uploadFile(prepared.upload_url, file, prepared.upload_headers || {}, prepared.upload_method || "PUT");
    setBusy(button, true, "Finishing…");
    await api("media_kit_upload_complete", { id: prepared.kit_id });
    setStatus("kitFormStatus", "Kit uploaded.", "success");
    kitsLoaded = false;
    await loadKits();
    setTimeout(() => showKitForm(false), 650);
  } catch (error) {
    setStatus("kitFormStatus", Core.safeErrorMessage(error), "error");
  } finally {
    setBusy(button, false);
  }
});

function buildRequiredQuestionControls() {
  const container = $("requiredQuestions");
  Core.REQUIRED_QUESTIONS.forEach((question) => {
    const label = create("label", "check-row");
    const checkbox = create("input");
    checkbox.type = "checkbox";
    checkbox.name = "alwaysAsk";
    checkbox.value = question.value;
    label.append(checkbox, create("span", "", question.label));
    container.appendChild(label);
  });
}

function checkedValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

function fillProfile(raw) {
  currentProfile = Core.normalizeProfile(raw);
  PROFILE_FIELDS.forEach((field) => { $(`f_${field}`).value = currentProfile[field]; });
  $("modeReview").checked = currentProfile.reply_mode === "draft_only";
  $("modeAuto").checked = currentProfile.reply_mode === "auto_send";
  document.querySelectorAll("input[name=draftCategory]").forEach((input) => { input.checked = currentProfile.draft_categories.includes(input.value); });
  document.querySelectorAll("input[name=autoCategory]").forEach((input) => { input.checked = currentProfile.auto_send_categories.includes(input.value); });
  document.querySelectorAll("input[name=alwaysAsk]").forEach((input) => { input.checked = currentProfile.always_ask.includes(input.value); });
  $("f_digest_enabled").checked = currentProfile.digest_enabled;
  $("f_digest_local_time").value = currentProfile.digest_local_time;
  $("f_timezone").value = currentProfile.timezone;
  const examples = Number(currentProfile.learning.style_examples_count || 0);
  const rules = Number(currentProfile.learning.standing_rules_count || currentProfile.custom_rules.split("\n").filter(Boolean).length);
  $("learningSummary").textContent = `${examples} writing example${examples === 1 ? "" : "s"} and ${rules} standing rule${rules === 1 ? "" : "s"}.`;
  updateModeBadge(currentProfile.reply_mode);
}

async function loadProfile() {
  stateCard("settingsStatus", "Loading settings…");
  $("settingsForm").classList.add("hidden");
  try {
    const result = await api("profile_get");
    applyIdentity(result);
    fillProfile({
      ...(result.profile || {}),
      learning: result.learning || result.profile?.learning,
    });
    $("connectedEmail").textContent = connectedIdentityLabel();
    $("settingsStatus").classList.add("hidden");
    $("settingsForm").classList.remove("hidden");
    settingsLoaded = true;
  } catch (error) {
    stateCard("settingsStatus", Core.safeErrorMessage(error), "error", loadProfile);
  }
}

function collectProfileFields() {
  const fields = {};
  PROFILE_FIELDS.forEach((field) => { fields[field] = $(`f_${field}`).value.trim(); });
  fields.always_ask = checkedValues("alwaysAsk");
  fields.draft_categories = checkedValues("draftCategory");
  fields.auto_send_categories = checkedValues("autoCategory");
  fields.digest_enabled = $("f_digest_enabled").checked;
  fields.digest_local_time = $("f_digest_local_time").value;
  fields.timezone = $("f_timezone").value.trim();
  if (!Core.isValidTimezone(fields.timezone)) {
    throw new Core.ApiError("Enter a valid IANA time zone, such as America/Los_Angeles.", 400, "invalid_timezone");
  }
  return fields;
}

async function prepareAutoSend() {
  const result = await api("auto_send_prepare");
  autoSendChallenge = result.challenge;
  if (!autoSendChallenge) throw new Core.ApiError("Auto-send confirmation is not available.", 0, "missing_challenge");
  $("autoSendCopy").textContent = result.confirmation_text || "Eligible replies may be sent without review. CaughtUp will draft whenever required details are missing or a decision is uncertain.";
  const list = $("autoSendSafeguards");
  list.replaceChildren();
  (result.safeguards || ["Only selected categories", "Required questions fall back to drafts", "Safety rules cannot be overridden"]).forEach((item) => list.appendChild(create("li", "", item)));
  setStatus("autoSendStatus", "");
  $("autoSendDialog").showModal();
}

$("settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentProfile) return;
  const button = $("saveProfile");
  const desiredMode = document.querySelector("input[name=replyMode]:checked").value;
  let fields;
  try {
    fields = collectProfileFields();
  } catch (error) {
    setStatus("saveMsg", Core.safeErrorMessage(error), "error");
    return;
  }
  const policyChanged = currentProfile.reply_mode === "auto_send" && Core.autoSendPolicyChanged(currentProfile, fields);
  const standingRulesRequireReview = Boolean(fields.custom_rules.trim());
  setBusy(button, true, "Saving…");
  setStatus("saveMsg", "");
  try {
    if (currentProfile.reply_mode === "auto_send" && (desiredMode === "draft_only" || policyChanged || standingRulesRequireReview)) {
      const disabled = await api("auto_send_disable");
      currentProfile.reply_mode = "draft_only";
      if (disabled.profile) currentProfile = Core.normalizeProfile(disabled.profile);
      updateModeBadge("draft_only");
    }
    const result = await api("profile_set", {
      fields,
      expected_settings_version: currentProfile.settings_version,
    });
    fillProfile(result.profile || { ...currentProfile, ...fields });
    if (desiredMode === "auto_send" && standingRulesRequireReview) {
      currentProfile.reply_mode = "draft_only";
      $("modeReview").checked = true;
      updateModeBadge("draft_only");
      setStatus("saveMsg", "Settings saved. Standing rules keep replies in Review.", "success");
    } else if (desiredMode === "auto_send" && currentProfile.reply_mode !== "auto_send") await prepareAutoSend();
    else setStatus("saveMsg", "Settings saved.", "success");
  } catch (error) {
    fillProfile(currentProfile);
    setStatus("saveMsg", Core.safeErrorMessage(error), "error");
  } finally {
    setBusy(button, false);
  }
});

$("confirmAutoSend").addEventListener("click", async () => {
  const button = $("confirmAutoSend");
  setBusy(button, true, "Turning on…");
  try {
    const result = await api("auto_send_confirm", { challenge: autoSendChallenge, confirmed: true });
    currentProfile = Core.normalizeProfile(result.profile || { ...currentProfile, reply_mode: "auto_send" });
    fillProfile(currentProfile);
    $("autoSendDialog").close();
    setStatus("saveMsg", "Settings saved. Auto-send is on for eligible replies.", "success");
  } catch (error) {
    setStatus("autoSendStatus", Core.safeErrorMessage(error), "error");
    $("modeReview").checked = true;
  } finally {
    autoSendChallenge = null;
    setBusy(button, false);
  }
});

$("cancelAutoSend").addEventListener("click", () => {
  autoSendChallenge = null;
  $("modeReview").checked = true;
});

$("resetLearning").addEventListener("click", async () => {
  if (!confirm("Reset the writing style CaughtUp learned from your edits? Standing rules will stay.")) return;
  const button = $("resetLearning");
  setBusy(button, true, "Resetting…");
  setStatus("learningStatus", "");
  try {
    const result = await api("learning_reset", { kind: "style_examples" });
    if (result.profile) fillProfile(result.profile);
    else {
      currentProfile.learning.style_examples_count = 0;
      fillProfile(currentProfile);
    }
    setStatus("learningStatus", "Learned writing style reset.", "success");
  } catch (error) {
    setStatus("learningStatus", Core.safeErrorMessage(error), "error");
  } finally {
    setBusy(button, false);
  }
});

function setupDialogSafety(dialog, cancelButtonId) {
  dialog.addEventListener("cancel", () => $(cancelButtonId).click());
  dialog.addEventListener("close", () => {
    if (dialog.id === "sendDialog" && dialog.returnValue === "cancel") {
      pendingDraft = null;
      pendingSendCard = null;
    }
    if (dialog.id === "autoSendDialog" && dialog.returnValue === "cancel") {
      autoSendChallenge = null;
      $("modeReview").checked = true;
    }
  });
}

setupDialogSafety($("sendDialog"), "cancelSend");
setupDialogSafety($("autoSendDialog"), "cancelAutoSend");
buildRequiredQuestionControls();
buildAvailabilityRows();

(async function init() {
  try {
    if (!chrome.storage?.local || !chrome.storage?.sync) {
      showSetup(true);
      return;
    }
    const local = await chrome.storage.local.get(["caughtup_session", MANUAL_SEND_KEYS_STORAGE, MANUAL_SWEEP_ID_STORAGE, BOOKING_REQUEST_STORAGE]);
    session = local.caughtup_session || null;
    manualSendKeys = local[MANUAL_SEND_KEYS_STORAGE] && typeof local[MANUAL_SEND_KEYS_STORAGE] === "object"
      ? local[MANUAL_SEND_KEYS_STORAGE]
      : {};
    const sweepState = Core.ensureSweepRequestId(local[MANUAL_SWEEP_ID_STORAGE], () => "invalid-placeholder");
    manualSweepRequestId = sweepState.created ? null : sweepState.requestId;
    if (manualSweepRequestId) {
      $("sweepBtn").dataset.label = "Check sweep status";
      $("sweepBtn").textContent = "Check sweep status";
    }
    pendingBookingRequest = local[BOOKING_REQUEST_STORAGE] && typeof local[BOOKING_REQUEST_STORAGE] === "object"
      ? local[BOOKING_REQUEST_STORAGE]
      : null;
    if (!session) {
      showSetup(true);
      return;
    }
    const profileResult = await api("profile_get");
    applyIdentity(profileResult);
    currentProfile = Core.normalizeProfile({
      ...(profileResult.profile || {}),
      learning: profileResult.learning || profileResult.profile?.learning,
    });
    if (profileResult.gmail_connected !== true && profileResult.profile?.gmail_connected !== true) {
      showSetup(true, "", "gmail");
      return;
    }
    showSetup(false);
    await loadDigest();
  } catch (error) {
    showSetup(true, Core.safeErrorMessage(error));
  }
})();
