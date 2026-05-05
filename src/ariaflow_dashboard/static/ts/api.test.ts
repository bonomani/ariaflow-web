import { test } from 'node:test';
import assert from 'node:assert/strict';

import { apiFetch, joinUrl, postEmpty } from './api.js';

test('apiFetch resolves with the fetch response', async () => {
  const fakeResponse = { ok: true, status: 200 } as Response;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return fakeResponse;
  };
  const r = await apiFetch('/api/status');
  assert.equal(r, fakeResponse);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, '/api/status');
  assert.ok(calls[0]!.init?.signal instanceof AbortSignal);
});

test('apiFetch aborts when the timeout elapses', async () => {
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
  await assert.rejects(apiFetch('/slow', { timeoutMs: 10 }), /aborted/);
});

test('apiFetch forwards method, headers, body', async () => {
  let captured: RequestInit | undefined;
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    captured = init;
    return { ok: true } as Response;
  };
  await apiFetch('/api/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"a":1}',
  });
  assert.equal(captured?.method, 'POST');
  assert.deepEqual(captured?.headers, { 'Content-Type': 'application/json' });
  assert.equal(captured?.body, '{"a":1}');
});

test('joinUrl strips trailing slashes from base', () => {
  assert.equal(joinUrl('http://h:8000', '/api/x'), 'http://h:8000/api/x');
  assert.equal(joinUrl('http://h:8000/', '/api/x'), 'http://h:8000/api/x');
  assert.equal(joinUrl('http://h:8000///', '/api/x'), 'http://h:8000/api/x');
});

test('postEmpty issues POST with no body and returns raw Response', async () => {
  let captured: RequestInit | undefined;
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    captured = init;
    return new Response('{}', { status: 503 });
  };
  const r = await postEmpty('/api/scheduler/pause');
  assert.equal(captured?.method, 'POST');
  assert.equal(captured?.body, undefined);
  // postEmpty does NOT throw on non-2xx — caller inspects response.
  assert.equal(r.status, 503);
});
