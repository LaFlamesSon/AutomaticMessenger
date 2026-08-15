import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";

import {
  AUTHORIZED_RUN_TAG,
  AUTHORIZED_SENDER,
  buildReplySubject,
  getResponder,
  isAuthorizedThread,
  normalizeAddress,
} from "./content";

function cleanMessageId(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[\r\n]+/g, " ").trim().slice(0, 998);
  return cleaned || null;
}

export default {
  async email(message: ForwardableEmailMessage): Promise<void> {
    const responder = getResponder(message.to);
    if (!responder) {
      message.setReject("Mailbox unavailable");
      return;
    }

    if (normalizeAddress(message.from) !== AUTHORIZED_SENDER) {
      message.setReject("This test mailbox only accepts the authorized sender");
      return;
    }

    const subject = message.headers.get("subject") ?? "";
    if (!isAuthorizedThread(subject)) {
      message.setReject("This test mailbox only accepts the authorized test thread");
      return;
    }

    const incomingMessageId = cleanMessageId(message.headers.get("message-id"));
    const reply = createMimeMessage();
    if (incomingMessageId) {
      reply.setHeader("In-Reply-To", incomingMessageId);
      reply.setHeader("References", incomingMessageId);
    }
    reply.setSender({ name: responder.name, addr: responder.address });
    reply.setRecipient(AUTHORIZED_SENDER);
    reply.setSubject(buildReplySubject(subject));
    reply.addMessage({ contentType: "text/plain", data: responder.body });

    try {
      await message.reply(
        new EmailMessage(responder.address, AUTHORIZED_SENDER, reply.asRaw()),
      );
      console.log(JSON.stringify({
        event: "negotiation_responder_replied",
        alias: responder.address,
        run: AUTHORIZED_RUN_TAG,
      }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "negotiation_responder_failed",
        alias: responder.address,
        run: AUTHORIZED_RUN_TAG,
        error: error instanceof Error ? error.message : "unknown",
      }));
      message.setReject("The test responder could not generate a reply");
    }
  },
} satisfies ExportedHandler;
