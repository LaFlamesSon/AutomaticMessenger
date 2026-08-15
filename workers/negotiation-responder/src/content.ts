export const AUTHORIZED_SENDER = "yafet2132@gmail.com";
export const AUTHORIZED_RUN_TAG = "CUCF20-20260814B";

export type ResponderConfig = Readonly<{
  address: string;
  name: string;
  body: string;
}>;

export const RESPONDERS: Readonly<Record<string, ResponderConfig>> = Object.freeze({
  "cedar-stone@getcaughtup.io": Object.freeze({
    address: "cedar-stone@getcaughtup.io",
    name: "Cedar and Stone",
    body: "Thanks for clarifying. Before we update the billing contact, could you confirm whether campaign documents should use your creator name or business name?",
  }),
  "morrow-goods@getcaughtup.io": Object.freeze({
    address: "morrow-goods@getcaughtup.io",
    name: "Morrow Goods",
    body: "Thanks for getting back to us. Which product category feels most natural for your audience, and are there any content formats you prefer to avoid?",
  }),
  "harbor-creative@getcaughtup.io": Object.freeze({
    address: "harbor-creative@getcaughtup.io",
    name: "Harbor Creative",
    body: "Thanks, this helps. Could you also share whether you prefer a single concept direction or two options for review?",
  }),
  "field-notes@getcaughtup.io": Object.freeze({
    address: "field-notes@getcaughtup.io",
    name: "Field Notes",
    body: "Thanks for the context. Would a dedicated issue or a short sponsored section feel more natural to your readers?",
  }),
  "solace-beauty@getcaughtup.io": Object.freeze({
    address: "solace-beauty@getcaughtup.io",
    name: "Solace Beauty",
    body: "Thanks for reviewing. Are there any clauses or deliverable details you would like the campaign team to clarify before you proceed?",
  }),
  "nova-hydration@getcaughtup.io": Object.freeze({
    address: "nova-hydration@getcaughtup.io",
    name: "Nova Hydration",
    body: "Thanks for your interest. Would you prefer details focused on creator campaigns, retail partnerships, or both?",
  }),
});

export function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function getResponder(recipient: string): ResponderConfig | null {
  return RESPONDERS[normalizeAddress(recipient)] ?? null;
}

export function isAuthorizedThread(subject: string): boolean {
  const normalized = subject.replace(/[\r\n]+/g, " ").trim();
  return normalized.includes(`[${AUTHORIZED_RUN_TAG}-`);
}

export function buildReplySubject(subject: string): string {
  const cleaned = subject.replace(/[\r\n]+/g, " ").trim().slice(0, 180);
  const withoutReplyPrefix = cleaned.replace(/^(?:\s*re:\s*)+/i, "");
  return `Re: ${withoutReplyPrefix || "CaughtUp negotiation test"}`;
}
