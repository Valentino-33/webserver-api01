// load-bluegreen.js — Stage 5 del pipeline para webserver-api01.
//
// Apunta SIEMPRE al preview service (la versión green, aún sin tráfico real).
// El pipeline pasa PREVIEW_URL como env var; el fallback solo es para corridas
// locales con `make load-test-bluegreen`.
//
// Por qué preview y no stable:
//   En blue/green la nueva versión vive en preview hasta que pasamos el switch.
//   Validar contra stable sería testear la versión vieja → no aporta nada.
//   El svc preview enrutea 100% al green RS hasta promote.
//
// Ramp profile:
//   warmup → carga progresiva hasta 1000 VUs → cool-down. Cada etapa con
//   duración suficiente para que stats de p95/p99 sean estables.
//
// Thresholds laxos (cluster k3d local con limit 300m CPU/pod):
//   Permiten saturación temporal — solo fallamos en regresiones reales
//   (errores 5xx, latencias absurdas), no por capacidad del cluster.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

export const errorRate = new Rate('errors');
export const versionMismatch = new Counter('version_mismatch');
export const previewLatency = new Trend('preview_latency_ms', true);

export const options = {
  scenarios: {
    bluegreen_ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 50 },    // warmup
        { duration: '30s', target: 200 },   // ramp medio
        { duration: '30s', target: 500 },   // ramp alto
        { duration: '60s', target: 1000 },  // peak sostenido
        { duration: '30s', target: 1000 },  // mantener peak
        { duration: '20s', target: 0 },     // cool-down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // Laxos a propósito: k3d local con limit 300m no aguanta thresholds de prod.
    // En cluster con capacidad real, bajar a p95<800 / p99<1500.
    http_req_duration: ['p(95)<2000', 'p(99)<3000'],
    http_req_failed:   ['rate<0.05'],
    errors:            ['rate<0.05'],
    // El green DEBE servir la versión esperada — si no aparece, fail hard.
    version_mismatch:  ['count<1'],
  },
};

// PREVIEW_URL lo inyecta el Tekton task (preview service in-cluster).
// Fallback para `make load-test-bluegreen` desde host.
const PREVIEW_URL = __ENV.PREVIEW_URL || 'http://preview-api01.localhost:8888';
// EXPECTED_VERSION: opcional — si se pasa, todo response cuyo body.version
// difiera marca version_mismatch (forzando fail del threshold).
const EXPECTED_VERSION = __ENV.EXPECTED_VERSION || '';

export default function () {
  // 1. /health — barato, mide latencia de la app
  const healthRes = http.get(`${PREVIEW_URL}/health`, { tags: { endpoint: 'health' } });
  check(healthRes, { 'health 200': (r) => r.status === 200 });
  previewLatency.add(healthRes.timings.duration);

  // 2. /api01/hello — endpoint de negocio; valida que el green responde y
  //    reporta versión. Es el endpoint que un cliente real golpearía.
  const apiRes = http.get(`${PREVIEW_URL}/api01/hello`, { tags: { endpoint: 'hello' } });
  const ok = check(apiRes, {
    'api 200': (r) => r.status === 200,
    'version present': (r) => {
      try { return JSON.parse(r.body).version !== undefined; } catch { return false; }
    },
  });
  errorRate.add(!ok);

  // 3. Validación opcional de versión exacta — útil para garantizar que el
  //    load test corre sobre la versión NUEVA y no contra una stale.
  if (EXPECTED_VERSION) {
    try {
      const v = JSON.parse(apiRes.body).version;
      if (v !== EXPECTED_VERSION) versionMismatch.add(1);
    } catch { versionMismatch.add(1); }
  }

  sleep(0.2);
}
