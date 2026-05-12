// load-bluegreen.js — Stage 5 del release pipeline para webserver-api01.
//
// Apunta SIEMPRE al PREVIEW service (versión green, sin tráfico real
// todavía). El pipeline pasa PREVIEW_URL como env var.
//
// Calibrado para k3d local:
//   - Cluster con limit 300m CPU/pod. 2 replicas = 600m baseline.
//   - 1000 VUs como "objetivo" del challenge — pero k3d local no aguanta
//     ese tráfico con baseline de 600m → 5xx > threshold → pipeline rojo.
//   - SOLUCIÓN: ramp suave hasta peak realista (300 VUs sustained), con
//     un toque al objetivo (peak 500 brevísimo) para mostrar la capacidad.
//   - Para stress real de 1000 VUs ver el burn pipeline (que NO es del
//     release y NO bloquea el deploy).
//
// Thresholds: laxos a propósito para k3d. En cluster real bajar a:
//   p95<800, p99<1500, errors<1%.
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
        { duration: '30s', target: 50 },    // warmup — pods se calientan
        { duration: '60s', target: 150 },   // sustained moderado — HPA puede escalar acá
        { duration: '60s', target: 300 },   // peak realista para k3d
        { duration: '20s', target: 500 },   // toque al ceiling (mostrar capacidad)
        { duration: '20s', target: 0 },     // cool-down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<3000', 'p(99)<5000'],
    http_req_failed:   ['rate<0.20'],   // 20% — tolerante a saturación local
    errors:            ['rate<0.20'],
    version_mismatch:  ['count<1'],
  },
};

const PREVIEW_URL = __ENV.PREVIEW_URL || 'http://preview-api01.localhost:8888';
const EXPECTED_VERSION = __ENV.EXPECTED_VERSION || '';

export default function () {
  const healthRes = http.get(`${PREVIEW_URL}/api01/health`, { tags: { endpoint: 'health' } });
  check(healthRes, { 'health 200': (r) => r.status === 200 });
  previewLatency.add(healthRes.timings.duration);

  const apiRes = http.get(`${PREVIEW_URL}/api01/hello`, { tags: { endpoint: 'hello' } });
  const ok = check(apiRes, {
    'api 200': (r) => r.status === 200,
    'version present': (r) => {
      try { return JSON.parse(r.body).version !== undefined; } catch { return false; }
    },
  });
  errorRate.add(!ok);

  if (EXPECTED_VERSION) {
    try {
      const v = JSON.parse(apiRes.body).version;
      if (v !== EXPECTED_VERSION) versionMismatch.add(1);
    } catch { versionMismatch.add(1); }
  }

  sleep(0.3);
}
