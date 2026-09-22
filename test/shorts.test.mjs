import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isShort } from '../scripts/lib/shorts.mjs';

const answering = (status, seen = []) => async (url, init) => {
  seen.push({ url, init });
  return { status };
};

test('a 200 from /shorts/ is a Short', async () => {
  const seen = [];
  assert.equal(await isShort('fwBIZRq-vzY', { fetchImpl: answering(200, seen) }), true);
  assert.equal(seen[0].url, 'https://www.youtube.com/shorts/fwBIZRq-vzY');
  assert.equal(seen[0].init.method, 'HEAD');
  assert.equal(seen[0].init.redirect, 'manual');
});

test('the 303 to /watch means a regular video', async () => {
  assert.equal(await isShort('TbkUKCm3CHQ', { fetchImpl: answering(303) }), false);
});

test('a blocked or failed check falls back to "not a Short" so the video still gets a task', async () => {
  assert.equal(await isShort('x', { fetchImpl: answering(429) }), false);
  assert.equal(await isShort('x', { fetchImpl: async () => { throw new Error('timeout'); } }), false);
});
