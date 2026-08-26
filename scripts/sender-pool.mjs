import { SCENARIOS } from './scenario-content.mjs';

function localPart(name, scenarioId) {
  const normalized = String(name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 64);
  if (normalized) return normalized;
  return String(scenarioId).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 64) || 'sender';
}

function identityFor(scenarioId, scenario) {
  const name = String(scenario?.from?.name ?? '').trim();
  const domain = String(scenario?.from?.domain ?? '').trim().toLowerCase();
  if (!name || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    throw new Error(`Scenario ${scenarioId} has an invalid sender identity.`);
  }
  const email = `${localPart(name, scenarioId)}@${domain}`;
  return Object.freeze({ name, domain, email, envelopeFrom: email, fromHeader: `${name} <${email}>` });
}

export const SENDER_IDENTITIES = Object.freeze(Object.fromEntries(
  Object.entries(SCENARIOS)
    .filter(([, scenario]) => !scenario.apiOnly)
    .map(([scenarioId, scenario]) => [scenarioId, identityFor(scenarioId, scenario)]),
));

export function senderFor(scenarioId) {
  const sender = SENDER_IDENTITIES[scenarioId];
  if (!sender) throw new Error(`No sender identity is defined for scenario ${scenarioId}.`);
  return sender;
}
