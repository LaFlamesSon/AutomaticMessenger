#!/usr/bin/env node
/**
 * CaughtUp forwarding-path stress harness (send-only / CAF hop).
 *
 * Exercises the live Gmail → CAF → Cloudflare → inbound-email → Today pipeline
 * and reports what landed in ia_processed_emails plus the extension digest feed.
 *
 * Requires QA_SERVICE_KEY (Supabase service role) in the environment or .env.local.
 * Hop mode also needs a second connected Gmail account (HARNESS_SENDER_EMAIL).
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { SCENARIOS, CHAINS, GROUPS, PHASES, SAFETY_PATTERNS } from './scenario-content.mjs';
import { senderFor } from './sender-pool.mjs';

const ROOT = process.cwd();
const PROJECT = process.env.HARNESS_PROJECT ?? "xkrpxvswdkreglmefuot";
const BASE = `https://${PROJECT}.supabase.co`;
const SENDER_EMAIL = (process.env.HARNESS_SENDER_EMAIL ?? "carolynpaezz.mgmt@gmail.com").toLowerCase();
const RUN_TAG = process.env.HARNESS_RUN_TAG ?? `FWD-STRESS-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;

const ACCOUNTS = {
  yafet2132: { email: 'yafet2132@gmail.com', alias: 'yafet2132@inbound.getcaughtup.io', type: 'aged' },
  burner: { email: '90210burner@gmail.com', alias: '90210burner@inbound.getcaughtup.io', type: 'fresh' },
  workspace: { email: 'support@getcaughtup.io', alias: 'cu-support2@inbound.getcaughtup.io', type: 'fresh' },
};

const args = process.argv.slice(2);
const FLAGS = {
  target: 'yafet2132',
  group: '',
  phase: '',
  mode: 'inject',
  dryRun: false,
  allowAutoSend: false,
  allowSend: false,
  allowFixtures: false,
  allowAgedFixtures: false,
  verbose: false,
  pause: false,
  resume: false,
  forceReset: false,
};

const positional = [];
for (const arg of args) {
  if (arg.startsWith('--target=')) FLAGS.target = arg.split('=')[1];
  else if (arg.startsWith('--group=')) FLAGS.group = arg.split('=')[1];
  else if (arg.startsWith('--phase=')) FLAGS.phase = arg.split('=')[1];
  else if (arg.startsWith('--mode=')) FLAGS.mode = arg.split('=')[1];
  else if (arg === '--dry-run') FLAGS.dryRun = true;
  else if (arg === '--allow-auto-send') FLAGS.allowAutoSend = true;
  else if (arg === '--allow-send') FLAGS.allowSend = true;
  else if (arg === '--allow-fixtures') FLAGS.allowFixtures = true;
  else if (arg === '--allow-aged-fixtures') FLAGS.allowAgedFixtures = true;
  else if (arg === '--verbose') FLAGS.verbose = true;
  else if (arg === '--pause') FLAGS.pause = true;
  else if (arg === '--resume') FLAGS.resume = true;
  else if (arg === '--force-reset') FLAGS.forceReset = true;
  else if (!arg.startsWith('--')) positional.push(arg);
}
const command = positional[0];

if (!['inject', 'hop'].includes(FLAGS.mode)) {
  console.error(`Invalid --mode=${FLAGS.mode}. Expected inject or hop.`);
  process.exit(1);
}

function getStatePaths(target) {
  return {
    state: path.join(ROOT, ".tmp", `${RUN_TAG}-${target}-state.json`),
    results: path.join(ROOT, ".tmp", `${RUN_TAG}-${target}-results.json`),
    maturity: path.join(ROOT, ".tmp", `${RUN_TAG}-${target}-maturity.json`),
  };
}

loadEnvLocal();

const needsServiceKey = Boolean(command) && command !== 'scorecard' && !FLAGS.dryRun;
if (needsServiceKey && !process.env.QA_SERVICE_KEY) {
  try {
    const raw = execFileSync("npx", ["--yes", "supabase@latest", "projects", "api-keys", "--project-ref", PROJECT, "-o", "json"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const keys = JSON.parse(raw);
    const service = keys.find((row) => row.id === "service_role" || row.name === "service_role");
    if (service?.api_key) process.env.QA_SERVICE_KEY = service.api_key;
  } catch {
    /* fall through to explicit error below */
  }
}

const serviceKey = process.env.QA_SERVICE_KEY || (FLAGS.dryRun || !needsServiceKey ? "dummy_key_for_local_only" : null);
if (needsServiceKey && !serviceKey) {
  console.error("QA_SERVICE_KEY is required (service role). Set in env or .env.local.");
  process.exit(1);
}

const restHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

function loadEnvLocal() {
  const file = path.join(ROOT, ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env) || !process.env[key]) process.env[key] = value;
  }
}

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

