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
        if (!path.startsWith("/mail/vf-")) return null;
        return `https://mail-settings.google.com${path.replace(/\[/g, "%5B").replace(/\]/g, "%5D")}`;
      }
      return url.toString();
    } catch { return null; }
  }

  function probeInProgress(probe) {
    if (!["pending", "sent", "processing"].includes(probe?.status)) return false;
    const expires = Date.parse(probe?.expires_at || "");
    return !Number.isFinite(expires) || expires > Date.now();
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
    let heading = "Add a forwarding address";
    let summary = "Add this CaughtUp address in Gmail. Google's confirmation link then appears in Settings.";
    void confirmOpened;
    void probe;

    if (["not_started", "disabled"].includes(status)) {
      label = "Turn on CaughtUp";
      action = "start";
      copy = "CaughtUp copies a short address and opens Gmail so you can add it as a forwarding destination.";
    } else if (confirmationUrl && status !== "route_verified" && !forwarding.google_confirmed_at) {
      label = "Confirm with Google";
      action = "confirm_google";
      poll = true;
      heading = "Google confirmation received";
      copy = "Google emailed your CaughtUp alias. Open the confirmation from Alias inbox below, then turn on Forward a copy in Gmail and Save.";
      summary = "Your alias inbox in Settings shows what Google sent. There is no separate webmail page for this address.";
    } else if (status === "address_ready") {
      label = "Open Gmail settings";
      action = "open_gmail";
      poll = true;
      heading = "Add this address in Gmail";
      copy = "Paste this address in Gmail. When Google confirms it, the link appears here in Settings.";
    } else if (["google_verification_received", "awaiting_gmail_enable", "verifying_route"].includes(status)) {
      label = "Open Gmail settings";
      action = "open_gmail";
      poll = true;
      heading = "Waiting for forwarded mail";
      copy = "The next new message Gmail forwards to this address will turn CaughtUp on.";
      summary = "Send one new message from another account to your Gmail inbox. Mail already sitting there will not hop.";
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
