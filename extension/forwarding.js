"use strict";

(function (global) {
  function canonicalStatus(status) {
    if (!status || status === "not_started") return "not_started";
    if (status === "pending") return "address_ready";
    if (status === "verification_received") return "google_verification_received";
    if (status === "active") return "route_verified";
    return status;
  }

  function allowlistedHttpsUrl(value, hostname, pathPrefix) {
    try {
      const url = new URL(String(value || ""));
      if (url.protocol !== "https:" || url.hostname !== hostname || !url.pathname.startsWith(pathPrefix)) return null;
      if (hostname === "mail-settings.google.com") {
        const path = url.pathname.replace(/%5B/gi, "[").replace(/%5D/gi, "]");
        return path.startsWith("/mail/vf-") ? `https://mail-settings.google.com${path}` : null;
      }
      return url.toString();
    } catch { return null; }
  }

  function probeInProgress(probe) {
    return ["pending", "sent", "processing"].includes(probe?.status);
  }

  function wizardView(result = {}, local = {}) {
    const forwarding = result.forwarding || { status: "not_started" };
    const status = canonicalStatus(forwarding.status);
    const confirmationUrl = allowlistedHttpsUrl(forwarding.confirmation_url, "mail-settings.google.com", "/");
    const gmailSettingsUrl = allowlistedHttpsUrl(result.gmail_settings_url, "mail.google.com", "/mail/")
      || "https://mail.google.com/mail/#settings/fwdandpop";
    const confirmOpened = Boolean(local.confirmOpened);
    const probe = result.latest_probe || null;
    let label = "";
    let action = "none";
    let copy = "";
    let poll = false;
    let heading = "Turn on email intake";
    let summary = "Add this CaughtUp address in Gmail, then confirm and verify the connection.";

    if (["not_started", "disabled"].includes(status)) {
      label = "Turn on CaughtUp";
      action = "start";
      copy = "CaughtUp will copy a short forwarding address and open Gmail.";
    } else if (status === "address_ready") {
      label = "Open Gmail settings";
      action = "open_gmail";
      poll = true;
      copy = "Paste this address in Gmail. Leave this popup open — CaughtUp will confirm Google's email automatically. Gmail can list the address before that happens.";
    } else if (status === "google_verification_received" && confirmationUrl && !confirmOpened && !forwarding.google_confirmed_at) {
      label = "Confirm";
      action = "confirm_google";
      poll = true;
      copy = "Google emailed CaughtUp. Hit Confirm, then enable Forward a copy in Gmail and Save Changes.";
      summary = "Google reached CaughtUp. Confirm the address, then enable forwarding.";
    } else if (status === "google_verification_received" || status === "awaiting_gmail_enable") {
      label = "Verify connection";
      action = "verify_route";
      poll = true;
      copy = "In Gmail, turn forwarding on to this address and Save Changes. Then verify the connection. Do not mint a new address.";
      summary = "Enable forwarding in Gmail, save, then let CaughtUp prove the route.";
    } else if (status === "verifying_route") {
      label = probeInProgress(probe) ? "" : "Retry verification";
      action = probeInProgress(probe) ? "none" : "verify_route";
      poll = true;
      copy = probeInProgress(probe)
        ? "CaughtUp sent a check to your Gmail inbox. Waiting for that message to come back through forwarding."
        : "The connection check did not return. After Save Changes in Gmail, retry verification. CaughtUp will keep this same address.";
      summary = "Waiting for Gmail forwarding to return CaughtUp's connection check.";
    } else if (status === "route_verified") {
      label = "";
      action = "none";
      heading = "You're connected";
      summary = "CaughtUp uses Gmail permission only to send replies. Incoming mail reaches CaughtUp through forwarding.";
      copy = "Forwarding is on. You can continue in Today.";
    } else {
      label = "Open Gmail settings";
      action = "open_gmail";
      poll = true;
    }

    return {
      forwarding,
      status,
      confirmationUrl,
      gmailSettingsUrl,
      label,
      action,
      copy,
      poll,
      heading,
      summary,
      hiddenPrimary: !label,
      probe,
    };
  }

  function shouldPoll(view) {
    return Boolean(view?.poll);
  }

  global.CaughtUpForwarding = {
    canonicalStatus,
    allowlistedHttpsUrl,
    wizardView,
    shouldPoll,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