async function request(url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000), ...options });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const error = new Error(`${response.status} ${typeof payload === "string" ? payload.slice(0, 400) : JSON.stringify(payload)}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function requestWithTransientRetry(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await request(url, options);
    } catch (error) {
      lastError = error;
      const transient = error?.status == null || error.status === 429 || error.status >= 500;
      if (!transient || attempt === attempts) throw error;
      await sleep(500 * (2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

async function rest(table, params = {}, options = {}) {
  const url = new URL(`${BASE}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return request(url, {
    headers: { ...restHeaders, ...(options.headers ?? {}) },
    method: options.method ?? "GET",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function api(state, action, body = {}) {
  return request(`${BASE}/functions/v1/agent-api`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-token": state.api_token },
    body: JSON.stringify({ action, ...body }),
  });
}

async function refreshGoogle(refreshToken, cfg) {
  const form = new URLSearchParams({
    client_id: cfg.ia_google_send_client_id,
    client_secret: cfg.ia_google_send_client_secret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  return request("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}

async function gmail(token, endpoint, options = {}) {
  return request(`https://gmail.googleapis.com/gmail/v1/users/me${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });
}

async function runtime(targetName = FLAGS.target, options = {}) {
  const { needsSigningKey = false, needsSenderAuth = false, needsApiToken = false } = options;
  const accountInfo = ACCOUNTS[targetName];
  if (!accountInfo) throw new Error(`Unknown target account: ${targetName}`);
  const targetEmail = accountInfo.email.toLowerCase();

  if (FLAGS.dryRun) {
    return {
      targetName,
      targetEmail,
      target: { id: "dry_run_target_id", user_id: "dry_run_user_id", gmail_address: targetEmail },
      sender: { id: "dry_run_sender_id", gmail_address: SENDER_EMAIL },
      user: { id: "dry_run_user_id", email: targetEmail, api_token: "dry_run_token" },
      api_token: "dry_run_token",
      target_gmail_token: "dry_run_gmail_token",
      sender_gmail_token: "dry_run_sender_token",
      alias: { alias_address: accountInfo.alias, status: "route_verified" },
      profile: { reply_mode: "draft_only", auto_send: false },
      media_kits: [
        { id: "dry_skincare_kit", label: "[HARNESS] Skincare Kit", is_default: false, status: "active" },
        { id: "dry_default_kit", label: "Existing default kit", is_default: true, status: "active" },
      ],
      paths: getStatePaths(targetName),
    };
  }

  const requestedAddresses = needsSenderAuth ? `${targetEmail},${SENDER_EMAIL}` : targetEmail;
  const accounts = await rest("ia_gmail_accounts", {
    select: needsSenderAuth ? "id,user_id,gmail_address,refresh_token,oauth_capability" : "id,user_id,gmail_address,oauth_capability",
    gmail_address: `in.(${requestedAddresses})`,
  });
  const target = accounts.find((row) => row.gmail_address.toLowerCase() === targetEmail);
  const sender = accounts.find((row) => row.gmail_address.toLowerCase() === SENDER_EMAIL);
  if (!target) throw new Error(`Target Gmail account not connected: ${targetEmail}`);
  
  const users = await rest("ia_users", {
    select: needsApiToken ? "id,email,api_token" : "id,email",
    id: `eq.${target.user_id}`,
  });
  if (!users[0]) throw new Error("Target user missing");
  if (needsApiToken && !users[0].api_token) throw new Error("Target user api_token missing");

  let cfg = {};
  if (needsSigningKey || needsSenderAuth) {
    const cfgRows = await rest("rpc/ia_get_config", {}, { method: "POST", body: {} });
    cfg = Object.fromEntries(cfgRows.map((row) => [row.name, row.secret]));
  }

  let senderToken = null;
  if (needsSenderAuth && sender?.refresh_token) {
    try {
      senderToken = (await refreshGoogle(sender.refresh_token, cfg)).access_token;
    } catch (e) {
      console.warn(`  [warn] Sender Gmail token refresh failed: ${e.message?.slice(0, 80) ?? e}`);
    }
  }
  
  const aliasRows = await rest("ia_forwarding_aliases", {
    select: "id,alias_address,status,route_verified_at",
    user_id: `eq.${target.user_id}`,
    status: "neq.disabled",
    order: "updated_at.desc",
    limit: "1",
  });
  const profileRows = await rest("ia_voice_profiles", {
    select: "reply_mode,auto_send,auto_send_categories,draft_categories,settings_version",
    user_id: `eq.${target.user_id}`,
    limit: "1",
  });
  const kitRows = await rest("ia_media_kits", {
    select: "id,label,is_default,auto_attach,status",
    user_id: `eq.${target.user_id}`,
    status: "eq.active",
  });
  
  return {
    targetName,
    targetEmail,
    target,
    sender,
    user: users[0],
    api_token: users[0].api_token ?? null,
    sender_gmail_token: senderToken,
    alias: aliasRows[0] ?? null,
    profile: profileRows[0] ?? null,
    media_kits: kitRows,
    paths: getStatePaths(targetName),
    signingKey: needsSigningKey ? cfg.ia_inbound_signing_private_key ?? null : null,
  };
}

function marker(scenarioId) {
  return `[${RUN_TAG} ${scenarioId}]`;
}

function subjectFor(scenarioId, scenario) {
  if (typeof scenario.subject === 'function') {
    return scenario.subject(`${RUN_TAG} ${scenarioId}`);
  }
  return `${marker(scenarioId)} ${scenario.subject}`;
}

function makeMime(from, to, subject, body, extraHeaders = []) {
  const messageId = `<${RUN_TAG}-${scenarioIdSafe(subject)}-${crypto.randomUUID().slice(0, 8)}@getcaughtup.io>`;
  return {
    messageId,
    raw: [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      ...extraHeaders,
      "",
      body,
    ].join("\r\n"),
  };
}

function scenarioIdSafe(subject) {
  return subject.replace(/[^a-z0-9]+/gi, "-").slice(0, 24).toLowerCase();
}

async function sendHop(rt, scenarioId, scenario, threadHeaders = []) {
  if (!FLAGS.dryRun && !FLAGS.allowSend) {
    throw new Error('Hop mode sends real Gmail messages and requires --allow-send.');
  }
  if (!rt.sender_gmail_token && !FLAGS.dryRun) {
    throw new Error(`Hop mode requires connected sender account: ${SENDER_EMAIL}`);
  }
  const subject = subjectFor(scenarioId, scenario);
  const mime = makeMime(SENDER_EMAIL, rt.targetEmail, subject, scenario.body, threadHeaders);
  
  const runRecord = {
    scenarioId,
    subject,
    messageId: mime.messageId,
    sentAt: new Date().toISOString(),
    threadHeaders,
    dryRun: Boolean(FLAGS.dryRun),
  };

  const stateData = readJson(rt.paths.state, { runs: [] });
  stateData.runs.push(runRecord);
  writeJson(rt.paths.state, stateData);

  if (FLAGS.dryRun) {
    console.log(`[DRY-RUN] Recorded hop scenario ${scenarioId} with subject: ${subject}`);
    return runRecord;
  }

  await gmail(rt.sender_gmail_token, "/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: b64url(mime.raw) }),
  });
  return runRecord;
}

function signEcdsa(privateKeyPem, timestamp, body) {
  const signer = crypto.createSign('SHA256');
  signer.update(`${timestamp}.${body}`);
  const signature = signer.sign({ key: privateKeyPem, dsaEncoding: 'ieee-p1363' });
  return signature.toString('hex');
}

async function injectDirect(rt, scenarioId, scenario, threadHeaders = {}) {
  const autoSendEnabled = rt.profile?.auto_send === true || rt.profile?.reply_mode === 'auto_send';
  if (!FLAGS.dryRun && autoSendEnabled && !FLAGS.allowAutoSend) {
    throw new Error(`Target ${rt.targetName} has Auto-send enabled; inject mode requires --allow-auto-send.`);
  }
  if (!rt.signingKey && !FLAGS.dryRun) {
    throw new Error('Inject mode requires ia_inbound_signing_private_key in Supabase Vault config.');
  }
  if (!rt.alias && !FLAGS.dryRun) {
    throw new Error(`No active forwarding alias for ${rt.targetName}`);
  }

  const subject = subjectFor(scenarioId, scenario);
  const sender = senderFor(scenarioId);
  const senderEmail = sender.envelopeFrom;
  const senderDisplay = sender.fromHeader;
  const messageId = `<${RUN_TAG}-${scenarioId}-${crypto.randomUUID().slice(0, 8)}@getcaughtup.io>`;

  const aliasAddress = rt.alias?.alias_address ?? `${rt.targetName}@inbound.getcaughtup.io`;
  const aliasToken = aliasAddress.split('@')[0].toLowerCase();

  const extraHeaders = scenario.headers ?? {};
  const payload = {
    alias_token: aliasToken,
    envelope_from: senderEmail,
    envelope_to: aliasAddress,
    from: senderDisplay,
    reply_to: senderDisplay,
    original_to: rt.targetEmail,
    subject,
    text: scenario.body,
    message_id: messageId,
    in_reply_to: threadHeaders.inReplyTo ?? '',
    references: threadHeaders.references ?? '',
    precedence: extraHeaders.Precedence ?? '',
    auto_submitted: extraHeaders['Auto-Submitted'] ?? '',
    list_unsubscribe: Boolean(extraHeaders['List-Unsubscribe']),
    received_at: new Date().toISOString(),
    raw_size: Buffer.byteLength(scenario.body, 'utf8') + 500,
    attachments: [],
    authentication_results: '',
  };

  const runRecord = {
    scenarioId,
    subject,
    messageId,
    senderEmail,
    sentAt: new Date().toISOString(),
    mode: 'inject',
    dryRun: Boolean(FLAGS.dryRun),
    ...(FLAGS.dryRun ? { payload } : {}),
  };

  const stateData = readJson(rt.paths.state, { runs: [] });
  stateData.runs.push(runRecord);
  writeJson(rt.paths.state, stateData);

  if (FLAGS.dryRun) {
    console.log(`[DRY-RUN] ${JSON.stringify(payload)}`);
    return runRecord;
  }

  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signEcdsa(rt.signingKey, timestamp, body);

  const resp = await requestWithTransientRetry(`${BASE}/functions/v1/inbound-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-caughtup-timestamp': timestamp,
      'x-caughtup-signature': signature,
    },
    body,
  });
  if (resp?.discarded) throw new Error(`Inbound injection discarded ${scenarioId}: ${resp.discarded}`);
  runRecord.response = resp;
  writeJson(rt.paths.state, stateData);
  if (FLAGS.verbose) console.log(`  Edge Function response:`, JSON.stringify(resp));
  return runRecord;
}

async function pollProcessed(rt, subject, timeoutMs = 180_000) {
  const markerMatch = subject.match(/^\[[^\]]+\]/);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const params = markerMatch
      ? {
          select: "id,thread_id,category,summary,draft_text,delivery_status,sent_via,auto_sent,human_review_required,negotiation_id,ingestion_source,is_test,selected_media_kit_id,processed_at,subject",
          gmail_account_id: `eq.${rt.target.id}`,
          subject: `like.${markerMatch[0]}*`,
          order: "processed_at.desc",
          limit: "1",
        }
      : {
          select: "id,thread_id,category,summary,draft_text,delivery_status,sent_via,auto_sent,human_review_required,negotiation_id,ingestion_source,is_test,selected_media_kit_id,processed_at,subject",
          gmail_account_id: `eq.${rt.target.id}`,
          subject: `eq.${subject}`,
          order: "processed_at.desc",
          limit: "1",
        };
    try {
      const rows = await rest("ia_processed_emails", params);
      if (rows[0]) return rows[0];
    } catch {
      /* transient network error during long polling loop — retry */
    }
    await sleep(3000);
  }
  return null;
}

async function pollInbound(rt, subject, timeoutMs = 180_000) {
  const markerMatch = subject.match(/^\[[^\]]+\]/);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const params = markerMatch
      ? {
          select: "id,subject,processing_status,text_body,received_at",
          user_id: `eq.${rt.target.user_id}`,
          subject: `like.${markerMatch[0]}*`,
          order: "received_at.desc",
          limit: "1",
        }
      : {
          select: "id,subject,processing_status,text_body,received_at",
          user_id: `eq.${rt.target.user_id}`,
          subject: `eq.${subject}`,
          order: "received_at.desc",
          limit: "1",
        };
    try {
      const rows = await rest("ia_inbound_messages", params);
      if (rows[0]) return rows[0];
    } catch {
      /* transient network error during long polling loop — retry */
    }
    await sleep(3000);
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function zonedLocalToIso(value, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const desired = match.slice(1).map(Number);
  const desiredUtc = Date.UTC(desired[0], desired[1] - 1, desired[2], desired[3], desired[4]);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, hour12: false, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  let instant = desiredUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute));
    const adjustment = desiredUtc - observed;
    instant += adjustment;
    if (adjustment === 0) break;
  }
  return new Date(instant).toISOString();
}

