export interface GmailThreadMessage {
  id?: string;
  internalDate?: string;
  labelIds?: string[];
}

export function isOwnerAction(message: GmailThreadMessage): boolean {
  const labels = new Set(message.labelIds ?? []);
  return labels.has("SENT") || labels.has("DRAFT");
}

export function hasLaterOwnerAction(
  candidate: GmailThreadMessage,
  threadMessages: GmailThreadMessage[],
): boolean {
  const candidateIndex = threadMessages.findIndex((message) => message.id === candidate.id);
  if (candidateIndex >= 0) {
    return threadMessages.slice(candidateIndex + 1).some(isOwnerAction);
  }

  const candidateTime = Number(candidate.internalDate);
  if (!Number.isFinite(candidateTime)) return true;
  return threadMessages.some((message) => {
    const messageTime = Number(message.internalDate);
    return Number.isFinite(messageTime) && messageTime > candidateTime && isOwnerAction(message);
  });
}

export function hasEarlierOwnerSent(
  candidate: GmailThreadMessage,
  threadMessages: GmailThreadMessage[],
): boolean {
  const isSent = (message: GmailThreadMessage) => (message.labelIds ?? []).includes("SENT");
  const candidateIndex = threadMessages.findIndex((message) => message.id === candidate.id);
  if (candidateIndex >= 0) return threadMessages.slice(0, candidateIndex).some(isSent);

  const candidateTime = Number(candidate.internalDate);
  if (!Number.isFinite(candidateTime)) return false;
  return threadMessages.some((message) => {
    const messageTime = Number(message.internalDate);
    return Number.isFinite(messageTime) && messageTime < candidateTime && isSent(message);
  });
}
