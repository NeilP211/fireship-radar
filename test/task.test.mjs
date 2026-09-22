import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTask, cleanTitle, uploadedAt } from '../scripts/lib/task.mjs';

const video = {
  videoId: 'TbkUKCm3CHQ',
  title: 'An ex-OpenAI researcher just deleted language from the LLM...',
  published: '2026-09-21T17:52:29+00:00',
  url: 'https://www.youtube.com/watch?v=TbkUKCm3CHQ',
};
const fireship = { id: 'fireship', name: 'Fireship' };

test('builds a linked task due today in the Inbox', () => {
  assert.deepEqual(buildTask(video, fireship), {
    content: 'Watch Fireship: [An ex-OpenAI researcher just deleted language from the LLM...](https://www.youtube.com/watch?v=TbkUKCm3CHQ)',
    description: 'Fireship uploaded it Mon, Sep 21, 1:52 PM ET.',
    due_string: 'today',
  });
});

test('a video from the page carries its length and only the day it went up', () => {
  const fromPage = { ...video, published: '2026-09-21T18:30:00.000Z', approximate: true, duration: '5:27' };
  assert.equal(buildTask(fromPage, fireship).description, '5:27 long. Fireship uploaded it Mon, Sep 21.');
});

test('a video with no known time or length gets an empty description', () => {
  assert.equal(buildTask({ ...video, published: null }, fireship).description, '');
});

test('upload time is shown in Eastern time', () => {
  assert.equal(uploadedAt('2026-09-22T03:10:00+00:00'), 'Mon, Sep 21, 11:10 PM ET');
  assert.equal(uploadedAt('2026-09-22T03:10:00+00:00', true), 'Mon, Sep 21');
  assert.ok(!/[^\x20-\x7e]/.test(uploadedAt(video.published)));
});

test('square brackets in a title cannot break the markdown link', () => {
  assert.equal(cleanTitle('[NEW] React 20 in 100 seconds [fast]'), '(NEW) React 20 in 100 seconds (fast)');
});

test('long dashes in a title become plain hyphens', () => {
  const dashed = `Bun 2 ${String.fromCharCode(0x2014)} faster ${String.fromCharCode(0x2013)} again`;
  assert.equal(cleanTitle(dashed), 'Bun 2 - faster - again');
});

test('whitespace in a title is collapsed', () => {
  assert.equal(cleanTitle('  two\n lines  '), 'two lines');
});

test('per-channel project, labels, due and prefix are honored', () => {
  const task = buildTask(video, { ...fireship, projectId: 'p1', labels: ['watch'], due: 'tomorrow', prefix: 'Fireship:' });
  assert.equal(task.project_id, 'p1');
  assert.deepEqual(task.labels, ['watch']);
  assert.equal(task.due_string, 'tomorrow');
  assert.match(task.content, /^Fireship: \[/);
});
