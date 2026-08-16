import { parseStrictRecipient } from "./mime.ts";

export type InboxObservationKind =
  | "niche"
  | "recurring_brand"
  | "inquiry_pattern"
  | "campaign_type"
  | "missing_information";

export interface InboxObservationCandidate {
  kind: InboxObservationKind;
  value: string;
  confidence: number;
}

interface ArchiveBase {
  userId: string;
  gmailAccountId: string;
  forwardingAliasId: string;
  threadKey: string;
  messageKey: string;
  senderAddress: string;
  recipientAddresses: string[];
  senderDomain: string;
  subject: string;
  bodyText: string;
  rfcMessageId: string;
  inReplyTo: string;
  referencesHeader: string;
  category?: string | null;
  summary?: string;
  occurredAt: string;
  processedEmailId?: string | null;
  safeMetadata?: Record<string, unknown>;
}

interface InboundArchive extends ArchiveBase {
  inboundMessageId: string;
  processingState: "received" | "processed" | "error";
}

interface OutboundArchive extends ArchiveBase {
  source: "manual_extension" | "auto_send";
}

const OBSERVATION_KINDS = new Set<InboxObservationKind>([
  "niche", "recurring_brand", "inquiry_pattern", "campaign_type", "missing_information",
]);

function clean(value: unknown, max: number): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function archiveAddress(value: unknown): string {
  return parseStrictRecipient(clean(value, 500)) ?? "";
}

export function archiveDomain(address: string): string {
  return clean(address.split("@")[1] ?? "", 253).toLowerCase();
}

export function observationValueAllowed(kind: InboxObservationKind, value: string): boolean {
  const normalized = clean(value, 160).toLowerCase();
  if (!normalized) return false;
  if (/(?:auto[- ]?send|permission to send|enable sending|reply rule|system prompt|password|credential|api key|secret)/i.test(normalized)) {
    return false;
  }
  if (/(?:[$€£]\s*\d|\b(?:usd|eur|gbp)\s*\d|\b(?:accepts?|accepted|rejects?|rejected|agreed|declined)\b|\b(?:creator|owner)\s+(?:is\s+)?available\b|\b(?:committed to|guarantees?)\b)/i.test(normalized)) {
    return false;
  }
  if (kind !== "missing_information" && /\b(?:price|pricing|rate|fee|budget)\b/i.test(normalized)) return false;
  return true;
}

async function archiveMessage(
  supabase: any,
  input: ArchiveBase & {
    direction: "inbound" | "outbound";
    source: "forwarded" | "manual_extension" | "auto_send";
    processingState: "received" | "processed" | "sent" | "error";
    inboundMessageId?: string | null;
  },
): Promise<any> {
  const { data, error } = await supabase.rpc("ia_archive_inbox_message", {
    p_user_id: input.userId,
    p_gmail_account_id: input.gmailAccountId,
    p_forwarding_alias_id: input.forwardingAliasId,
    p_thread_key: clean(input.threadKey, 998),
    p_message_key: input.messageKey,
    p_direction: input.direction,
    p_source: input.source,
    p_sender_address: archiveAddress(input.senderAddress),
    p_recipient_addresses: input.recipientAddresses.map(archiveAddress).filter(Boolean).slice(0, 50),
    p_sender_domain: clean(input.senderDomain, 253).toLowerCase(),
    p_subject: clean(input.subject, 500),
    p_body_text: String(input.bodyText ?? "").replace(/\u0000/g, "").slice(0, 100_000),
    p_rfc_message_id: clean(input.rfcMessageId, 998),
    p_in_reply_to: clean(input.inReplyTo, 998),
    p_references_header: clean(input.referencesHeader, 4000),
    p_category: input.category ?? null,
    p_summary: clean(input.summary, 500),
    p_processing_state: input.processingState,
    p_occurred_at: input.occurredAt,
    p_inbound_message_id: input.inboundMessageId ?? null,
    p_processed_email_id: input.processedEmailId ?? null,
    p_safe_metadata: input.safeMetadata ?? {},
  }).maybeSingle();
  if (error || !data) throw new Error("inbox_archive_failed");
  return data;
}

export async function archiveInboundMessage(supabase: any, input: InboundArchive): Promise<any> {
  return archiveMessage(supabase, { ...input, direction: "inbound", source: "forwarded" });
}

export async function archiveOutboundMessage(supabase: any, input: OutboundArchive): Promise<any> {
  return archiveMessage(supabase, { ...input, direction: "outbound", processingState: "sent" });
}

