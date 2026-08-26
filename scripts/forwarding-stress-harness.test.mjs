import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { SCENARIOS } from './scenario-content.mjs';
import { SENDER_IDENTITIES, senderFor } from './sender-pool.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS = path.join(ROOT, 'scripts', 'forwarding-stress-harness.mjs');

function runHarness(args, runTag = `FWD-STRESS-UNIT-${process.pid}`) {
  return spawnSync(process.execPath, [HARNESS, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, HARNESS_RUN_TAG: runTag },
  });
}

test('sender pool covers every email scenario with its natural identity', () => {
  const emailScenarios = Object.entries(SCENARIOS).filter(([, scenario]) => !scenario.apiOnly);
  assert.equal(Object.keys(SENDER_IDENTITIES).length, emailScenarios.length);
  assert.deepEqual(senderFor('A1_urgent_deadline'), {
    name: 'Sarah Chen',
    domain: 'brandco.com',
    email: 'sarah.chen@brandco.com',
    envelopeFrom: 'sarah.chen@brandco.com',
    fromHeader: 'Sarah Chen <sarah.chen@brandco.com>',
  });
});

test('scenario expectations match product boundaries instead of impossible premises', () => {
  assert.equal(SCENARIOS.A12_spam_bulk.expects.category, 'low_priority');
  assert.deepEqual(SCENARIOS.B6_no_system_leak.expects, {
    category: 'spam_or_poor_fit', todayVisible: false, draft: false, negotiation: false, hostile: true,
  });
  for (const id of ['D1_initial_offer', 'D2_counteroffer', 'D3_revised_final', 'D4_below_floor', 'D5_above_target', 'D6_vague_collab']) {
    assert.equal(SCENARIOS[id].expects.negotiation, false);
    assert.equal(SCENARIOS[id].negotiationAssert.requiresCreatorReply, true);
  }
  assert.equal(SCENARIOS.E3_portfolio_request.kitAssert.expectedDefault, true);
  assert.equal(SCENARIOS.E4_no_match_fallback.kitAssert.expectedDefault, true);
});

test('inject dry-run builds the signed-endpoint payload without contacting production', () => {
  const runTag = `FWD-STRESS-UNIT-INJECT-${process.pid}`;
  const statePath = path.join(ROOT, '.tmp', `${runTag}-burner-state.json`);
  try {
    const result = runHarness([
      '--target=burner', '--mode=inject', '--dry-run', '--group=A1_urgent_deadline', 'fire',
    ], runTag);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /\[\[/);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(state.runs.length, 1);
    const { payload } = state.runs[0];
    assert.equal(payload.alias_token, '90210burner');
    assert.equal(payload.envelope_from, 'sarah.chen@brandco.com');
    assert.equal(payload.envelope_to, '90210burner@inbound.getcaughtup.io');
    assert.equal(payload.original_to, '90210burner@gmail.com');
    assert.match(payload.subject, /^\[FWD-STRESS-UNIT-INJECT-\d+ A1_urgent_deadline\]/);
    assert.match(payload.message_id, /^<FWD-STRESS-UNIT-INJECT-/);
    assert.equal(payload.list_unsubscribe, false);
    assert.deepEqual(payload.attachments, []);
  } finally {
    fs.rmSync(statePath, { force: true });
  }
});

test('maturity chain scenarios preserve RFC reply headers across fire commands', () => {
  const runTag = `FWD-STRESS-UNIT-CHAIN-${process.pid}`;
  const statePath = path.join(ROOT, '.tmp', `${runTag}-burner-state.json`);
  try {
    const first = runHarness([
      '--target=burner', '--mode=inject', '--dry-run', '--group=D1_initial_offer', 'fire',
    ], runTag);
    assert.equal(first.status, 0, first.stderr);
    const second = runHarness([
      '--target=burner', '--mode=inject', '--dry-run', '--group=D2_counteroffer,D3_revised_final', 'fire',
    ], runTag);
    assert.equal(second.status, 0, second.stderr);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(state.runs.length, 2);
    assert.match(state.runs[0].payload.in_reply_to, /D1_initial_offer/);
    assert.match(state.runs[1].payload.in_reply_to, /D2_counteroffer/);
    assert.match(state.runs[1].payload.references, /D1_initial_offer/);
    assert.match(state.runs[1].payload.references, /D2_counteroffer/);
  } finally {
    fs.rmSync(statePath, { force: true });
  }
});

test('resume appends scenarios after an interrupted fire command', () => {
  const runTag = `FWD-STRESS-UNIT-RESUME-${process.pid}`;
  const statePath = path.join(ROOT, '.tmp', `${runTag}-burner-state.json`);
  try {
    const first = runHarness([
      '--target=burner', '--mode=inject', '--dry-run', '--group=A1_urgent_deadline', 'fire',
    ], runTag);
    assert.equal(first.status, 0, first.stderr);
    const resumed = runHarness([
      '--target=burner', '--mode=inject', '--dry-run', '--resume', '--group=A2_urgent_budget', 'fire',
    ], runTag);
    assert.equal(resumed.status, 0, resumed.stderr);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.deepEqual(state.runs.map((run) => run.scenarioId), ['A1_urgent_deadline', 'A2_urgent_budget']);
  } finally {
    fs.rmSync(statePath, { force: true });
  }
});

test('maturity dry-run can resume from a later phase', () => {
  const runTag = `FWD-STRESS-UNIT-MATURE-${process.pid}`;
  const result = runHarness([
    '--target=burner', '--mode=inject', '--dry-run', '--phase=2', 'mature',
  ], runTag);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Phase 0: Bare account/);
  assert.doesNotMatch(result.stdout, /Phase 1: Voice configured/);
  assert.match(result.stdout, /Phase 2: Kits \+ rate profiles added/);
  assert.match(result.stdout, /Phase 4: Maturity checkpoint/);
});

