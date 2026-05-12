// smoke.js — sanity check rápido contra /api01/health + /api01/version.
// Lo usa el rollingupdate strategy (si la app cambiara) o corridas locales
// `make load-test-smoke APP=webserver-api01`.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

export const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '10s', target: 5 },
    { duration: '20s', target: 5 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    errors:            ['rate<0.01'],
  },
};

// Fallback para corridas locales. El pipeline pasa BASE_URL via env var.
const BASE_URL = __ENV.BASE_URL || 'http://api01.localhost:8888';

export default function () {
  const healthRes = http.get(`${BASE_URL}/api01/health`);
  const healthOk = check(healthRes, {
    'health 200': (r) => r.status === 200,
    'body healthy': (r) => {
      try { return JSON.parse(r.body).status === 'healthy'; } catch { return false; }
    },
  });
  errorRate.add(!healthOk);

  const versionRes = http.get(`${BASE_URL}/api01/version`);
  check(versionRes, { 'version 200': (r) => r.status === 200 });
  sleep(1);
}
