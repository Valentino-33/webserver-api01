// burn-to-scale.js — pipeline DEDICADO (pythonapps-burn-pipeline) para
// validar HPA scale-up. Stress real — no contiene thresholds, el éxito
// lo decide el step kubectl monitor-hpa del Task (replicas > baseline).
//
// Profile agresivo: 400 VUs sin sleep durante 150s. Suficiente para
// saturar 600m CPU baseline y forzar HPA scale-up (target 50%).
import http from 'k6/http';

export const options = {
  scenarios: {
    burn: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 400 },   // ramp rápido — saturación inmediata
        { duration: '150s', target: 400 },  // sustained — HPA escala ~30-60s después
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {},
};

const TARGET_URL = __ENV.TARGET_URL || 'http://api01.localhost:8888';

export default function () {
  http.get(`${TARGET_URL}/api01/hello`);
}
