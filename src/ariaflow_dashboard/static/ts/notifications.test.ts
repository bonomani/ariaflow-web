import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffItemStatuses, type NotifiableItem } from './notifications.js';

test('diffItemStatuses fires no notification on first observation (priming)', () => {
  const items: NotifiableItem[] = [
    { id: 'a', status: 'active', url: 'http://x/a' },
    { id: 'b', status: 'complete', url: 'http://x/b' },
  ];
  const r = diffItemStatuses({}, items);
  assert.deepEqual(r.notifications, []);
  assert.deepEqual(r.nextStatusMap, { a: 'active', b: 'complete' });
});

test('diffItemStatuses fires "complete" on active → done transition', () => {
  const items: NotifiableItem[] = [
    { id: 'a', status: 'complete', output: '/tmp/foo.iso', url: 'http://x/a' },
  ];
  const r = diffItemStatuses({ a: 'active' }, items);
  assert.equal(r.notifications.length, 1);
  assert.equal(r.notifications[0]!.kind, 'complete');
  assert.equal(r.notifications[0]!.title, 'Download complete');
  assert.equal(r.notifications[0]!.body, 'foo.iso');
  assert.equal(r.notifications[0]!.tag, 'ariaflow-a');
});

test('diffItemStatuses fires "error" on transition to error', () => {
  const items: NotifiableItem[] = [
    { id: 'a', status: 'error', url: 'http://x/foo.zip', error_message: 'timeout' },
  ];
  const r = diffItemStatuses({ a: 'active' }, items);
  assert.equal(r.notifications[0]!.kind, 'error');
  assert.equal(r.notifications[0]!.body, 'foo.zip — timeout');
});

test('diffItemStatuses treats error status', () => {
  const items: NotifiableItem[] = [
    { id: 'a', status: 'error', url: 'http://x/foo.zip' },
  ];
  const r = diffItemStatuses({ a: 'active' }, items);
  assert.equal(r.notifications[0]!.kind, 'error');
});

test('diffItemStatuses includes error_message only when present', () => {
  const items: NotifiableItem[] = [
    { id: 'a', status: 'error', url: 'http://x/foo.zip' }, // no error_message
  ];
  const r = diffItemStatuses({ a: 'active' }, items);
  assert.equal(r.notifications[0]!.body, 'foo.zip');
});

test('diffItemStatuses uses output before falling back to url for the body', () => {
  const items: NotifiableItem[] = [
    { id: 'a', status: 'complete', output: '/tmp/picked.iso', url: 'http://x/raw.iso' },
  ];
  const r = diffItemStatuses({ a: 'active' }, items);
  assert.equal(r.notifications[0]!.body, 'picked.iso');
});

test('diffItemStatuses ignores items with no stable id (no id and no url)', () => {
  const items: NotifiableItem[] = [{ status: 'complete' }];
  const r = diffItemStatuses({ '': 'active' }, items);
  assert.deepEqual(r.notifications, []);
});

test('diffItemStatuses falls back to url when id is missing', () => {
  const items: NotifiableItem[] = [{ url: 'http://x/foo.zip', status: 'complete' }];
  const r = diffItemStatuses({ 'http://x/foo.zip': 'active' }, items);
  assert.equal(r.notifications.length, 1);
  assert.equal(r.notifications[0]!.tag, 'ariaflow-http://x/foo.zip');
});

test('diffItemStatuses does not fire on transitions to non-final states', () => {
  const items: NotifiableItem[] = [{ id: 'a', status: 'paused', url: 'http://x/a' }];
  const r = diffItemStatuses({ a: 'active' }, items);
  assert.deepEqual(r.notifications, []);
  assert.equal(r.nextStatusMap.a, 'paused');
});

test('diffItemStatuses normalizes status casing', () => {
  const items: NotifiableItem[] = [
    { id: 'a', status: 'COMPLETE', output: '/tmp/foo.iso', url: 'http://x/a' },
  ];
  const r = diffItemStatuses({ a: 'active' }, items);
  assert.equal(r.notifications[0]!.kind, 'complete');
  assert.equal(r.nextStatusMap.a, 'complete');
});

test('diffItemStatuses does not double-fire when called twice with the same final state', () => {
  const items: NotifiableItem[] = [
    { id: 'a', status: 'complete', output: '/tmp/foo.iso', url: 'http://x/a' },
  ];
  const first = diffItemStatuses({ a: 'active' }, items);
  assert.equal(first.notifications.length, 1);
  const second = diffItemStatuses(first.nextStatusMap, items);
  assert.deepEqual(second.notifications, []);
});

test('diffItemStatuses preserves entries for items not in the new snapshot', () => {
  const items: NotifiableItem[] = [{ id: 'b', status: 'active' }];
  const r = diffItemStatuses({ a: 'complete' }, items);
  assert.equal(r.nextStatusMap.a, 'complete');
  assert.equal(r.nextStatusMap.b, 'active');
});
