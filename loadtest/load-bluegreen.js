// load-bluegreen.js — Stage 5 del release pipeline para webserver-api01.
//
// Apunta SIEMPRE al PREVIEW service (la versión green, sin tráfico real
// todavía). El pipeline pasa PREVIEW_URL como env var; el fallback es solo
// para corridas locales con `make load-test-bluegreen`.
//
// Por qué preview y no stable:
//   En blue/green la nueva versión vive en preview hasta el switch. Validar
//   contra stable testearía la versión vieja → no aporta. El svc preview
//   enrutea 100% al green RS hasta promote.
//
// Ramp profile:
//   warmup → carga progresiva hasta 1000 VUs → cool-down. Cada etapa con
//   duración suficiente para que stats de p95/p99 sean estables y para que
//   HPA tenga tiempo de escalar si hace falta.
//
// Thresholds:
//   El cluster k3d local tiene apps con limit 300m CPU; con minReplicas=2
//   en values.yaml arrancamos con baseline de 600m. Aún así 1000 VUs es
//   agresivo — el threshold de errores acepta 10% (HPA tarda ~30s en
//   reaccionar; durante esa ventana algunos requests pueden fallar).
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
        { duration: '30s', target: 100 },   // warmup, da tiempo a probes
        { duration: '30s', target: 300 },   // ramp medio, HPA debería notar
        { duration: '30s', target: 600 },   // ramp alto, HPA escala
        { duration: '60s', target: 1000 },  // peak — sostenido
        { duration: '30s', target: 1000 },  // mantener peak
        { duration: '20s', target: 0 },     // cool-down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // Laxos a propósito para k3d (limit 300m CPU/pod, max 5 replicas).
    // En cluster con capacidad real, bajar a p95<800 / p99<1500 / errors<1%.
    http_req_duration: ['p(95)<2000', 'p(99)<3000'],
    http_req_failed:   ['rate<0.10'],   // 10% — ventana de ~30s mientras HPA escala
    errors:            ['rate<0.10'],
    // El green DEBE servir la versión esperada — si todos responses traen
    // versión distinta, algo anda mal con el preview svc o el bump-gitops.
    version_mismatch:  ['count<1'],
  },
};

// PREVIEW_URL lo inyecta el Tekton task (preview svc in-cluster).
// Fallback para `make load-test-bluegreen` desde host.
const PREVIEW_URL = __ENV.PREVIEW_URL || 'http://preview-api01.localhost:8888';
const EXPECTED_VERSION = __ENV.EXPECTED_VERSION || '';

export default function () {
  // 1. /api01/health — barato, mide latencia de la app y verifica liveness
  const healthRes = http.get(`${PREVIEW_URL}/api01/health`, { tags: { endpoint: 'health' } });
  check(healthRes, { 'health 200': (r) => r.status === 200 });
  previewLatency.add(healthRes.timings.duration);

  // 2. /api01/hello — endpoint de negocio; reporta versión. Es el endpoint
  //    que un cliente real golpearía.
  const apiRes = http.get(`${PREVIEW_URL}/api01/hello`, { tags: { endpoint: 'hello' } });
  const ok = check(apiRes, {
    'api 200': (r) => r.status === 200,
    'version present': (r) => {
      try { return JSON.parse(r.body).version !== undefined; } catch { return false; }
    },
  });
  errorRate.add(!ok);

  // 3. Verificación opcional de versión — útil para garantizar que el load
  //    test corre sobre la versión NUEVA y no contra stale.
  if (EXPECTED_VERSION) {
    try {
      const v = JSON.parse(apiRes.body).version;
      if (v !== EXPECTED_VERSION) versionMismatch.add(1);
    } catch { versionMismatch.add(1); }
  }

  sleep(0.2);
}
