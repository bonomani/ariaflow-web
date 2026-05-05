import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  urlAria2GetOption,
  urlItemAction,
  urlItemFiles,
  urlLifecycleAction,
  urlScheduler,
  urlTorrentStop,
} from './actions.js';

test('urlItemAction encodes both segments', () => {
  assert.equal(urlItemAction('abc/def', 'pause'), '/api/downloads/abc%2Fdef/pause');
  assert.equal(urlItemAction('id 1', 'resume'), '/api/downloads/id%201/resume');
});

test('urlItemFiles encodes itemId', () => {
  assert.equal(urlItemFiles('a b'), '/api/downloads/a%20b/files');
});

test('urlLifecycleAction encodes both segments', () => {
  assert.equal(urlLifecycleAction('svc/x', 'enable'), '/api/lifecycle/svc%2Fx/enable');
});

test('urlTorrentStop encodes infohash', () => {
  assert.equal(urlTorrentStop('abc%def'), '/api/torrents/abc%25def/stop');
});

test('urlScheduler accepts pause / resume / preflight / ucc', () => {
  assert.equal(urlScheduler('pause'), '/api/scheduler/pause');
  assert.equal(urlScheduler('resume'), '/api/scheduler/resume');
  assert.equal(urlScheduler('preflight'), '/api/scheduler/preflight');
  assert.equal(urlScheduler('ucc'), '/api/scheduler/ucc');
});

test('urlAria2GetOption encodes gid', () => {
  assert.equal(urlAria2GetOption('g 1'), '/api/aria2/option?gid=g%201');
});
