import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTickers } from './ingest/ticker-extractor';
import { computeSignal, effectivePriority, inPriceBand } from './signals/signals.service';
import { extractJson } from './ai/ai.service';
import { decrypt, encrypt, preview } from './common/crypto';

const valid = new Set(['GME', 'AMC', 'ALL', 'CEO', 'VYTX', 'BRK.B']);

test('extractTickers: cashtags and bare symbols, skipping common words', () => {
  const t = extractTickers('YOLO into $gme and AMC. ALL the CEO said DD is done. $BRK.B too', valid);
  assert.deepEqual(t.sort(), ['AMC', 'BRK.B', 'GME']);
});

test('extractTickers: cashtag for a stopword ticker still counts', () => {
  assert.deepEqual(extractTickers('Buying $ALL today', valid), ['ALL']);
});

test('extractTickers: permissive cashtags when universe is empty', () => {
  assert.deepEqual(extractTickers('$ABCD to the moon, also XYZ', new Set()), ['ABCD']);
});

test('computeSignal: quiet ticker exploding in one community is EMERGING', () => {
  const s = computeSignal(
    { ticker: 'X', m24: 40, m7: 120, authors7: 60, channels7: 1, baselineWeekly: 5, sentiment: 0.4, newsCount7: 0 },
    1,
  );
  assert.equal(s.stage, 'EMERGING');
  assert.ok(s.growth > 10);
});

test('computeSignal: widely discussed ticker is CROWDED', () => {
  const s = computeSignal(
    { ticker: 'X', m24: 400, m7: 2500, authors7: 1500, channels7: 7, baselineWeekly: 1500, sentiment: 0.2, newsCount7: 20 },
    20,
  );
  assert.equal(s.stage, 'CROWDED');
});

test('computeSignal: chatter below baseline is FADING', () => {
  const s = computeSignal(
    { ticker: 'X', m24: 2, m7: 20, authors7: 15, channels7: 2, baselineWeekly: 60, sentiment: -0.1, newsCount7: 0 },
    10,
  );
  assert.equal(s.stage, 'FADING');
});

test('effectivePriority: overrides dominate auto', () => {
  assert.ok(effectivePriority(10, 'PINNED') > effectivePriority(90, null));
  assert.ok(effectivePriority(90, 'PAUSED') < 0);
  assert.equal(effectivePriority(40, 'HIGH'), 90);
});

test('extractJson handles fences, prose and nested braces', () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a":{"b":"}"}}\n```'), { a: { b: '}' } });
  assert.deepEqual(extractJson('Result: {"x":1} trailing'), { x: 1 });
  assert.equal(extractJson('no json here'), undefined);
});

test('crypto round-trips and previews', () => {
  const enc = encrypt('sk-secret-12345678');
  assert.notEqual(enc, 'sk-secret-12345678');
  assert.equal(decrypt(enc), 'sk-secret-12345678');
  assert.equal(preview('sk-secret-12345678'), 'sk-s…5678');
});

test('inPriceBand: bounds are inclusive, null bounds and unknown prices pass', () => {
  const band = { minSharePrice: 1, maxSharePrice: 10 };
  assert.equal(inPriceBand(5, band), true);
  assert.equal(inPriceBand(1, band), true);
  assert.equal(inPriceBand(10, band), true);
  assert.equal(inPriceBand(0.5, band), false);
  assert.equal(inPriceBand(12, band), false);
  assert.equal(inPriceBand(null, band), true);
  assert.equal(inPriceBand(500, { minSharePrice: null, maxSharePrice: null }), true);
  assert.equal(inPriceBand(500, { minSharePrice: null, maxSharePrice: 20 }), false);
});
