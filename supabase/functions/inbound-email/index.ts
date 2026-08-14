import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { inboundSystemPrompt, triageInbound, type TriageResult } from "../_shared/inbound-triage.ts";
import { parseStrictRecipient, quoteFilename, sanitizeHeader, sanitizeMessageIds } from "../_shared/mime.ts";
import {
  applyContactPreference, collaborationMediaKitRelevant, contactSafetyViolations, deliveryDecision,
  draftSafetyViolations, enforceConfiguredSignoff, explicitPortfolioRequest, finalizePortfolioDraft,
  findVerifiedOpenSlots, hostileInboundDetected, legitimateInquiryFallbackAllowed, safeCalendarPreference,
  safeInformationDraft, safeNegotiationDraft, selectMediaKit, type CalendarPreference, type MediaKitCandidate,
} from "../_shared/policy.ts";
import {
  evaluateCommercialTerms, extractCommercialTerms, negotiationEventType, negotiationStage, negotiationSummary,
} from "../_shared/negotiations.ts";

const MAX_DAILY_MESSAGES = 200;
const GOOGLE_FORWARDING_SENDER = "forwarding-noreply@google.com";
const INBOUND_SIGNING_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAELdC8NihD9qwarrH+/pG8wb4SRYdj
xqAgFbXAzbPE6WM9xonKXEjWBMzN6mrss5AqGUdyypvHi+FowO3jeTk1EA==
-----END PUBLIC KEY-----`;

interface InboundPayload {
  alias_token: string;
  envelope_from: string;
  envelope_to: string;
  from: string;
  reply_to: string;
  original_to: string;
  subject: string;
  text: string;
  message_id: string;
  in_reply_to: string;
  references: string;
  precedence: string;
  auto_submitted: string;
  list_unsubscribe: boolean;
  received_at: string;
  raw_size: number;
  attachments: { filename: string; mime_type: string; byte_size: number }[];
  authentication_results: string;
}

interface OutboundAttachment { name: string; mime: string; b64: string }

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function clean(value: unknown, max: number): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publicKeyBytes(pem: string): Uint8Array {
  const encoded = pem.replace("-----BEGIN PUBLIC KEY-----", "").replace("-----END PUBLIC KEY-----", "").replace(/\s+/g, "");
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

async function validSignature(req: Request, body: string): Promise<boolean> {
  const timestamp = req.headers.get("x-caughtup-timestamp") ?? "";
  const supplied = (req.headers.get("x-caughtup-signature") ?? "").toLowerCase();
  const seconds = Number(timestamp);
  if (!/^[0-9]{10}$/.test(timestamp) || !/^[0-9a-f]{128}$/.test(supplied) ||
      !Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) return false;
  const publicKey = publicKeyBytes(INBOUND_SIGNING_PUBLIC_KEY);
  const key = await crypto.subtle.importKey("spki", publicKey.buffer as ArrayBuffer,
    { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const signature = Uint8Array.from(supplied.match(/.{2}/g) ?? [], (hex) => Number.parseInt(hex, 16));
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, new TextEncoder().encode(`${timestamp}.${body}`));
}

function validatePayload(raw: any): InboundPayload | null {
  const token = clean(raw?.alias_token, 96).toLowerCase();
  const envelopeTo = clean(raw?.envelope_to, 320).toLowerCase();
  if (!/^[a-z0-9]{32,96}$/.test(token) || envelopeTo !== `inbox+${token}@inbound.getcaughtup.io`) return null;
  const received = new Date(String(raw?.received_at ?? ""));
  const rawSize = Number(raw?.raw_size);
  if (!Number.isFinite(received.getTime()) || !Number.isInteger(rawSize) || rawSize < 1 || rawSize > 10_000_000) return null;
  const attachments = Array.isArray(raw?.attachments) ? raw.attachments.slice(0, 25).map((item: any) => ({
    filename: clean(item?.filename, 180), mime_type: clean(item?.mime_type, 100).toLowerCase(),
    byte_size: Math.max(0, Math.min(10_000_000, Number(item?.byte_size) || 0)),
  })) : [];
  return {
    alias_token: token,
    envelope_from: clean(raw?.envelope_from, 320).toLowerCase(), envelope_to: envelopeTo,
    from: clean(raw?.from, 500), reply_to: clean(raw?.reply_to, 500), original_to: clean(raw?.original_to, 1000),
    subject: clean(raw?.subject, 500), text: String(raw?.text ?? "").replace(/\u0000/g, "").slice(0, 100_000),
    message_id: sanitizeMessageIds(raw?.message_id), in_reply_to: sanitizeMessageIds(raw?.in_reply_to),
    references: sanitizeMessageIds(raw?.references), precedence: clean(raw?.precedence, 80).toLowerCase(),
    auto_submitted: clean(raw?.auto_submitted, 80).toLowerCase(), list_unsubscribe: raw?.list_unsubscribe === true,
    received_at: received.toISOString(), raw_size: rawSize, attachments,
    authentication_results: clean(raw?.authentication_results, 2000),
  };
}

function replyAddress(payload: InboundPayload): string | null {
  return parseStrictRecipient(payload.reply_to) ?? parseStrictRecipient(payload.from) ?? parseStrictRecipient(payload.envelope_from);
}

function googleForwardingConfirmation(payload: InboundPayload): { code: string | null; url: string | null } | null {
  if (payload.envelope_from !== GOOGLE_FORWARDING_SENDER || parseStrictRecipient(payload.from) !== GOOGLE_FORWARDING_SENDER) return null;
  if (!/gmail forwarding confirmation/i.test(payload.subject)) return null;
  const code = payload.text.match(/confirmation\s+code\s*:\s*([0-9]{6,20})/i)?.[1] ?? null;
  const urls = payload.text.match(/https:\/\/mail-settings\.google\.com\/[^\s<>'"]+/gi) ?? [];
  let url: string | null = null;
  for (const candidate of urls) {
    try {
      const parsed = new URL(candidate.replace(/[).,]+$/, ""));
      if (parsed.protocol === "https:" && parsed.hostname === "mail-settings.google.com") { url = parsed.toString().slice(0, 2000); break; }
    } catch { /* ignore malformed candidate */ }
  }
  return code || url ? { code, url } : null;
}

function addressParts(value: string): { address: string; domain: string } | null {
  const address = parseStrictRecipient(value);
  if (!address) return null;
  return { address, domain: address.split("@")[1] ?? "" };
}

function suggestedBrandName(from: string, domain: string): string {
  const display = sanitizeHeader(from.replace(/<[^>]+>/g, "").replace(/^['"]+|['"]+$/g, "").trim(), 120);
  if (display && !display.includes("@")) return display;
  return domain.split(".")[0].split(/[-_]/).filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ").slice(0, 120);
}

function b64url(value: string): string {
  return btoa(unescape(encodeURIComponent(value))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function bytesToBase64(bytes: Uint8Array): string {
  let value = "";
  for (let index = 0; index < bytes.length; index += 0x8000) value += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(value);
}

function buildReplyMime(input: {
  to: string; subject: string; body: string; messageId: string; inReplyTo: string; references: string;
  attachment?: OutboundAttachment;
}): string {
  const recipient = parseStrictRecipient(input.to);
  if (!recipient) throw new Error("invalid_recipient");
  const replyId = sanitizeMessageIds(input.inReplyTo).split(" ")[0] ?? "";
  const references = sanitizeMessageIds(`${input.references} ${replyId}`);
  const subject = sanitizeHeader(input.subject, 500);
  const headers = [
    `To: ${recipient}`, `Subject: ${subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`}`,
    `Message-ID: ${input.messageId}`, replyId ? `In-Reply-To: ${replyId}` : "",
    references ? `References: ${references}` : "", "MIME-Version: 1.0",
  ].filter(Boolean);
  if (!input.attachment) return b64url([...headers, 'Content-Type: text/plain; charset="UTF-8"', "", input.body].join("\r\n"));
  const boundary = `caughtup-${crypto.randomUUID()}`;
  const filename = quoteFilename(input.attachment.name);
  return b64url([
    ...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"', "", input.body, `--${boundary}`,
    `Content-Type: ${input.attachment.mime}; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`, "Content-Transfer-Encoding: base64", "",
    ...(input.attachment.b64.match(/.{1,76}/g) ?? []), `--${boundary}--`,
  ].join("\r\n"));
}