function nextWeekdayAtIso(weekday, hour, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const localDate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  const offset = ((weekday - localDate.getUTCDay() + 7) % 7) || 7;
  localDate.setUTCDate(localDate.getUTCDate() + offset);
  const date = `${localDate.getUTCFullYear()}-${String(localDate.getUTCMonth() + 1).padStart(2, '0')}-${String(localDate.getUTCDate()).padStart(2, '0')}`;
  return zonedLocalToIso(`${date}T${String(hour).padStart(2, '0')}:00`, timeZone);
}

function evaluate(scenarioId, scenario, subject, processed, inbound, digestEmail, mediaKits = [], fixture = null) {
  const expect = scenario.expects ?? {};
  const checks = [];
  const skips = [];
  const safetyViolations = [];
  const pass = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    return ok;
  };

  pass("inbound_received", Boolean(inbound), inbound?.processing_status ?? "missing");
  pass("processed_row", Boolean(processed), processed?.category ?? "missing");
  
  if (processed) {
    if (expect.category) {
      const match = Array.isArray(expect.category) 
        ? expect.category.includes(processed.category)
        : expect.category === processed.category;
      pass("category", match, `${processed.category} (expected ${expect.category})`);
    }
    if (expect.draft === true) pass("draft_present", Boolean(processed.draft_text?.trim()), "Draft found/missing");
    if (expect.draft === false) pass("no_draft", !processed.draft_text?.trim(), "Draft absent/found");
    if (expect.negotiation === true) pass("negotiation_linked", Boolean(processed.negotiation_id), processed.negotiation_id ?? "none");
    if (expect.negotiation === false) pass("negotiation_not_linked", !processed.negotiation_id, processed.negotiation_id ?? "none");
    if (expect.kit) pass("kit_linked", processed.selected_media_kit_id === expect.kit, `kit=${processed.selected_media_kit_id}`);

    if (scenario.kitAssert) {
      const selectedKit = mediaKits.find((kit) => kit.id === processed.selected_media_kit_id);
      const expected = scenario.kitAssert.expectedKitLabel
        ? selectedKit?.label === scenario.kitAssert.expectedKitLabel
        : scenario.kitAssert.expectedDefault === true
          ? selectedKit?.is_default === true
          : Boolean(selectedKit);
      pass("media_kit_match", expected, `selected=${selectedKit?.label ?? "none"}`);
    }
    
    // Rule delivery override check
    if (expect.delivery) {
      pass("delivery_override", processed.delivery_status === expect.delivery, `delivery=${processed.delivery_status}`);
    }
    if (scenario.ruleAssert?.delivery) {
      const allowed = scenario.ruleAssert.delivery === "auto_send_or_draft"
        ? ["auto_send", "draft"]
        : [scenario.ruleAssert.delivery];
      pass("sender_rule_delivery", allowed.includes(processed.delivery_status), `delivery=${processed.delivery_status}`);
    }

    // Safety violations
    if (processed.draft_text) {
      for (const [name, regexes] of Object.entries(SAFETY_PATTERNS || {})) {
        for (const regex of (Array.isArray(regexes) ? regexes : [regexes])) {
          const match = processed.draft_text.match(regex);
          const allowedConfiguredPhone = name === 'no_contact_leak' && match && fixture?.phone_number &&
            match[0].replace(/\D/g, '') === fixture.phone_number.replace(/\D/g, '');
          if (match && !allowedConfiguredPhone) {
            safetyViolations.push(name);
            break;
          }
        }
      }
      pass("safety_patterns", safetyViolations.length === 0, `violations: ${safetyViolations.join(', ')}`);
      
      // Calendar contact injection
      if (expect.calendarContact) {
         pass("calendar_contact", processed.draft_text.includes(expect.calendarContact), "Calendar contact injection");
      }
    }
    
    // Hostile
    if (expect.hostile) {
      pass("hostile_rejected", processed.category === "spam_or_poor_fit" && !processed.draft_text?.trim(), `category=${processed.category}`);
    }

    if (scenario.calendarAssert) {
      const draft = String(processed.draft_text ?? "");
      if (scenario.calendarAssert.mustContain === "booking_url_or_slots") {
        pass("calendar_contact", /https:\/\/|\b(?:Mon|Tue|Wed|Thu|Fri|Saturday|Sunday)\b.*\b(?:AM|PM)\b/i.test(draft), "booking URL or offered slot");
      } else if (scenario.calendarAssert.mustContain === "phone_number") {
        pass("calendar_contact", Boolean(fixture?.phone_number) && draft.includes(fixture.phone_number), `phone=${fixture?.phone_number ?? "missing fixture"}`);
      }
      if (scenario.calendarAssert.mustNotContain) {
        pass("calendar_contact_hidden", !/(?:https:\/\/|\+?1?[\s().-]*\d{3}[\s().-]*\d{3}[\s.-]*\d{4})/i.test(draft), "no phone number or booking URL");
      }
      if (scenario.calendarAssert.mustExclude === "tuesday_10am_conflict") {
        pass("booking_conflict_excluded", !/(?:Tue(?:sday)?[^\n.]{0,45})?\b10(?::00)?\s*(?:AM|a\.m\.)\b/i.test(draft), "Tuesday 10 AM is not offered");
      }
    }
  }

  if (scenario.negotiationAssert?.requiresCreatorReply) {
    skips.push({ name: "creator_first_negotiation", reason: "requires a real creator send before a brand reply" });
  }

  const inDigest = digestEmail
    ? digestEmail.some((row) => row.subject === subject || row.summary?.includes(marker(scenarioId)))
    : null;
  const hiddenByExtension = ['low_priority', 'spam_or_poor_fit'].includes(processed?.category);
  const inTodayUi = inDigest === null ? null : inDigest && !hiddenByExtension;
  const todayDetail = inDigest === null ? 'digest unavailable' : `ui=${inTodayUi}, digest=${inDigest}`;
  if (expect.todayVisible === true) pass("today_visible", inTodayUi === true, todayDetail);
  if (expect.todayVisible === false) pass("today_hidden", inTodayUi === false, todayDetail);

  const draftWordCount = processed?.draft_text ? processed.draft_text.split(/\s+/).length : null;

  const isPass = checks.every((c) => c.ok);
  const status = isPass ? 'PASS' : 'FAIL';

  return {
    scenarioId,
    status,
    checks,
    skips,
    processed,
    inbound,
    draftWordCount,
    safetyViolations,
  };
}

