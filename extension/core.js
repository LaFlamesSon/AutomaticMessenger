(function attachCaughtUpCore(root, factory) {
  const core = factory();
  if (typeof module === "object" && module.exports) module.exports = core;
  else root.CaughtUpCore = core;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildCore() {
  "use strict";

  const CATEGORIES = ["urgent", "action_needed", "fyi", "low_priority", "spam_or_poor_fit"];
  const CATEGORY_LABELS = {
    urgent: "Urgent",
    action_needed: "Action needed",
    fyi: "FYI",
    low_priority: "Low priority",
    spam_or_poor_fit: "Filtered out",
  };
  const REQUIRED_QUESTIONS = [
    { value: "project scope", label: "Project scope" },
    { value: "budget range", label: "Budget" },
    { value: "timeline", label: "Timeline" },
    { value: "what brand materials they already have", label: "Brand materials" },
  ];
  const MEDIA_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  const MAX_MEDIA_BYTES = 8_000_000;

  class ApiError extends Error {
    constructor(message, status = 0, code = "request_failed") {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
    }
  }

  function normalizeProfile(raw = {}) {
    const replyMode = raw.reply_mode || (raw.auto_send === true ? "auto_send" : "draft_only");
    return {
      display_name: String(raw.display_name || ""),
      occupation: String(raw.occupation || ""),
      services: String(raw.services || ""),
      tone: String(raw.tone || ""),
      signoff: String(raw.signoff || ""),
      custom_rules: String(raw.custom_rules || ""),
      always_ask: Array.isArray(raw.always_ask) ? raw.always_ask : REQUIRED_QUESTIONS.map((item) => item.value),
      draft_categories: Array.isArray(raw.draft_categories) ? raw.draft_categories : ["urgent", "action_needed"],
      auto_send_categories: Array.isArray(raw.auto_send_categories) ? raw.auto_send_categories : [],
      reply_mode: replyMode === "auto_send" ? "auto_send" : "draft_only",
      digest_enabled: raw.digest_enabled !== false,
      digest_local_time: String(raw.digest_local_time || "08:00").slice(0, 5),
      timezone: String(raw.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
      settings_version: Number.isFinite(Number(raw.settings_version)) ? Number(raw.settings_version) : null,
      learning: raw.learning && typeof raw.learning === "object" ? raw.learning : {},
    };
  }

  function deliveryState(email = {}) {
    if (email.delivery_status === "sent" || email.auto_sent === true) return "sent";
    if (email.delivery_status === "failed") return "failed";
    if (email.delivery_status === "draft" || email.draft_created === true) return "draft";
    return "none";
  }

  function validateMediaFile(file) {
    if (!file) return { ok: false, message: "Choose a PDF or image." };
    if (!MEDIA_TYPES.includes(file.type)) {
      return { ok: false, message: "Use a PDF, JPG, PNG, or WebP file." };
    }
    if (!Number.isFinite(file.size) || file.size <= 0) {
      return { ok: false, message: "The selected file is empty." };
    }
    if (file.size > MAX_MEDIA_BYTES) {
      return { ok: false, message: "Keep each kit under 8 MB." };
    }
    return { ok: true, message: "" };
  }

  function normalizeDomains(value) {
    return [...new Set(String(value || "")
      .split(/[\s,]+/)
      .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
      .filter((domain) => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)))];
  }

  function normalizeTags(value, maxItems = 20) {
    const seen = new Set();
    const result = [];
    for (const raw of String(value || "").split(",")) {
      const tag = raw.trim().replace(/\s+/g, " ").slice(0, 100);
      const key = tag.toLowerCase();
      if (!tag || seen.has(key)) continue;
      seen.add(key);
      result.push(tag);
      if (result.length >= maxItems) break;
    }
    return result;
  }

  function isValidTimezone(value) {
    const timezone = String(value || "").trim();
    if (!timezone || timezone.length > 80) return false;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
      return true;
    } catch {
      return false;
    }
  }

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return "";
    if (bytes < 1000) return `${bytes} B`;
    if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
  }

  function safeErrorMessage(error) {
    if (error?.code === "unauthorized" || error?.status === 401) return "Your session expired. Connect again.";
    if (error?.code === "timeout") return "CaughtUp took too long to respond. Try again.";
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "You're offline. Reconnect and try again.";
    if (error instanceof ApiError && error.message) return error.message;
    return "CaughtUp couldn't complete that. Try again.";
  }

  function authHeaders(session) {
    const headers = { "Content-Type": "application/json" };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    return headers;
  }

  function expiryToMs(value) {
    if (value === null || value === undefined || value === "") return null;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) ? null : parsed;
  }

  function shouldRefreshSession(session, now = Date.now(), leewayMs = 60_000) {
    if (!session?.refresh_token) return false;
    const expiry = expiryToMs(session.expires_at);
    return expiry !== null && expiry <= now + leewayMs;
  }

  function sameStringSet(left, right) {
    const a = [...new Set(Array.isArray(left) ? left : [])].sort();
    const b = [...new Set(Array.isArray(right) ? right : [])].sort();
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  function autoSendPolicyChanged(current = {}, next = {}) {
    return !sameStringSet(current.auto_send_categories, next.auto_send_categories) ||
      !sameStringSet(current.draft_categories, next.draft_categories) ||
      !sameStringSet(current.always_ask, next.always_ask) ||
      String(current.custom_rules || "").trim() !== String(next.custom_rules || "").trim();
  }

  function findManualSendKey(keys, draftId) {
    const current = keys && typeof keys === "object" && !Array.isArray(keys) ? keys : {};
    const id = String(draftId || "").trim();
    if (!id) return null;
    const existing = current[id];
    if (typeof existing === "string" && /^manual-send:[a-zA-Z0-9-]{8,120}$/.test(existing)) {
      return existing;
    }
    return null;
  }

  function ensureManualSendKey(keys, draftId, uuidFactory) {
    const current = keys && typeof keys === "object" && !Array.isArray(keys) ? keys : {};
    const id = String(draftId || "").trim();
    if (!id) throw new Error("draftId is required");
    const existing = findManualSendKey(current, id);
    if (existing) return { key: existing, keys: current, created: false };
    const rawUuid = String(uuidFactory()).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 120);
    if (rawUuid.length < 8) throw new Error("uuidFactory returned an invalid value");
    const key = `manual-send:${rawUuid}`;
    return { key, keys: { ...current, [id]: key }, created: true };
  }

  function ensureSweepRequestId(value, uuidFactory) {
    const existing = typeof value === "string" ? value.trim() : "";
    if (/^manual-sweep:[a-zA-Z0-9-]{8,120}$/.test(existing)) {
      return { requestId: existing, created: false };
    }
    const rawUuid = String(uuidFactory()).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 120);
    if (rawUuid.length < 8) throw new Error("uuidFactory returned an invalid value");
    return { requestId: `manual-sweep:${rawUuid}`, created: true };
  }

  return {
    ApiError,
    CATEGORIES,
    CATEGORY_LABELS,
    REQUIRED_QUESTIONS,
    MEDIA_TYPES,
    MAX_MEDIA_BYTES,
    normalizeProfile,
    deliveryState,
    validateMediaFile,
    normalizeDomains,
    normalizeTags,
    isValidTimezone,
    formatBytes,
    safeErrorMessage,
    authHeaders,
    expiryToMs,
    shouldRefreshSession,
    sameStringSet,
    autoSendPolicyChanged,
    findManualSendKey,
    ensureManualSendKey,
    ensureSweepRequestId,
  };
});
