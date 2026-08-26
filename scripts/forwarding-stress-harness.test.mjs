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