async function cmdSetup() {
  const rt = await runtime();
  const phaseNum = FLAGS.phase;
  const phaseFixtures = phaseNum && PHASES[phaseNum] ? PHASES[phaseNum].fixturesBefore : [];
  if (!phaseFixtures.length) {
    console.log(`Phase ${phaseNum}: no fixtures to install.`);
    return;
  }
  console.log(`Setting up Phase ${phaseNum} fixtures for ${rt.targetName}: ${phaseFixtures.join(', ')}`);

  if (FLAGS.dryRun) {
    console.log(`[DRY-RUN] Would install fixtures: ${phaseFixtures.join(', ')}`);
    return;
  }

  if (!FLAGS.allowFixtures) {
    throw new Error('Fixture setup changes account settings and requires --allow-fixtures.');
  }
  if (ACCOUNTS[rt.targetName].type === 'aged' && !FLAGS.allowAgedFixtures) {
    throw new Error('Fixture setup on an aged account also requires --allow-aged-fixtures.');
  }
  await ensureFixtureSnapshot(rt);

  if (phaseFixtures.includes('voice_profile')) {
    console.log('  Installing voice profile (display_name, signoff, tone)...');
    const updated = await rest('ia_voice_profiles', { user_id: `eq.${rt.user.id}` }, {
      method: 'PATCH',
      body: {
        display_name: 'Carolyn',
        signoff: 'Best, Carolyn',
        tone: 'conversational',
        occupation: 'content creator',
        services: 'TikTok,Instagram Reels,YouTube Shorts',
        settings_version: (rt.profile?.settings_version ?? 0) + 1,
        updated_at: new Date().toISOString(),
      },
    });
    if (updated.length !== 1) throw new Error('Voice profile fixture did not update exactly one row.');
  }

  if (phaseFixtures.includes('media_kits')) {
    console.log('  Creating media kits with rate profiles...');
    const currentDefaults = await rest('ia_media_kits', {
      select: 'id,label', user_id: `eq.${rt.user.id}`, is_default: 'eq.true', status: 'eq.active', limit: '1',
    });
    const existingDefaultLabel = currentDefaults[0]?.label ?? null;
    const kits = [
      { label: '[HARNESS] Skincare Kit', best_for: 'Skincare, beauty, serum, moisturizer collaborations',
        sender_domains: ['lumaderm.com'], keywords: ['skincare', 'serum', 'moisturizer', 'beauty'],
        is_default: false, auto_attach: true },
      { label: '[HARNESS] Tech Kit', best_for: 'Technology, gadgets, smart devices, electronics reviews',
        sender_domains: ['techflow.io', 'gadgetco.io'], keywords: ['tech', 'gadget', 'smart', 'device'],
        is_default: false, auto_attach: true },
      { label: '[HARNESS] Fallback Kit', best_for: 'General creator portfolio and collaboration overview',
        sender_domains: [], keywords: [],
        is_default: existingDefaultLabel == null || existingDefaultLabel === '[HARNESS] Fallback Kit', auto_attach: true },
    ];
    for (const kit of kits) {
      const slug = kit.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const row = {
        user_id: rt.user.id,
        ...kit,
        storage_path: `${rt.user.id}/harness/${slug}.pdf`,
        original_filename: `${slug}.pdf`,
        mime_type: 'application/pdf',
        byte_size: 1,
        status: 'active',
        brand_names: [],
        updated_at: new Date().toISOString(),
      };
      const existing = await rest('ia_media_kits', {
        select: 'id', user_id: `eq.${rt.user.id}`, label: `eq.${kit.label}`, limit: '1',
      });
      const saved = existing[0]
        ? await rest('ia_media_kits', { id: `eq.${existing[0].id}`, user_id: `eq.${rt.user.id}` }, {
          method: 'PATCH', body: row,
        })
        : await rest('ia_media_kits', {}, {
          method: 'POST',
          body: row,
        });
      if (saved.length !== 1) throw new Error(`Media kit fixture failed for ${kit.label}.`);
      console.log(`    Installed: ${kit.label}`);
      if (kit.label.includes('Skincare')) {
        await rest('ia_media_kit_rate_profiles', { on_conflict: 'media_kit_id' }, {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
          body: {
            user_id: rt.user.id,
            media_kit_id: saved[0].id,
            currency: 'USD',
            flat_fee_floor: 300,
            flat_fee_target: 800,
            commission_floor: 5,
            commission_target: 15,
            hybrid_guarantee_floor: 200,
            updated_at: new Date().toISOString(),
          },
        });
        console.log('    Installed rate profile for Skincare Kit (floor=$300, target=$800)');
      }
    }
  }

  if (phaseFixtures.includes('sender_rules')) {
    console.log('  Installing sender rules...');
    const rules = [
      { match_type: 'domain', match_value: 'vip-brand.com', action: 'always_draft', priority: 1 },
      { match_type: 'domain', match_value: 'blocked-spam.net', action: 'never_draft', priority: 2 },
      { match_type: 'domain', match_value: 'review-brand.com', action: 'require_approval', priority: 3 },
    ];
    for (const rule of rules) {
      const saved = await rest('ia_sender_rules', { on_conflict: 'user_id,match_type,match_value,action' }, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: { user_id: rt.user.id, ...rule, enabled: true },
      });
      if (saved.length !== 1) throw new Error(`Sender rule fixture failed for ${rule.match_value}.`);
      console.log(`    Rule: ${rule.action} for ${rule.match_value}`);
    }
  }

  if (phaseFixtures.includes('calendar')) {
    console.log('  Setting calendar preferences (scheduled_call + booking URL)...');
    const calPrefs = {
      user_id: rt.user.id,
      contact_mode: 'scheduled_call',
      booking_url: 'https://cal.com/test',
      timezone: 'America/Los_Angeles',
      weekly_availability: [
        { day: 1, start: '09:00', end: '17:00' },
        { day: 2, start: '09:00', end: '17:00' },
        { day: 3, start: '09:00', end: '17:00' },
        { day: 4, start: '09:00', end: '17:00' },
        { day: 5, start: '09:00', end: '17:00' },
      ],
      updated_at: new Date().toISOString(),
    };
    const saved = await rest('ia_calendar_preferences', { on_conflict: 'user_id' }, {
      method: 'POST',
      body: calPrefs,
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    });
    if (saved.length !== 1) throw new Error('Calendar preference fixture failed.');
  }

  if (phaseFixtures.includes('booking')) {
    console.log('  Creating booking conflict (next Tuesday 10 AM)...');
    const startAt = nextWeekdayAtIso(2, 10, 'America/Los_Angeles');
    if (!startAt) throw new Error('Could not calculate the timezone-aware booking conflict.');
    const endAt = new Date(new Date(startAt).getTime() + 3600000).toISOString();
    const saved = await rest('ia_bookings', { on_conflict: 'user_id,request_id' }, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: {
        user_id: rt.user.id,
        title: '[HARNESS] Tuesday 10 AM Conflict',
        start_at: startAt,
        end_at: endAt,
        status: 'held',
        request_id: `harness:${RUN_TAG}:phase3`,
        updated_at: new Date().toISOString(),
      },
    });
    if (saved.length !== 1) throw new Error('Booking fixture failed.');
  }

  console.log('Setup complete.');
}

async function ensureFixtureSnapshot(rt) {
  if (FLAGS.dryRun) return null;
  const state = readJson(rt.paths.state, { runs: [], chains: {} });
  if (state.fixtureSnapshot) return state.fixtureSnapshot;
  const [voiceRows, calendarRows, senderRuleRows] = await Promise.all([
    rest('ia_voice_profiles', {
      select: 'display_name,signoff,tone,occupation,services,custom_rules,settings_version',
      user_id: `eq.${rt.user.id}`,
      limit: '1',
    }),
    rest('ia_calendar_preferences', {
      select: 'contact_mode,phone_number,booking_url,timezone,weekly_availability',
      user_id: `eq.${rt.user.id}`,
      limit: '1',
    }),
    rest('ia_sender_rules', {
      select: 'match_type,match_value,action,priority,enabled',
      user_id: `eq.${rt.user.id}`,
      match_value: 'in.(vip-brand.com,blocked-spam.net,review-brand.com)',
    }),
  ]);
  state.fixtureSnapshot = {
    captured_at: new Date().toISOString(),
    voice_profile: voiceRows[0] ?? null,
    calendar_preferences: calendarRows[0] ?? null,
    sender_rules: senderRuleRows,
  };
  writeJson(rt.paths.state, state);
  return state.fixtureSnapshot;
}

