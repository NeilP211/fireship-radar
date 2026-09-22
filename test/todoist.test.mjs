import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTask, deliver } from '../scripts/todoist.mjs';

const channels = [{ id: 'fireship', name: 'Fireship' }];
const pending = [
  { channel: 'fireship', videoId: 'AAAAAAAAAAA', title: 'First', published: '2026-09-21T17:00:00+00:00', url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA' },
  { channel: 'fireship', videoId: 'BBBBBBBBBBB', title: 'Second', published: '2026-09-21T18:00:00+00:00', url: 'https://www.youtube.com/watch?v=BBBBBBBBBBB' },
];
const quiet = () => {};

test('createTask posts to the v1 tasks endpoint with the bearer token', async () => {
  const calls = [];
  const task = await createTask(
    { content: 'hi', due_string: 'today' },
    {
      token: 'secret',
      requestId: 'req-1',
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({ id: 't1' }) };
      },
    },
  );
  assert.equal(task.id, 't1');
  assert.equal(calls[0].url, 'https://api.todoist.com/api/v1/tasks');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, 'Bearer secret');
  assert.equal(calls[0].init.headers['x-request-id'], 'req-1');
  assert.deepEqual(JSON.parse(calls[0].init.body), { content: 'hi', due_string: 'today' });
});

test('createTask surfaces the HTTP status and body on failure', async () => {
  await assert.rejects(
    createTask({ content: 'hi' }, {
      token: 'bad',
      fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'Unauthorized' }),
    }),
    /HTTP 401: Unauthorized/,
  );
});

test('every created task is recorded as seen', async () => {
  const bodies = [];
  const result = await deliver(pending, channels, { fireship: ['old'] }, {
    log: quiet,
    create: async (body) => {
      bodies.push(body);
      return { id: `t${bodies.length}` };
    },
  });
  assert.equal(result.created, 2);
  assert.deepEqual(result.state.fireship, ['BBBBBBBBBBB', 'AAAAAAAAAAA', 'old']);
  assert.match(bodies[0].content, /^Watch Fireship: \[First\]/);
});

test('a failed task stays pending while the others are still recorded', async () => {
  const result = await deliver(pending, channels, { fireship: ['old'] }, {
    log: quiet,
    create: async (body) => {
      if (body.content.includes('First')) throw new Error('HTTP 503');
      return { id: 't2' };
    },
  });
  assert.equal(result.created, 1);
  assert.deepEqual(result.failed, [{ videoId: 'AAAAAAAAAAA', error: 'HTTP 503' }]);
  assert.deepEqual(result.state.fireship, ['BBBBBBBBBBB', 'old']);
});

test('each video gets a stable request id', async () => {
  const ids = [];
  await deliver(pending, channels, {}, {
    log: quiet,
    create: async (body, { requestId }) => {
      ids.push(requestId);
      return { id: 'x' };
    },
  });
  assert.deepEqual(ids, ['fireship-radar-fireship-AAAAAAAAAAA', 'fireship-radar-fireship-BBBBBBBBBBB']);
});

test('a dry run creates nothing and changes no state', async () => {
  const lines = [];
  const state = { fireship: ['old'] };
  const result = await deliver(pending, channels, state, {
    dryRun: true,
    log: (line) => lines.push(line),
    create: async () => assert.fail('dry run must not create'),
  });
  assert.equal(result.created, 0);
  assert.deepEqual(result.state, state);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\[dry run\] /);
});