test('calendar mode assertions use per-scenario fixtures in dry-run scoring', () => {
  const runTag = `FWD-STRESS-UNIT-CALENDAR-${process.pid}`;
  const statePath = path.join(ROOT, '.tmp', `${runTag}-burner-state.json`);
  const resultsPath = path.join(ROOT, '.tmp', `${runTag}-burner-results.json`);
  try {
    const fire = runHarness([
      '--target=burner', '--mode=inject', '--dry-run', '--group=F1_scheduled_call,F2_email_only,F3_phone_mode,F4_booking_conflict', 'fire',
    ], runTag);
    assert.equal(fire.status, 0, fire.stderr);
    const wait = runHarness(['--target=burner', '--dry-run', 'wait'], runTag);
    assert.equal(wait.status, 0, wait.stderr);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.deepEqual(state.runs.map((run) => run.fixture.contact_mode), ['scheduled_call', 'email_only', 'phone', 'scheduled_call']);
    const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    assert.equal(results.pass, 4);
    assert.equal(results.fail, 0);
    assert.ok(results.results.every((result) => result.checks.some((check) => check.name.startsWith('calendar_') || check.name === 'booking_conflict_excluded')));
  } finally {
    fs.rmSync(statePath, { force: true });
    fs.rmSync(resultsPath, { force: true });
  }
});

test('API dry-run reports unsupported coverage as skips', () => {
  const result = runHarness(['--target=burner', '--dry-run', 'api-test']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"status": "SKIP"/);
  assert.match(result.stdout, /"pass": 0/);
  assert.doesNotMatch(result.stdout, /API-only tests skipped/);
});

test('reset dry-run includes archive observations and refuses aged accounts by default', () => {
  const fresh = runHarness(['--target=burner', '--dry-run', 'reset']);
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.match(fresh.stdout, /DELETE ia_agent_observation_evidence/);
  assert.match(fresh.stdout, /DELETE ia_agent_observations/);
  assert.doesNotMatch(fresh.stdout, /ia_inbox_observations/);

  const aged = runHarness(['--target=yafet2132', '--dry-run', 'reset']);
  assert.equal(aged.status, 1);
  assert.match(aged.stderr, /requires --force-reset/);
});

test('invalid injection modes fail before any runtime lookup', () => {
  const result = runHarness(['--mode=invalid', '--dry-run', 'fire']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Expected inject or hop/);
});