async function cmdTeardown() {
  const rt = await runtime(FLAGS.target, { needsApiToken: true });
  console.log(`Tearing down test fixtures for ${rt.targetName}...`);
  if (FLAGS.dryRun) {
    console.log('[DRY-RUN] Would remove [HARNESS] media kits and reset calendar preferences.');
    return;
  }
  
  const kits = await rest("ia_media_kits", { user_id: `eq.${rt.user.id}` });
  for (const kit of kits) {
    if (kit.label?.includes("[HARNESS]")) {
      await api(rt, "media_kit_delete", { id: kit.id });
      console.log(`Deleted kit: ${kit.label}`);
    }
  }

  const state = readJson(rt.paths.state, { runs: [], chains: {} });
  const snapshot = state.fixtureSnapshot ?? null;

  await rest('ia_sender_rules', {
    user_id: `eq.${rt.user.id}`,
    match_value: 'in.(vip-brand.com,blocked-spam.net,review-brand.com)',
  }, { method: 'DELETE' });
  if (snapshot?.sender_rules?.length) {
    await rest('ia_sender_rules', { on_conflict: 'user_id,match_type,match_value,action' }, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: snapshot.sender_rules.map((rule) => ({ user_id: rt.user.id, ...rule })),
    });
  }
  await rest('ia_bookings', {
    user_id: `eq.${rt.user.id}`,
    request_id: `eq.harness:${RUN_TAG}:phase3`,
  }, { method: 'DELETE' });

  if (snapshot?.calendar_preferences) {
    await rest('ia_calendar_preferences', { on_conflict: 'user_id' }, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: { user_id: rt.user.id, ...snapshot.calendar_preferences, updated_at: new Date().toISOString() },
    });
  } else if (snapshot) {
    await rest('ia_calendar_preferences', { user_id: `eq.${rt.user.id}` }, { method: 'DELETE' });
  }

  if (snapshot?.voice_profile) {
    const current = await rest('ia_voice_profiles', {
      select: 'settings_version', user_id: `eq.${rt.user.id}`, limit: '1',
    });
    await rest('ia_voice_profiles', { user_id: `eq.${rt.user.id}` }, {
      method: 'PATCH',
      body: {
        ...snapshot.voice_profile,
        settings_version: Number(current[0]?.settings_version ?? snapshot.voice_profile.settings_version ?? 0) + 1,
        updated_at: new Date().toISOString(),
      },
    });
  }

  if (snapshot) {
    delete state.fixtureSnapshot;
    writeJson(rt.paths.state, state);
    console.log('Restored the pre-harness voice, calendar, and sender-rule snapshot.');
  } else {
    console.warn('No pre-harness snapshot exists; original voice and calendar settings cannot be restored automatically.');
  }

  console.log("Teardown complete.");
}

function calendarFixtureFor(scenario) {
  const base = {
    contact_mode: scenario.calendarAssert?.mode ?? 'email_only',
    phone_number: null,
    booking_url: null,
    timezone: 'America/Los_Angeles',
    weekly_availability: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:00' })),
  };
  if (scenario.id === 'F1_scheduled_call') base.booking_url = 'https://cal.com/carolynpaez/30min';
  if (scenario.id === 'F3_phone_mode') base.phone_number = '+14155550199';
  return base;
}

async function prepareScenarioFixture(rt, scenario) {
  if (!scenario.calendarAssert) return null;
  const fixture = calendarFixtureFor(scenario);
  if (FLAGS.dryRun) return fixture;
  if (!FLAGS.allowFixtures) {
    throw new Error(`Calendar scenario ${scenario.id} changes account settings and requires --allow-fixtures.`);
  }
  if (ACCOUNTS[rt.targetName].type === 'aged' && !FLAGS.allowAgedFixtures) {
    throw new Error(`Calendar scenario ${scenario.id} on an aged account also requires --allow-aged-fixtures.`);
  }
  await ensureFixtureSnapshot(rt);
  const saved = await rest('ia_calendar_preferences', { on_conflict: 'user_id' }, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: { user_id: rt.user.id, ...fixture, updated_at: new Date().toISOString() },
  });
  if (saved.length !== 1) throw new Error(`Calendar fixture failed for ${scenario.id}.`);
  return fixture;
}

async function cmdReset() {
  const rt = await runtime();
  if (ACCOUNTS[rt.targetName].type === 'aged' && !FLAGS.forceReset) {
    console.error('REFUSED: reset on aged account (yafet2132) requires --force-reset flag.');
    console.error('This will destroy real production data. Are you sure?');
    process.exit(1);
  }
  console.log(`\n=== Deep-cleaning ALL data for ${rt.targetName} (${rt.targetEmail}) ===`);
  const userId = rt.user.id;
  const accountId = rt.target.id;

  // Order matters — foreign key dependencies
  const cleanupTables = [
    { table: 'ia_negotiation_events', filter: { user_id: `eq.${userId}` }, label: 'negotiation events' },
    { table: 'ia_negotiations',       filter: { user_id: `eq.${userId}` }, label: 'negotiations' },
    { table: 'ia_send_attempts',      filter: { user_id: `eq.${userId}` }, label: 'send attempts' },
    { table: 'ia_processed_emails',   filter: { gmail_account_id: `eq.${accountId}` }, label: 'processed emails' },
    { table: 'ia_inbound_messages',   filter: { user_id: `eq.${userId}` }, label: 'inbound messages' },
    { table: 'ia_agent_observation_evidence', filter: { user_id: `eq.${userId}` }, label: 'observation evidence' },
    { table: 'ia_agent_observations', filter: { user_id: `eq.${userId}` }, label: 'observations' },
    { table: 'ia_inbox_messages',     filter: { user_id: `eq.${userId}` }, label: 'inbox messages' },
    { table: 'ia_inbox_threads',      filter: { user_id: `eq.${userId}` }, label: 'inbox threads' },
    { table: 'ia_sender_rules',       filter: { user_id: `eq.${userId}` }, label: 'sender rules' },
    { table: 'ia_media_kit_rate_profiles', filter: { user_id: `eq.${userId}` }, label: 'rate profiles' },
    { table: 'ia_media_kits',         filter: { user_id: `eq.${userId}` }, label: 'media kits' },
    { table: 'ia_calendar_preferences', filter: { user_id: `eq.${userId}` }, label: 'calendar prefs' },
    { table: 'ia_bookings',           filter: { user_id: `eq.${userId}` }, label: 'bookings' },
    { table: 'ia_chat_messages',      filter: { user_id: `eq.${userId}` }, label: 'chat messages' },
    { table: 'ia_draft_edits',        filter: { user_id: `eq.${userId}` }, label: 'draft edits' },
  ];

  if (FLAGS.dryRun) {
    for (const { table, filter } of cleanupTables) {
      console.log(`[DRY-RUN] DELETE ${table} ${JSON.stringify(filter)}`);
    }
    console.log(`[DRY-RUN] PATCH ia_voice_profiles user_id=eq.${userId} to bare defaults`);
    return;
  }

  for (const { table, filter, label } of cleanupTables) {
    try {
      await rest(table, filter, { method: 'DELETE' });
      console.log(`  ✓ Cleaned ${label}`);
    } catch (e) {
      // A partial reset is unsafe; fail instead of claiming the account is bare.
      throw new Error(`Failed to clean ${label}: ${e.message}`);
    }
  }

  // Reset voice profile to bare defaults (don't delete — row must exist for processing)
  try {
    const resetProfiles = await rest('ia_voice_profiles', { user_id: `eq.${userId}` }, {
      method: 'PATCH',
      body: {
        display_name: '', signoff: '', tone: '', occupation: '',
        services: '', custom_rules: '',
        always_ask: ['project scope', 'budget range', 'timeline', 'what brand materials they already have'],
        settings_version: 1,
        reply_mode: 'draft_only', auto_send: false,
        auto_send_confirmed_at: null, auto_send_policy_version: null,
        auto_send_categories: [], draft_categories: ['urgent', 'action_needed'],
        timezone: 'America/Los_Angeles', updated_at: new Date().toISOString(),
      },
    });
    if (resetProfiles.length !== 1) throw new Error('Voice profile reset did not update exactly one row.');
    console.log('  ✓ Reset voice profile to bare defaults');
  } catch (e) {
    console.error('  ✗ Voice profile reset failed:', e.message);
    throw e;
  }

  // Clean up state files
  for (const file of Object.values(rt.paths)) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  console.log('  ✓ Cleaned local state files');
  console.log(`\nDeep-clean complete. ${rt.targetName} is now a bare account.\n`);
}

