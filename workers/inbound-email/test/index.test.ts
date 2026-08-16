import { describe, expect, it } from "vitest";
import type { Email } from "postal-mime";
import { aliasToken, inboundPayload, signPayload } from "../src/index";

function message(overrides: Partial<ForwardableEmailMessage> = {}): ForwardableEmailMessage {
  return {
    from: "brand@example.com",
    to: "uabcdefghijklmnopqrstuvwxyz123456@inbound.getcaughtup.io",
    raw: new ReadableStream<Uint8Array>(),
    rawSize: 321,
    headers: new Headers(),
    setReject() {},
    async forward() { return { messageId: "x" }; },
    async reply() { return { messageId: "x" }; },
    ...overrides,
  };
}

describe("inbound email envelope", () => {
  it("accepts tokenized CaughtUp mailboxes, stable aliases, and rejects unknown addresses", () => {
    expect(aliasToken("uabcdefghijklmnopqrstuvwxyz123456@inbound.getcaughtup.io"))
      .toBe("abcdefghijklmnopqrstuvwxyz123456");
    expect(aliasToken("inbox+abcdefghijklmnopqrstuvwxyz123456@inbound.getcaughtup.io"))
      .toBe("abcdefghijklmnopqrstuvwxyz123456");
    expect(aliasToken("yafet2132@getcaughtup.io")).toBe("yafet2132");
    expect(aliasToken("yafet2132@inbound.getcaughtup.io")).toBe("yafet2132");
    expect(aliasToken("support@getcaughtup.io")).toBeNull();
    expect(aliasToken("inbox@inbound.getcaughtup.io")).toBeNull();
    expect(aliasToken("inbox+abc@example.com")).toBeNull();
  });

  it("minimizes parsed email data and keeps RFC thread headers", () => {
    const email: Email = {
      headers: [
        { key: "from", originalKey: "From", value: "Brand Team <brand@example.com>" },
        { key: "to", originalKey: "To", value: "creator@gmail.com" },
      ],
      headerLines: [],
      subject: "Campaign brief",
      text: "Hello creator",
      messageId: "<one@example.com>",
      inReplyTo: "<prior@example.com>",
      references: "<root@example.com> <prior@example.com>",
      attachments: [],
    };
    const payload = inboundPayload(message(), email, "abcdefghijklmnopqrstuvwxyz123456");
    expect(payload).toMatchObject({
      envelope_from: "brand@example.com",
      from: "Brand Team <brand@example.com>",
      original_to: "creator@gmail.com",
      message_id: "<one@example.com>",
      in_reply_to: "<prior@example.com>",
      references: "<root@example.com> <prior@example.com>",
      text: "Hello creator",
    });
    expect(payload).not.toHaveProperty("html");
  });

  it("preserves only Gmail forwarding control data from an HTML confirmation", () => {
    const url = "https://mail-settings.google.com/mail/vf-%5Btoken%5D-proof";
    const email: Email = {
      headers: [{ key: "from", originalKey: "From", value: "Gmail Team <forwarding-noreply@google.com>" }],
      headerLines: [],
      subject: "(#12345678) Gmail Forwarding Confirmation - Receive Mail",
      html: `<p>Confirm forwarding</p><a href="${url}">Confirm</a>`,
      attachments: [],
    };
    const payload = inboundPayload(message({ from: "forwarding-noreply@google.com" }), email, "abcdefghijklmnopqrstuvwxyz123456");
    expect(payload.text).toContain("Confirmation code: 12345678");
    expect(payload.text).toContain(url);
    expect(payload).not.toHaveProperty("html");
  });

  it("extracts Gmail forwarding controls from quoted-printable raw MIME in memory", () => {
    const url = "https://mail-settings.google.com/mail/vf-%5Braw-token%5D-proof";
    const email: Email = {
      headers: [{ key: "from", originalKey: "From", value: "Gmail Team <forwarding-noreply@google.com>" }],
      headerLines: [],
      subject: "Gmail Forwarding Confirmation - Receive Mail",
      html: "<p>Confirm forwarding</p>",
      attachments: [],
    };
    const raw = new TextEncoder().encode(
      `Confirmation code: 87654321\r\n${url.slice(0, 55)}=\r\n${url.slice(55).replace("=", "=3D")}`,
    ).buffer as ArrayBuffer;
    const payload = inboundPayload(
      message({ from: "forwarding-noreply@google.com" }),
      email,
      "abcdefghijklmnopqrstuvwxyz123456",
      raw,
    );
    expect(payload.text).toContain("Confirmation code: 87654321");
    expect(payload.text).toContain(url);
  });

  it("produces P-256 signatures without exposing the private key", async () => {
    const pair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"],
    );
    const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
    const label = "PRIVATE KEY";
    const privateKeyPem = `-----BEGIN ${label}-----\n${pkcs8.match(/.{1,64}/g)?.join("\n")}\n-----END ${label}-----`;
    const signature = await signPayload(privateKeyPem, "123", '{"ok":true}');
    expect(signature).toMatch(/^[0-9a-f]{128}$/);
  });
});
