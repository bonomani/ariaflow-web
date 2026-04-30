// Typed accessors for the runtime globals that webapp.py injects via
// inline <script> at page render time. Centralizes the four
// __ARIAFLOW_* names, default values, and string-coercion so the rest
// of the app reads them through a single typed surface.
//
// See `_read_index_html` in src/ariaflow_dashboard/webapp.py for the
// injection site (variables prefixed __ARIAFLOW_DASHBOARD_*).

declare global {
  interface Window {
    __ARIAFLOW_BACKEND_URL__?: string;
    __ARIAFLOW_DASHBOARD_HOSTNAME__?: string;
    __ARIAFLOW_DASHBOARD_LOCAL_MAIN_IP__?: string;
    __ARIAFLOW_DASHBOARD_LOCAL_IPS__?: string[];
  }
}

const DEFAULT_BACKEND = 'http://127.0.0.1:8000';
const DEFAULT_IP = '127.0.0.1';
const DEFAULT_HOSTNAME = 'localhost';

export function backendUrl(): string {
  const v = window.__ARIAFLOW_BACKEND_URL__;
  return typeof v === 'string' && v.length > 0 ? v : DEFAULT_BACKEND;
}

export function dashboardHostname(): string {
  const v = window.__ARIAFLOW_DASHBOARD_HOSTNAME__;
  return typeof v === 'string' && v.length > 0 ? v : DEFAULT_HOSTNAME;
}

export function dashboardHostnameLower(): string {
  return dashboardHostname().toLowerCase();
}

export function localMainIp(): string {
  const v = window.__ARIAFLOW_DASHBOARD_LOCAL_MAIN_IP__;
  return typeof v === 'string' && v.length > 0 ? v : DEFAULT_IP;
}

export function localIps(): string[] {
  const v = window.__ARIAFLOW_DASHBOARD_LOCAL_IPS__;
  return Array.isArray(v) && v.length > 0 ? v.map(String) : [DEFAULT_IP];
}