async function cmdInspect() {
  const rt = await runtime(FLAGS.target, { needsApiToken: true });
  const recentProcessed = await rest("ia_processed_emails", {
    select: "id,subject,category,delivery_status,ingestion_source,is_test,processed_at",
    gmail_account_id: `eq.${rt.target.id}`,
    order: "processed_at.desc",
    limit: "8",
  });
  const recentInbound = await rest("ia_inbound_messages", {
    select: "id,subject,processing_status,received_at",
    user_id: `eq.${rt.target.user_id}`,
    order: "received_at.desc",
    limit: "8",
  });
  const negotiations = await rest("ia_negotiations", {
    select: "id,brand_name,stage,human_review_required,last_inbound_at",
    user_id: `eq.${rt.target.user_id}`,
    dismissed_at: "is.null",
    order: "last_inbound_at.desc",
    limit: "5",
  });
  const forwarding = await api(rt, "forwarding_setup_get").catch((error) => ({ error: error.message }));
  const digest = await api(rt, "digest").catch((error) => ({ error: error.message }));

  const report = {
    run_tag: RUN_TAG,
    target: rt.targetEmail,
    sender: SENDER_EMAIL,
    alias: rt.alias,
    profile: rt.profile,
    media_kits: rt.media_kits.length,
    forwarding,
    today_counts: digest.error ? digest : {
      emails: digest.emails?.length ?? 0,
      negotiations: digest.negotiations?.length ?? 0,
      categories: (digest.emails ?? []).reduce((acc, row) => {
        acc[row.category] = (acc[row.category] ?? 0) + 1;
        return acc;
      }, {}),
    },
    recent_inbound: recentInbound,
    recent_processed: recentProcessed,
    active_negotiations: negotiations,
  };
  console.log(JSON.stringify(report, null, 2));
}

async function cmdFire() {
  const rt = await runtime(FLAGS.target, {
    needsSigningKey: FLAGS.mode === 'inject',
    needsSenderAuth: FLAGS.mode === 'hop',
  });
  const previousState = readJson(rt.paths.state, {});
  writeJson(rt.paths.state, {
    runs: FLAGS.resume ? previousState.runs ?? [] : [],
    chains: previousState.chains ?? {},
    ...(previousState.fixtureSnapshot ? { fixtureSnapshot: previousState.fixtureSnapshot } : {}),
  });
  const rawTargets = FLAGS.group ? FLAGS.group.split(',') : Object.keys(GROUPS).filter(g => !GROUPS[g].apiOnly);
  
  console.log(`Firing targets: ${rawTargets.join(', ')} for ${rt.targetName} (mode=${FLAGS.mode})`);
  
  const scenariosToFire = [];
  for (const item of rawTargets) {
    const key = item.trim();
    if (GROUPS[key]) {
      const ids = GROUPS[key].ids || GROUPS[key];
      scenariosToFire.push(...ids);
    } else if (SCENARIOS[key]) {
      scenariosToFire.push(key);
    }
  }

  const changesCalendar = scenariosToFire.some((scenarioId) => SCENARIOS[scenarioId]?.calendarAssert);
  if (!FLAGS.dryRun && changesCalendar && !FLAGS.allowFixtures) {
    throw new Error('Calendar scenarios change account settings and require --allow-fixtures.');
  }
  if (!FLAGS.dryRun && changesCalendar && ACCOUNTS[rt.targetName].type === 'aged' && !FLAGS.allowAgedFixtures) {
    throw new Error('Calendar scenarios on an aged account also require --allow-aged-fixtures.');
  }

  let count = 0;
  for (const scenarioId of scenariosToFire) {
    const scenario = SCENARIOS[scenarioId];
    if (!scenario || scenario.apiOnly) continue;
    
    const isSequential = ['D', 'F'].includes(scenario.group) || CHAINS.negotiation_main?.steps?.includes(scenarioId);
    const fixture = await prepareScenarioFixture(rt, scenario);
    const stateBeforeSend = readJson(rt.paths.state, { runs: [], chains: {} });
    const chainId = scenario.chainId;
    const chainHeaders = chainId && scenario.chainStep !== 0
      ? stateBeforeSend.chains?.[chainId] ?? {}
      : {};
    
    let row;
    if (FLAGS.mode === 'hop') {
      const hopHeaders = chainHeaders.inReplyTo
        ? [`In-Reply-To: ${chainHeaders.inReplyTo}`, `References: ${chainHeaders.references ?? chainHeaders.inReplyTo}`]
        : [];
      row = await sendHop(rt, scenarioId, scenario, hopHeaders);
    } else {
      row = await injectDirect(rt, scenarioId, scenario, chainHeaders);
    }
    if (chainId) {
      const stateAfterSend = readJson(rt.paths.state, { runs: [], chains: {} });
      stateAfterSend.chains ??= {};
      stateAfterSend.chains[chainId] = {
        inReplyTo: row.messageId,
        references: [chainHeaders.references, row.messageId].filter(Boolean).join(' '),
      };
      writeJson(rt.paths.state, stateAfterSend);
    }
    if (fixture) {
      const stateAfterSend = readJson(rt.paths.state, { runs: [], chains: {} });
      const recorded = stateAfterSend.runs.find((run) => run.messageId === row.messageId);
      if (recorded) recorded.fixture = fixture;
      writeJson(rt.paths.state, stateAfterSend);
    }
    count++;
    console.log(`[${count}/${scenariosToFire.length}] ${FLAGS.mode === 'hop' ? 'Sent' : 'Injected'} ${scenarioId} from ${row.senderEmail ?? SENDER_EMAIL}`);
    
    if (!FLAGS.dryRun) {
      // Jitter: 1-3s between sequential, 500ms-1.5s between parallel
      const delay = isSequential
        ? 1000 + Math.random() * 2000
        : 500 + Math.random() * 1000;
      await sleep(delay);
    }
  }
  console.log(`Fired ${count} scenarios.`);
}

async function cmdWait() {
  const rt = await runtime(FLAGS.target, { needsApiToken: !FLAGS.dryRun });
  const state = readJson(rt.paths.state, { runs: [] });
  if (!state.runs.length) throw new Error("No pending runs in state file.");
  
  const digest = FLAGS.dryRun
    ? { emails: state.runs.filter((run) => SCENARIOS[run.scenarioId]?.expects?.todayVisible === true)
      .map((run) => ({ subject: run.subject, summary: marker(run.scenarioId) })) }
    : await api(rt, "digest").catch(() => ({ emails: [] }));
  const digestEmails = digest.emails ?? [];
  const results = [];
  
  for (const run of state.runs) {
    const scenario = SCENARIOS[run.scenarioId];
    if (!scenario) continue;
    
    let inbound = null;
    let processed = null;
    
    if (FLAGS.dryRun) {
      console.log(`[DRY-RUN] Simulating wait/poll for ${run.subject}…`);
      inbound = { id: `dry_${run.scenarioId}`, subject: run.subject, processing_status: 'processed', received_at: new Date().toISOString() };
      const cat = Array.isArray(scenario.expects?.category) ? scenario.expects.category[0] : (scenario.expects?.category || 'action_needed');
      const selectedKit = scenario.kitAssert?.expectedKitLabel === '[HARNESS] Skincare Kit'
        ? 'dry_skincare_kit'
        : scenario.kitAssert ? 'dry_default_kit' : null;
      let draftText = scenario.expects?.draft === false ? null : 'Thanks for reaching out! I would love to collaborate. Best, Test Creator';
      if (scenario.id === 'F1_scheduled_call') draftText = `Please choose a time at ${run.fixture?.booking_url}. Best, Test Creator`;
      if (scenario.id === 'F2_email_only') draftText = 'Email is the best way to continue. Best, Test Creator';
      if (scenario.id === 'F3_phone_mode') draftText = `You can reach me at ${run.fixture?.phone_number}. Best, Test Creator`;
      if (scenario.id === 'F4_booking_conflict') draftText = 'Would Tuesday at 11:00 AM PT work for you? Best, Test Creator';
      const assertedDelivery = scenario.ruleAssert?.delivery === 'auto_send_or_draft'
        ? 'draft'
        : scenario.ruleAssert?.delivery;
      processed = {
        id: `dry_proc_${run.scenarioId}`,
        category: cat,
        summary: `Dry-run summary for ${run.scenarioId}`,
        draft_text: draftText,
        delivery_status: assertedDelivery || (draftText ? 'draft' : 'none'),
        ingestion_source: 'forwarded',
        is_test: false,
        negotiation_id: scenario.expects?.negotiation ? `dry_neg_${run.scenarioId}` : null,
        selected_media_kit_id: selectedKit,
      };
    } else {
      console.log(`Waiting for ${run.subject}…`);
      [inbound, processed] = await Promise.all([
        pollInbound(rt, run.subject),
        pollProcessed(rt, run.subject),
      ]);
    }
    results.push(evaluate(run.scenarioId, scenario, run.subject, processed, inbound, digestEmails, rt.media_kits, run.fixture));
  }
  
  const summary = {
    run_tag: RUN_TAG,
    total: results.length,
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
    assertion_skip: results.reduce((count, result) => count + result.skips.length, 0),
    results: results.map(({ scenarioId, status, checks, skips, processed, inbound }) => ({
      scenarioId,
      status,
      checks,
      skips,
      category: processed?.category ?? null,
      delivery_status: processed?.delivery_status ?? null,
      inbound_status: inbound?.processing_status ?? null,
    })),
  };
  writeJson(rt.paths.results, summary);
  console.log(JSON.stringify(summary, null, 2));
}

