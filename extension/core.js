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
  const CONTACT_MODES = ["email_only", "scheduled_call", "phone"];
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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

  function isValidPhone(value) {
    return /^\+[1-9]\d{7,14}$/.test(String(value || "").trim());
  }

  function isValidBookingUrl(value) {
    const text = String(value || "").trim();
    if (!text || text.length > 500) return false;
    try {
      const url = new URL(text);
      return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
    } catch {
      return false;
    }
  }

  function normalizeWeeklyAvailability(value) {
    if (!Array.isArray(value)) return [];
    const windows = [];
    for (const item of value) {
      const day = Number(item?.day);
      const start = String(item?.start || "");
      const end = String(item?.end || "");
      if (!Number.isInteger(day) || day < 0 || day > 6) continue;
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || start >= end) continue;
      windows.push({ day, start, end });
    }
    return windows.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  }

  function normalizeCalendar(raw = {}) {
    const mode = CONTACT_MODES.includes(raw.contact_mode) ? raw.contact_mode : "email_only";
    return {
      contact_mode: mode,
      phone_number: typeof raw.phone_number === "string" ? raw.phone_number : "",
      booking_url: typeof raw.booking_url === "string" ? raw.booking_url : "",
      timezone: isValidTimezone(raw.timezone) ? raw.timezone : (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
      weekly_availability: normalizeWeeklyAvailability(raw.weekly_availability),
      settings_version: Number.isFinite(Number(raw.settings_version)) ? Number(raw.settings_version) : null,
    };
  }

  function validateCalendarSettings(calendar) {
    if (!CONTACT_MODES.includes(calendar?.contact_mode)) return { ok: false, message: "Choose how brands should contact you." };
    if (!isValidTimezone(calendar?.timezone)) return { ok: false, message: "Enter a valid IANA time zone, such as America/Los_Angeles." };
    if (calendar.contact_mode === "phone" && !isValidPhone(calendar.phone_number)) {
      return { ok: false, message: "Enter a phone number in international format, such as +14155552671." };
    }
    if (calendar.booking_url && !isValidBookingUrl(calendar.booking_url)) {
      return { ok: false, message: "Booking links must be valid HTTPS URLs." };
    }
    const availability = normalizeWeeklyAvailability(calendar.weekly_availability);
    if (availability.length !== (calendar.weekly_availability || []).length) {
      return { ok: false, message: "Each available day needs a start time before its end time." };
    }
    for (let index = 1; index < availability.length; index += 1) {
      const previous = availability[index - 1];
      const current = availability[index];
      if (previous.day === current.day) {
        return { ok: false, message: "CaughtUp currently supports one availability window per day." };
      }
    }
    if (calendar.contact_mode === "scheduled_call" && !calendar.booking_url && !availability.length) {
      return { ok: false, message: "Add a booking link or at least one available time for scheduled calls." };
    }
    return { ok: true, message: "" };
  }

  function zonedLocalToIso(value, timeZone) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || ""));
    if (!match || !isValidTimezone(timeZone)) return null;
    const desired = match.slice(1).map(Number);
    const desiredUtc = Date.UTC(desired[0], desired[1] - 1, desired[2], desired[3], desired[4]);
    if (new Date(desiredUtc).getUTCFullYear() !== desired[0] || new Date(desiredUtc).getUTCMonth() !== desired[1] - 1 || new Date(desiredUtc).getUTCDate() !== desired[2]) return null;
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone, hour12: false, hourCycle: "h23", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    let instant = desiredUtc;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
      const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute));
      const adjustment = desiredUtc - observed;
      instant += adjustment;
      if (adjustment === 0) break;
    }
    const finalParts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const actual = [finalParts.year, finalParts.month, finalParts.day, String(Number(finalParts.hour) % 24).padStart(2, "0"), finalParts.minute];
    const expected = desired.map((part) => String(part).padStart(2, "0"));
    expected[0] = String(desired[0]);
    return actual.every((part, index) => part === expected[index]) ? new Date(instant).toISOString() : null;
  }

  function formatBookingRange(booking, timeZone) {
    const start = new Date(booking?.start_at);
    const end = new Date(booking?.end_at);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !isValidTimezone(timeZone)) return "Time unavailable";
    const date = new Intl.DateTimeFormat(undefined, { timeZone, weekday: "short", month: "short", day: "numeric" }).format(start);
    const times = new Intl.DateTimeFormat(undefined, { timeZone, hour: "numeric", minute: "2-digit" });
    return `${date}, ${times.format(start)} - ${times.format(end)}`;
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
    CONTACT_MODES,
    WEEKDAYS,
    normalizeProfile,
    deliveryState,
    validateMediaFile,
    normalizeDomains,
    normalizeTags,
    isValidTimezone,
    isValidPhone,
    isValidBookingUrl,
    normalizeWeeklyAvailability,
    normalizeCalendar,
    validateCalendarSettings,
    zonedLocalToIso,
    formatBookingRange,
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