async function loadAttachment(supabase: any, kit: any): Promise<OutboundAttachment | undefined> {
  if (!kit?.storage_path) return undefined;
  const { data, error } = await supabase.storage.from("media-kit").download(kit.storage_path);
  if (error || !data) return undefined;
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.length < 1 || bytes.length > 8_000_000 || bytes.length !== Number(kit.byte_size)) return undefined;
  return { name: kit.original_filename, mime: kit.mime_type, b64: bytesToBase64(bytes) };
}

async function gmailAccessToken(refreshToken: string, config: Record<string, string>): Promise<string | null> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.ia_google_send_client_id, client_secret: config.ia_google_send_client_secret,
      refresh_token: refreshToken, grant_type: "refresh_token" }), signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  return (await response.json()).access_token ?? null;
}

async function resolveThread(supabase: any, accountId: string, payload: InboundPayload, fallback: string): Promise<string> {
  const refs = sanitizeMessageIds(`${payload.references} ${payload.in_reply_to}`).split(" ").filter(Boolean);
  if (refs.length) {
    const { data: outboundRows, error: outboundError } = await supabase.from("ia_processed_emails").select("thread_id,processed_at")
      .eq("gmail_account_id", accountId).in("outbound_message_id", refs)
      .order("processed_at", { ascending: false }).limit(1);
    if (!outboundError && outboundRows?.[0]?.thread_id) return outboundRows[0].thread_id;
    const { data: inboundRows, error: inboundError } = await supabase.from("ia_processed_emails").select("thread_id,processed_at")
      .eq("gmail_account_id", accountId).in("rfc_message_id", refs)
      .order("processed_at", { ascending: false }).limit(1);
    if (!inboundError && inboundRows?.[0]?.thread_id) return inboundRows[0].thread_id;
  }
  return refs[0] ?? (payload.message_id || fallback);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const rawBody = await req.text();
  if (!await validSignature(req, rawBody)) return json({ error: "unauthorized" }, 401);
  let payload: InboundPayload | null = null;
  try { payload = validatePayload(JSON.parse(rawBody)); } catch { /* invalid below */ }
  if (!payload) return json({ error: "invalid payload" }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const tokenHash = await sha256(payload.alias_token);
  const { data: alias, error: aliasError } = await supabase.from("ia_forwarding_aliases")
    .select("id,user_id,gmail_account_id,status").eq("alias_token_hash", tokenHash).maybeSingle();
  if (aliasError) return json({ error: "alias lookup failed" }, 503);
  if (!alias || alias.status === "disabled") return json({ ok: true, discarded: "unknown_alias" }, 202);

  const confirmation = googleForwardingConfirmation(payload);
  if (confirmation) {
    const update: Record<string, unknown> = {
      status: "verification_received", verification_received_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    if (confirmation.code) update.verification_code = confirmation.code;
    if (confirmation.url) update.confirmation_url = confirmation.url;
    const { error } = await supabase.from("ia_forwarding_aliases").update(update).eq("id", alias.id);
    return error ? json({ error: "verification state failed" }, 503) : json({ ok: true, verification_received: true });
  }
  if (alias.status !== "active") return json({ ok: true, discarded: "forwarding_not_active" }, 202);

  const { data: account, error: accountError } = await supabase.from("ia_gmail_accounts")
    .select("id,user_id,gmail_address,refresh_token,oauth_capability").eq("id", alias.gmail_account_id)
    .eq("user_id", alias.user_id).eq("oauth_capability", "send_only").maybeSingle();
  if (accountError || !account) return json({ error: "send-only account unavailable" }, 503);
  const sender = addressParts(payload.reply_to) ?? addressParts(payload.from) ?? addressParts(payload.envelope_from);
  if (!sender || sender.address === String(account.gmail_address).toLowerCase()) return json({ ok: true, discarded: "invalid_or_owner_sender" }, 202);

  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const { count: receivedToday, error: budgetError } = await supabase.from("ia_inbound_messages")
    .select("id", { count: "exact", head: true }).eq("user_id", alias.user_id).gte("created_at", dayStart.toISOString());
  if (budgetError) return json({ error: "inbound budget unavailable" }, 503);
  if ((receivedToday ?? 0) >= MAX_DAILY_MESSAGES) return json({ ok: true, discarded: "daily_budget_reached" }, 202);

  const dedupeKey = await sha256(`${alias.id}\n${payload.message_id || `${payload.envelope_from}\n${payload.subject}\n${await sha256(payload.text)}`}`);
  const fallbackThread = `fwd:${dedupeKey}`;
  const threadKey = await resolveThread(supabase, account.id, payload, fallbackThread);
  const { data: insertedInbound, error: inboundError } = await supabase.from("ia_inbound_messages").insert({
    forwarding_alias_id: alias.id, user_id: alias.user_id, gmail_account_id: account.id, dedupe_key: dedupeKey,
    rfc_message_id: payload.message_id, thread_key: threadKey, envelope_from: payload.envelope_from,
    header_from: payload.from, reply_to: payload.reply_to, original_to: payload.original_to, subject: payload.subject,
    text_body: payload.text, in_reply_to: payload.in_reply_to, references_header: payload.references,
    received_at: payload.received_at, processing_status: "processing",
    safe_metadata: { raw_size: payload.raw_size, attachments: payload.attachments, authentication_results: payload.authentication_results,
      precedence: payload.precedence, auto_submitted: payload.auto_submitted, list_unsubscribe: payload.list_unsubscribe },
  }).select("id").maybeSingle();
  let inbound = insertedInbound;
  if (inboundError || !inbound) {
    const { data: duplicate } = await supabase.from("ia_inbound_messages").select("id,processing_status,updated_at")
      .eq("forwarding_alias_id", alias.id).eq("dedupe_key", dedupeKey).maybeSingle();
    if (!duplicate) return json({ error: "inbound state failed" }, 503);
    const staleProcessing = duplicate.processing_status === "processing" &&
      new Date(duplicate.updated_at).getTime() < Date.now() - 10 * 60_000;
    if (duplicate.processing_status !== "error" && !staleProcessing) {
      return json({ ok: true, duplicate: true, status: duplicate.processing_status });
    }
    const { data: reclaimed, error: reclaimError } = await supabase.from("ia_inbound_messages").update({
      processing_status: "processing", error_code: null, text_body: payload.text, updated_at: new Date().toISOString(),
    }).eq("id", duplicate.id).eq("processing_status", duplicate.processing_status)
      .eq("updated_at", duplicate.updated_at).select("id").maybeSingle();
    if (reclaimError || !reclaimed) return json({ error: "inbound retry unavailable" }, 503);
    inbound = reclaimed;
  }

  try {
    const [{ data: profile }, { data: edits }, { data: calendarRow }, { data: bookings }, { data: mediaKits }, { data: senderRules }] = await Promise.all([
      supabase.from("ia_voice_profiles").select("*").eq("user_id", alias.user_id).single(),
      supabase.from("ia_draft_edits").select("original_draft,edited_final").eq("user_id", alias.user_id).order("created_at", { ascending: false }).limit(10),
      supabase.from("ia_calendar_preferences").select("contact_mode,phone_number,booking_url,timezone,weekly_availability").eq("user_id", alias.user_id).maybeSingle(),
      supabase.from("ia_bookings").select("start_at,end_at").eq("user_id", alias.user_id).gte("end_at", new Date().toISOString()).order("start_at").limit(500),
      supabase.from("ia_media_kits").select("id,label,best_for,storage_path,original_filename,mime_type,byte_size,brand_names,sender_domains,keywords,is_default,auto_attach")
        .eq("user_id", alias.user_id).eq("status", "active"),
      supabase.from("ia_sender_rules").select("match_type,match_value,action,priority").eq("user_id", alias.user_id).eq("enabled", true).order("priority"),
    ]);
    if (!profile) throw new Error("profile_unavailable");
    const calendar: CalendarPreference = safeCalendarPreference(calendarRow, profile.timezone ?? "America/Los_Angeles");
    const slots = findVerifiedOpenSlots(calendar, bookings ?? []);
    const noReply = /^(?:no[-._]?reply|do[-._]?not[-._]?reply|noreply)/.test(sender.address.split("@")[0]);
    const bulk = payload.list_unsubscribe || ["bulk", "list", "junk"].includes(payload.precedence) ||
      (payload.auto_submitted !== "" && payload.auto_submitted !== "no");
    let triage: TriageResult;
    if (noReply) triage = { category: "low_priority", summary: "Automated no-reply message.", draft: null, wants_portfolio: false, missing_required: [], confidence: 1 };
    else if (bulk) triage = { category: "low_priority", summary: "Bulk marketing or automated mail.", draft: null, wants_portfolio: false, missing_required: [], confidence: 1 };
    else {
      const { data: configRows, error: configError } = await supabase.rpc("ia_get_config");
      if (configError) throw new Error("configuration_unavailable");
      const config = Object.fromEntries((configRows ?? []).map((row: any) => [row.name, row.secret]));
      triage = await triageInbound(config, inboundSystemPrompt(profile, edits ?? [], calendar), payload.from, payload.subject, payload.text);
    }
    const hostile = hostileInboundDetected(payload.subject, payload.text);
    if (hostile) triage = { category: "spam_or_poor_fit", summary: "Message contains untrusted instructions directed at the agent.", draft: null, wants_portfolio: false, missing_required: [], confidence: 1 };

    const { data: previousReplies } = await supabase.from("ia_processed_emails").select("id")
      .eq("gmail_account_id", account.id).eq("thread_id", threadKey).eq("delivery_status", "sent").limit(1);
    const { data: existingNegotiation } = await supabase.from("ia_negotiations")
      .select("id,stage,media_kit_id,current_terms,threshold_status,brand_name,brand_domain")
      .eq("gmail_account_id", account.id).eq("thread_id", threadKey).maybeSingle();
    const commercialTerms = extractCommercialTerms(payload.subject, payload.text);
    const activeNegotiation = existingNegotiation && !["agreed", "declined", "closed"].includes(existingNegotiation.stage);
    const negotiationRequired = !hostile && ((commercialTerms.detected && Boolean(previousReplies?.length)) || Boolean(activeNegotiation));
    if (negotiationRequired) {
      const terms = commercialTerms.detected ? commercialTerms : existingNegotiation?.current_terms ?? commercialTerms;
      triage = { ...triage, category: "urgent", summary: negotiationSummary(terms, Boolean(existingNegotiation)), confidence: 1 };
      if (!triage.draft || draftSafetyViolations(triage.draft).length) triage.draft = safeNegotiationDraft(profile);
    }

    const portfolioRequested = explicitPortfolioRequest(payload.subject, payload.text);
    const fallbackAllowed = legitimateInquiryFallbackAllowed(payload.subject, payload.text);
    const contextualKit = collaborationMediaKitRelevant(payload.subject, payload.text);
    const shouldAttach = portfolioRequested || contextualKit;
    const enabledCategories = Array.isArray(profile.draft_categories) ? profile.draft_categories : ["urgent", "action_needed"];
    const recoveryNeeded = enabledCategories.includes(triage.category) && (!triage.draft || draftSafetyViolations(triage.draft).length > 0);
    const categoryRecovery = !enabledCategories.includes(triage.category) && fallbackAllowed && (triage.category !== "fyi" || contextualKit);
    if (fallbackAllowed && (recoveryNeeded || categoryRecovery)) {
      triage = { ...triage, category: categoryRecovery ? "action_needed" : triage.category,
        draft: safeInformationDraft(profile, shouldAttach || triage.wants_portfolio),
        wants_portfolio: shouldAttach || triage.wants_portfolio, confidence: 1 };
    } else if (shouldAttach && fallbackAllowed) triage.wants_portfolio = true;

    const candidates = (mediaKits ?? []).map((kit: any) => ({ ...kit, description: kit.best_for }));
    let selectedKit = triage.wants_portfolio
      ? selectMediaKit(candidates as MediaKitCandidate[], sender.address, payload.subject, payload.text) : null;
    const matchedRules = (senderRules ?? []).filter((rule: any) => rule.match_type === "email"
      ? rule.match_value.toLowerCase() === sender.address : rule.match_value.toLowerCase() === sender.domain);

    let negotiationId: string | null = null;
    if (negotiationRequired) {
      const pinned = existingNegotiation?.media_kit_id
        ? candidates.find((kit: any) => kit.id === existingNegotiation.media_kit_id) ?? null
        : selectMediaKit(candidates as MediaKitCandidate[], sender.address, payload.subject, payload.text);
      selectedKit = selectedKit ?? pinned;
      let rateProfile: any = null;
      if (pinned?.id) {
        const { data } = await supabase.from("ia_media_kit_rate_profiles")
          .select("currency,flat_fee_floor,flat_fee_target,commission_floor,commission_target,hybrid_guarantee_floor")
          .eq("user_id", alias.user_id).eq("media_kit_id", pinned.id).maybeSingle();
        rateProfile = data;
      }
      const terms = commercialTerms.detected ? commercialTerms : existingNegotiation?.current_terms ?? commercialTerms;
      const threshold = commercialTerms.detected ? evaluateCommercialTerms(commercialTerms, rateProfile) : existingNegotiation?.threshold_status ?? "unconfigured";
      const { data: saved, error } = await supabase.from("ia_negotiations").upsert({
        user_id: alias.user_id, gmail_account_id: account.id, thread_id: threadKey,
        brand_name: existingNegotiation?.brand_name ?? suggestedBrandName(payload.from, sender.domain),
        brand_domain: existingNegotiation?.brand_domain || sender.domain,
        stage: negotiationStage(Boolean(existingNegotiation), commercialTerms), media_kit_id: pinned?.id ?? existingNegotiation?.media_kit_id ?? null,
        current_terms: terms, previous_terms: commercialTerms.detected && existingNegotiation?.current_terms ? existingNegotiation.current_terms : null,
        threshold_status: threshold, attention_level: "critical", human_review_required: true,
        latest_message_id: payload.message_id || fallbackThread, latest_subject: payload.subject, summary: triage.summary,
        proposed_reply: triage.draft, last_inbound_at: payload.received_at, is_test: false, dismissed_at: null, updated_at: new Date().toISOString(),
      }, { onConflict: "gmail_account_id,thread_id" }).select("id").single();
      if (error || !saved) throw new Error("negotiation_state_failed");
      negotiationId = saved.id;
      const { error: eventError } = await supabase.from("ia_negotiation_events").upsert({
        negotiation_id: negotiationId, user_id: alias.user_id, gmail_message_id: payload.message_id || fallbackThread,
        direction: "inbound", event_type: negotiationEventType(Boolean(existingNegotiation), commercialTerms), terms, summary: triage.summary, is_test: false,
      }, { onConflict: "negotiation_id,gmail_message_id", ignoreDuplicates: true });
      if (eventError) throw new Error("negotiation_event_failed");
    }

    let decision = deliveryDecision({ category: triage.category, draft: triage.draft, missingRequired: triage.missing_required,
      profile, selectedKit, wantsPortfolio: triage.wants_portfolio, confidence: triage.confidence });
    if (triage.draft && matchedRules.some((rule: any) => rule.action === "always_draft") && !draftSafetyViolations(triage.draft).length) decision = "draft";
    if (matchedRules.some((rule: any) => rule.action === "never_draft")) decision = "none";
    if (decision === "auto_send" && matchedRules.some((rule: any) => rule.action === "require_approval")) decision = "draft";
    if (negotiationRequired && decision === "auto_send") decision = "draft";

    let finalDraft = triage.draft ? enforceConfiguredSignoff(triage.draft, profile) : null;
    if (finalDraft && triage.wants_portfolio) finalDraft = finalizePortfolioDraft(finalDraft, Boolean(selectedKit));
    if (finalDraft) finalDraft = enforceConfiguredSignoff(applyContactPreference(finalDraft, calendar, slots), profile);
    if (finalDraft && (draftSafetyViolations(finalDraft).length || contactSafetyViolations(finalDraft, calendar, slots).length ||
      (finalDraft.match(/\S+/g) ?? []).length > 150)) decision = "none";
    const draftVersion = finalDraft && decision !== "none"
      ? await sha256(JSON.stringify({ to: sender.address, subject: payload.subject, body: finalDraft, kit: selectedKit?.id ?? null,
        in_reply_to: payload.message_id, references: payload.references })) : null;
    const outboundMessageId = finalDraft && decision !== "none" ? `<caughtup-${crypto.randomUUID()}@getcaughtup.io>` : null;
    const draftUpdatedAt = finalDraft ? new Date().toISOString() : null;
    const { data: processed, error: processedError } = await supabase.from("ia_processed_emails").insert({
      gmail_account_id: account.id, gmail_message_id: `fwd:${dedupeKey}`, thread_id: threadKey,
      category: triage.category, summary: triage.summary, draft_created: Boolean(finalDraft && decision !== "none"),
      auto_sent: false, draft_text: finalDraft && decision !== "none" ? finalDraft : null, gmail_draft_id: null,
      sender: payload.from || sender.address, subject: payload.subject || "(no subject)", delivery_status: finalDraft && decision !== "none" ? "draft" : "none",
      selected_media_kit_id: finalDraft && decision !== "none" && selectedKit ? selectedKit.id : null,
      negotiation_id: negotiationId, human_review_required: negotiationRequired, is_test: false,
      ingestion_source: "forwarded", inbound_message_id: inbound.id, reply_to_address: sender.address,
      rfc_message_id: payload.message_id, rfc_in_reply_to: payload.in_reply_to, rfc_references: payload.references,
      outbound_message_id: outboundMessageId, draft_version: draftVersion, draft_updated_at: draftUpdatedAt,
    }).select("id").single();
    if (processedError || !processed) throw new Error("processed_email_failed");

    if (decision === "auto_send" && finalDraft && outboundMessageId) {
      const { data: freshProfile } = await supabase.from("ia_voice_profiles").select("*").eq("user_id", alias.user_id).single();
      const freshDecision = freshProfile && Number(freshProfile.settings_version) === Number(profile.settings_version)
        ? deliveryDecision({ category: triage.category, draft: finalDraft, missingRequired: triage.missing_required,
          profile: freshProfile, selectedKit, wantsPortfolio: triage.wants_portfolio, confidence: triage.confidence }) : "draft";
      if (freshDecision === "auto_send") {
        const { data: attempt } = await supabase.from("ia_send_attempts").insert({
          user_id: alias.user_id, processed_email_id: processed.id, idempotency_key: `auto:inbound:${inbound.id}`,
        }).select("id").maybeSingle();
        if (attempt?.id) {
          const { data: configRows, error: configError } = await supabase.rpc("ia_get_config");
          const config = Object.fromEntries((configRows ?? []).map((row: any) => [row.name, row.secret]));
          const token = configError ? null : await gmailAccessToken(account.refresh_token, config);
          const attachment = selectedKit ? await loadAttachment(supabase, selectedKit) : undefined;
          const canSend = Boolean(token) && (!triage.wants_portfolio || Boolean(attachment));
          if (canSend) {
            const { data: sending } = await supabase.from("ia_send_attempts")
              .update({ status: "sending", updated_at: new Date().toISOString() })
              .eq("id", attempt.id).eq("status", "claimed").select("id").maybeSingle();
            const { data: lockedDraft } = sending && draftUpdatedAt
              ? await supabase.from("ia_processed_emails").update({ delivery_status: "sending" })
                .eq("id", processed.id).eq("delivery_status", "draft").eq("draft_updated_at", draftUpdatedAt)
                .select("id").maybeSingle()
              : { data: null };
            if (sending && lockedDraft) {
              const raw = buildReplyMime({ to: sender.address, subject: payload.subject, body: finalDraft,
                messageId: outboundMessageId, inReplyTo: payload.message_id, references: payload.references, attachment });
              let response: Response | null = null;
              try {
                response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
                  method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ raw }), signal: AbortSignal.timeout(30_000),
                });
              } catch { /* an interrupted Gmail request has an unknown outcome */ }
              if (response?.ok) {
                const sent = await response.json().catch(() => ({})); const sentAt = new Date().toISOString();
                const { error: stateError } = await supabase.from("ia_processed_emails").update({ auto_sent: true,
                  delivery_status: "sent", sent_via: "auto", gmail_sent_message_id: sent.id ?? null, sent_at: sentAt,
                }).eq("id", processed.id).eq("delivery_status", "sending");
                await supabase.from("ia_send_attempts").update({ status: stateError ? "reconcile" : "sent",
                  gmail_message_id: sent.id ?? null, error_code: stateError ? "state_update_failed" : null, updated_at: sentAt,
                }).eq("id", attempt.id);
              } else await supabase.from("ia_send_attempts").update({ status: "reconcile", error_code: response ? `gmail_${response.status}` : "gmail_transport",
                updated_at: new Date().toISOString() }).eq("id", attempt.id);
            } else await supabase.from("ia_send_attempts").update({ status: "failed", error_code: "draft_changed",
              updated_at: new Date().toISOString() }).eq("id", attempt.id).neq("status", "sent");
          } else await supabase.from("ia_send_attempts").update({ status: "failed", error_code: "send_precondition_failed",
            updated_at: new Date().toISOString() }).eq("id", attempt.id);
        }
      }
    }
    await supabase.from("ia_inbound_messages").update({ processing_status: "processed", processed_email_id: processed.id,
      text_body: "", updated_at: new Date().toISOString() }).eq("id", inbound.id);
    return json({ ok: true, processed: true, category: triage.category, delivery: decision });
  } catch (error) {
    console.error(JSON.stringify({ component: "inbound-email", inbound_id: inbound.id,
      error_type: error instanceof Error ? error.message.slice(0, 100) : "unknown" }));
    await supabase.from("ia_inbound_messages").update({ processing_status: "error", error_code: "processing_failed",
      text_body: "", updated_at: new Date().toISOString() }).eq("id", inbound.id);
    return json({ error: "processing failed" }, 503);
  }
});