async function cmdVerify() {
  if (!ACCOUNTS[FLAGS.target]) throw new Error(`Unknown target account: ${FLAGS.target}`);
  const summary = readJson(getStatePaths(FLAGS.target).results, null);
  if (!summary) {
    console.log("No results to verify. Run wait first.");
    return false;
  }
  console.log(`Verification results for ${FLAGS.target}:`);
  for (const res of summary.results) {
    console.log(`${res.status.padEnd(5)} | ${res.scenarioId}`);
    if (res.status !== 'PASS' && FLAGS.verbose) {
      console.log(`  Failed checks: ${res.checks.filter(c => !c.ok).map(c => c.name).join(', ')}`);
    }
  }
  return summary.fail === 0;
}

async function cmdChain() {
  const rt = await runtime(FLAGS.target, {
    needsSigningKey: FLAGS.mode === 'inject',
    needsSenderAuth: FLAGS.mode === 'hop',
  });
  console.log("Executing chain scenarios...");
  
  for (const [chainId, chain] of Object.entries(CHAINS || {})) {
    console.log(`Running chain: ${chainId} (${chain.steps.length} steps)`);
    let threadHeaders = {};
    
    for (const stepId of chain.steps) {
      const scenario = SCENARIOS[stepId];
      if (!scenario) { console.error(`  Unknown scenario: ${stepId}`); continue; }

      let sent;
      if (FLAGS.mode === 'hop') {
        const hopHeaders = threadHeaders.inReplyTo
          ? [`In-Reply-To: ${threadHeaders.inReplyTo}`, `References: ${threadHeaders.references ?? threadHeaders.inReplyTo}`]
          : [];
        sent = await sendHop(rt, stepId, scenario, hopHeaders);
      } else {
        sent = await injectDirect(rt, stepId, scenario, threadHeaders);
      }
      
      console.log(`  Waiting for chain step ${stepId}...`);
      const processed = FLAGS.dryRun ? { id: `dry_${stepId}` } : await pollProcessed(rt, sent.subject);
      
      if (processed) {
        threadHeaders = {
          inReplyTo: sent.messageId,
          references: [threadHeaders.references, sent.messageId].filter(Boolean).join(' '),
        };
      }
      if (!FLAGS.dryRun) await sleep(3000);
    }
  }
}

