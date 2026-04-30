import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  backendUrl,
  dashboardHostname,
  dashboardHostnameLower,
  localIps,
  localMainIp,
} from './runtime.js';

beforeEach(() => {
  (globalThis as unknown as { window: Window }).window = {} as Window;
});

test('backendUrl returns default when global is missing or empty', () => {
  assert.equal(backendUrl(), 'http://127.0.0.1:8000');
  window.__ARIAFLOW_BACKEND_URL__ = '';
  assert.equal(backendUrl(), 'http://127.0.0.1:8000');
});

test('backendUrl returns the injected value when set', () => {
  window.__ARIAFLOW_BACKEND_URL__ = 'http://otherhost:9000';
  assert.equal(backendUrl(), 'http://otherhost:9000');
});

test('dashboardHostname falls back to localhost', () => {
  assert.equal(dashboardHostname(), 'localhost');
  window.__ARIAFLOW_DASHBOARD_HOSTNAME__ = 'pc31';
  assert.equal(dashboardHostname(), 'pc31');
  assert.equal(dashboardHostnameLower(), 'pc31');
});

test('dashboardHostnameLower lowercases mixed-case input', () => {
  window.__ARIAFLOW_DASHBOARD_HOSTNAME__ = 'PC31';
  assert.equal(dashboardHostnameLower(), 'pc31');
});

test('localMainIp falls back to 127.0.0.1', () => {
  assert.equal(localMainIp(), '127.0.0.1');
  window.__ARIAFLOW_DASHBOARD_LOCAL_MAIN_IP__ = '192.168.1.10';
  assert.equal(localMainIp(), '192.168.1.10');
});

test('localIps returns default array when global is missing or empty', () => {
  assert.deepEqual(localIps(), ['127.0.0.1']);
  window.__ARIAFLOW_DASHBOARD_LOCAL_IPS__ = [];
  assert.deepEqual(localIps(), ['127.0.0.1']);
});

test('localIps returns the injected array', () => {
  window.__ARIAFLOW_DASHBOARD_LOCAL_IPS__ = ['10.0.0.1', '192.168.1.10'];
  assert.deepEqual(localIps(), ['10.0.0.1', '192.168.1.10']);
});