export async function loadRelevantInboxContext(
  supabase: any,
  userId: string,
  gmailAccountId: string,
  threadKey: string,
  senderDomain: string,
): Promise<string> {
  const { data: thread } = await supabase.from("ia_inbox_threads").select("id")
    .eq("user_id", userId).eq("gmail_account_id", gmailAccountId).eq("thread_key", threadKey).maybeSingle();
  const threadQuery = thread?.id
    ? supabase.from("ia_inbox_messages").select("direction,source,processing_state,category,sender_address,subject,body_text,summary,occurred_at")
      .eq("user_id", userId).eq("gmail_account_id", gmailAccountId).eq("thread_id", thread.id)
      .order("occurred_at", { ascending: false }).limit(8)
    : Promise.resolve({ data: [] });
  const senderQuery = senderDomain
    ? supabase.from("ia_inbox_messages").select("direction,source,processing_state,category,sender_address,subject,summary,body_text,occurred_at")
      .eq("user_id", userId).eq("gmail_account_id", gmailAccountId).eq("direction", "inbound")
      .eq("sender_domain", senderDomain).order("occurred_at", { ascending: false }).limit(6)
    : Promise.resolve({ data: [] });
  const recentQuery = supabase.from("ia_inbox_messages")
    .select("direction,source,processing_state,category,sender_address,subject,summary,occurred_at")
    .eq("user_id", userId).eq("gmail_account_id", gmailAccountId)
    .order("occurred_at", { ascending: false }).limit(5);
  const observationQuery = supabase.from("ia_agent_observations")
    .select("kind,value_text,status,confidence,evidence_count")
    .eq("user_id", userId).in("status", ["observed", "proposed", "confirmed"])
    .order("last_observed_at", { ascending: false }).limit(20);
  const [{ data: threadMessages }, { data: senderMessages }, { data: recentMessages }, { data: observations }] = await Promise.all([
    threadQuery, senderQuery, recentQuery, observationQuery,
  ]);

  const formatMessage = (row: any) =>
    `[${clean(row.direction ?? "inbound", 20)} ${clean(row.source, 30)} ${clean(row.processing_state, 20)} ` +
    `${clean(row.category, 30)} ${clean(row.occurred_at, 40)}] ` +
    `${clean(row.sender_address, 160)} — ${clean(row.subject, 200)}\n` +
    `${String(row.summary || row.body_text || "").replace(/\u0000/g, "").slice(0, 700)}`;
  const threadBlock = (threadMessages ?? []).map(formatMessage).join("\n\n");
  const senderBlock = (senderMessages ?? []).map(formatMessage).join("\n\n");
  const recentBlock = (recentMessages ?? []).map(formatMessage).join("\n\n");
  const observationBlock = (observations ?? []).map((row: any) =>
    `${clean(row.status, 20)} ${clean(row.kind, 40)}: ${clean(row.value_text, 160)} ` +
    `(confidence ${Number(row.confidence ?? 0).toFixed(2)}, ${Number(row.evidence_count ?? 0)} evidence)`).join("\n");
  return [
    threadBlock ? `CURRENT THREAD HISTORY:\n${threadBlock}` : "",
    senderBlock ? `SENDER OR BRAND HISTORY:\n${senderBlock}` : "",
    recentBlock ? `RECENT INBOX OUTCOMES:\n${recentBlock}` : "",
    observationBlock ? `NON-AUTHORITATIVE OBSERVATIONS:\n${observationBlock}` : "",
  ].filter(Boolean).join("\n\n").slice(0, 12_000);
}

export async function recordInboxObservations(
  supabase: any,
  userId: string,
  messageId: string,
  candidates: InboxObservationCandidate[],
  senderDomain: string,
): Promise<void> {
  const values: InboxObservationCandidate[] = [...candidates];
  if (senderDomain) values.push({ kind: "recurring_brand", value: senderDomain, confidence: 0.8 });
  const unique = new Map<string, InboxObservationCandidate>();
  for (const candidate of values.slice(0, 12)) {
    if (!OBSERVATION_KINDS.has(candidate.kind)) continue;
    const value = clean(candidate.value, 160);
    if (value.length < 2 || !observationValueAllowed(candidate.kind, value)) continue;
    const confidence = Number.isFinite(candidate.confidence) ? Math.max(0, Math.min(1, candidate.confidence)) : 0;
    unique.set(`${candidate.kind}:${value.toLowerCase()}`, { kind: candidate.kind, value, confidence });
  }
  for (const candidate of unique.values()) {
    const { error } = await supabase.rpc("ia_record_agent_observation", {
      p_user_id: userId,
      p_message_id: messageId,
      p_kind: candidate.kind,
      p_value: candidate.value,
      p_confidence: candidate.confidence,
    });
    if (error) throw new Error("agent_observation_failed");
  }
}