async function cmdApiTest(scenarioIds = null) {
  const rt = await runtime(FLAGS.target, { needsApiToken: true });
  console.log(`Running API tests for ${rt.targetName}...`);
  const selected = scenarioIds ?? Object.values(GROUPS)
    .filter((group) => group.apiOnly)
    .flatMap((group) => group.ids);
  const results = [];
  let digest = null;
  let memory = null;
  const record = (scenarioId, status, detail) => results.push({ scenarioId, status, detail });

  for (const scenarioId of selected) {
    const scenario = SCENARIOS[scenarioId];
    if (!scenario?.apiOnly) continue;
    if (FLAGS.dryRun) {
      record(scenarioId, 'SKIP', 'requires live API state');
      continue;
    }
    try {
      if (['H1_today_visibility', 'H2_negotiation_cards', 'H3_card_structure'].includes(scenarioId)) {
        digest ??= await api(rt, 'digest');
      }
      if (scenarioId === 'H1_today_visibility') {
        const state = readJson(rt.paths.state, { runs: [] });
        const actualBySubject = new Map((digest.emails ?? []).map((row) => [row.subject, row]));
        const mismatches = state.runs.filter((run) => {
          const expected = SCENARIOS[run.scenarioId]?.expects?.todayVisible;
          if (typeof expected !== 'boolean') return false;
          const row = actualBySubject.get(run.subject);
          const visible = Boolean(row) && !['low_priority', 'spam_or_poor_fit'].includes(row.category);
          return visible !== expected;
        });
        const ok = Array.isArray(digest.emails) && Array.isArray(digest.negotiations) && mismatches.length === 0;
        record(scenarioId, ok ? 'PASS' : 'FAIL', mismatches.length
          ? `Today visibility mismatches: ${mismatches.map((run) => run.scenarioId).join(', ')}`
          : `${state.runs.length} current-run card expectation(s) validated`);
      } else if (scenarioId === 'H2_negotiation_cards') {
        if (!digest.negotiations?.length) {
          record(scenarioId, 'SKIP', 'requires a creator-first active negotiation fixture');
        } else {
          const ok = digest.negotiations.every((row) => row.id && row.stage && row.latest_subject && 'draft_email' in row);
          record(scenarioId, ok ? 'PASS' : 'FAIL', `${digest.negotiations.length} active negotiation card(s)`);
        }
      } else if (scenarioId === 'H3_card_structure') {
        const ok = Array.isArray(digest.emails) && digest.emails.every((row) =>
          row.id && row.category && typeof row.subject === 'string' && 'delivery_status' in row && 'ingestion_source' in row);
        record(scenarioId, ok ? 'PASS' : 'FAIL', `${digest.emails?.length ?? 0} email card(s) validated`);
      } else if (scenarioId === 'J1_memory_learned') {
        memory ??= await api(rt, 'memory_get');
        const ok = Array.isArray(memory.observations) && memory.observations.length > 0 &&
          memory.observations.every((row) => row.id && row.kind && typeof row.value_text === 'string') &&
          Array.isArray(memory.evidence);
        record(scenarioId, ok ? 'PASS' : 'FAIL', `${memory.observations?.length ?? 0} observation(s)`);
      } else if (['J3_chat_query', 'J4_chat_rule'].includes(scenarioId)) {
        record(scenarioId, 'SKIP', 'chat writes durable account history and has no lossless teardown fixture');
      } else if (scenarioId === 'I3_draft_send') {
        record(scenarioId, 'SKIP', FLAGS.allowSend
          ? 'requires an explicitly selected live draft and acceptance procedure'
          : 'real Gmail send requires --allow-send and an explicitly selected draft');
      } else {
        record(scenarioId, 'SKIP', `${scenario.verifyFn ?? 'scenario'} is not safely automated yet`);
      }
    } catch (error) {
      record(scenarioId, 'FAIL', error.message ?? String(error));
    }
  }

  const summary = {
    total: results.length,
    pass: results.filter((result) => result.status === 'PASS').length,
    fail: results.filter((result) => result.status === 'FAIL').length,
    skip: results.filter((result) => result.status === 'SKIP').length,
    results,
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

async function cmdScorecard() {
  console.log("Cross-account Scorecard:");
  console.log("Account   | PASS | FAIL | SKIP | TOTAL");
  console.log("--------------------------------------");
  for (const acc of Object.keys(ACCOUNTS)) {
    const paths = getStatePaths(acc);
    const maturity = readJson(paths.maturity, null);
    const phaseResults = Object.values(maturity?.phases ?? {});
    const summary = phaseResults.length
      ? phaseResults.reduce((total, phase) => ({
        pass: total.pass + Number(phase.pass ?? 0) + Number(phase.api?.pass ?? 0),
        fail: total.fail + Number(phase.fail ?? 0) + Number(phase.api?.fail ?? 0),
        skip: total.skip + Number(phase.api?.skip ?? 0),
        total: total.total + Number(phase.total ?? 0) + Number(phase.api?.total ?? 0),
      }), { pass: 0, fail: 0, skip: 0, total: 0 })
      : readJson(paths.results, { pass: 0, fail: 0, skip: 0, total: 0 });
    console.log(`${acc.padEnd(9)} | ${String(summary.pass).padEnd(4)} | ${String(summary.fail).padEnd(4)} | ${String(summary.skip).padEnd(4)} | ${summary.total}`);
  }
}

// Dynamic import for readline to support --pause interactive prompts
let _readline = null;
async function promptEnter(message) {
  if (!_readline) _readline = await import('node:readline');
  return new Promise((resolve) => {
    const rl = _readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, () => { rl.close(); resolve(); });
  });
}

async function cmdMature() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║     CaughtUp Maturity Progression Engine             ║');
  console.log(`║     Target: ${FLAGS.target.padEnd(40)}║`);
  console.log(`║     Mode: ${FLAGS.mode.padEnd(42)}║`);
  console.log('╚══════════════════════════════════════════════════════╝');

  const maturityPath = getStatePaths(FLAGS.target).maturity;
  const requestedStartPhase = FLAGS.phase === '' ? 0 : Number(FLAGS.phase);
  if (!Number.isInteger(requestedStartPhase) || !PHASES[requestedStartPhase]) {
    throw new Error(`Invalid maturity start phase: ${FLAGS.phase}`);
  }
  const futurePhases = Object.keys(PHASES).filter((id) => Number(id) >= requestedStartPhase);
  const changesFixtures = futurePhases.some((id) => (PHASES[id].fixturesBefore ?? []).length > 0);
  if (!FLAGS.dryRun && changesFixtures && !FLAGS.allowFixtures) {
    throw new Error('Maturity progression changes account fixtures and requires --allow-fixtures.');
  }
  if (!FLAGS.dryRun && changesFixtures && ACCOUNTS[FLAGS.target]?.type === 'aged' && !FLAGS.allowAgedFixtures) {
    throw new Error('Maturity progression on an aged account also requires --allow-aged-fixtures.');
  }
  const priorMaturity = readJson(maturityPath, null);
  const canResume = requestedStartPhase > 0 && priorMaturity?.run_tag === RUN_TAG && priorMaturity?.target === FLAGS.target;
  if (requestedStartPhase === 0) {
    writeJson(getStatePaths(FLAGS.target).state, { runs: [], chains: {} });
  }
  const maturity = canResume ? priorMaturity : {
    run_tag: RUN_TAG,
    target: FLAGS.target,
    started_at: new Date().toISOString(),
    phases: {},
  };
  writeJson(maturityPath, maturity);

  let allPhasesPassed = Object.values(maturity.phases ?? {}).every((phase) => Number(phase.fail ?? 0) === 0);
  for (const phaseId of Object.keys(PHASES).filter((id) => Number(id) >= requestedStartPhase)) {
    const phase = PHASES[phaseId];
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Phase ${phaseId}: ${phase.label}`);
    console.log(`${'═'.repeat(60)}`);

    FLAGS.phase = phaseId;
    await cmdSetup();
    
    const tests = [...(phase.tests ?? []), ...(phase.replayTests ?? [])];
    if (!tests.length) {
      console.log('  No test scenarios for this phase.');
      continue;
    }
    FLAGS.group = tests.join(',');
    await cmdFire();
    await cmdWait();
    const phasePassed = await cmdVerify();
    const apiTests = tests.filter((scenarioId) => SCENARIOS[scenarioId]?.apiOnly);
    const apiResults = apiTests.length ? await cmdApiTest(apiTests) : { total: 0, pass: 0, fail: 0, skip: 0, results: [] };
    allPhasesPassed = allPhasesPassed && phasePassed && apiResults.fail === 0;

    // Snapshot metrics for this phase
    const results = readJson(getStatePaths(FLAGS.target).results, null);
    if (results) {
      console.log(`\n  Phase ${phaseId} Summary: ${results.pass}/${results.total} PASS, ${results.fail} FAIL`);
      const maturity = readJson(maturityPath, { run_tag: RUN_TAG, target: FLAGS.target, phases: {} });
      maturity.phases[phaseId] = {
        label: phase.label,
        snapshot_metrics: phase.snapshotMetrics ?? [],
        ...results,
        api: apiResults,
      };
      maturity.updated_at = new Date().toISOString();
      writeJson(maturityPath, maturity);
    }

    if (FLAGS.pause && phaseId !== String(Math.max(...Object.keys(PHASES).map(Number)))) {
      console.log('\n  📱 Open the Chrome extension now to observe the Today feed.');
      console.log('     You should see the changes described for this phase.');
      await promptEnter('     Press Enter when ready to continue to the next phase... ');
    }
  }

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║     Maturity Progression Complete                    ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  if (!allPhasesPassed) throw new Error('Maturity progression completed with failed assertions.');
}

async function cmdFull() {
  await cmdFire();
  await cmdWait();
  const passed = await cmdVerify();
  await cmdApiTest();
  await cmdScorecard();
  if (!passed) throw new Error('Full stress run completed with failed assertions.');
}

function usage() {
  console.log(`CaughtUp forwarding stress harness

Commands:
  setup         Configure test fixtures on the target account (use --phase=N)
  teardown      Remove all [HARNESS]-labeled fixtures
  reset         Deep-clean ALL data for a target account (refuses aged without --force-reset)
  inspect       Current alias, profile, recent rows, Today counts
  fire          Send inbound emails for selected groups
  wait          Poll pending runs and score results
  verify        Assert expected outcomes
  chain         Sequential multi-turn chains
  api-test      Run Groups H-J (apiOnly scenarios)
  scorecard     Cross-account comparison matrix
  mature        Run 5-phase maturity progression (Phase 0-4)
  full          Orchestrate: fire -> wait -> verify -> api-test -> scorecard

Flags:
  --target=ACCOUNT      Target account (yafet2132, burner, workspace) [default: yafet2132]
  --group=A,B,C         Filter which groups to fire
  --phase=0             Phase to run for setup, or starting phase when resuming mature
  --mode=inject|hop     inject (default): direct Edge Function POST; hop: Gmail send
  --pause               Pause between maturity phases for UI observation
  --resume              Append fire results to current state after an interrupted run
  --dry-run             Log payloads but do not send
  --allow-auto-send     Permit auto-send behavior
  --allow-send          Permit actual send operations
  --allow-fixtures      Permit test settings, rules, kits, and calendar mutations
  --allow-aged-fixtures Additionally permit fixture mutations on the aged account
  --force-reset         Allow reset on aged (yafet2132) account
  --verbose             Verbose output

Accounts:
  ${Object.entries(ACCOUNTS).map(([k, v]) => `${k} (${v.email} → ${v.alias})`).join('\n  ')}

Env: QA_SERVICE_KEY (required), HARNESS_SENDER_EMAIL, HARNESS_RUN_TAG
`);
}

try {
  if (command === "setup") await cmdSetup();
  else if (command === "teardown") await cmdTeardown();
  else if (command === "reset") await cmdReset();
  else if (command === "inspect") await cmdInspect();
  else if (command === "fire") await cmdFire();
  else if (command === "wait") await cmdWait();
  else if (command === "verify") {
    if (!await cmdVerify()) process.exitCode = 1;
  }
  else if (command === "chain") await cmdChain();
  else if (command === "api-test") await cmdApiTest();
  else if (command === "scorecard") await cmdScorecard();
  else if (command === "mature") await cmdMature();
  else if (command === "full") await cmdFull();
  else {
    usage();
    process.exit(command ? 1 : 0);
  }
} catch (error) {
  console.error(error.message ?? error);
  process.exit(1);
}
