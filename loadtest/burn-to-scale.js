// burn-to-scale.js — usado por el burn pipeline (`pythonapps-burn-pipeline`)
// para validar que el HPA escala al cruzar el target de CPU.
//
// NO valida latencia ni errores — eso es el load test del release pipeline.
// Acá la única dimensión que importa es "¿se gatilla scale-up?". El
// éxito/falla lo decide el step kubectl monitor-hpa del Task, NO los
// thresholds de k6.
//
// Estrategia de carga:
//   - 200 VUs sostenidos sin sleep → push máximo de CPU contra el pod
//   - Duración suficiente para que HPA evalúe (default ~15s resync,
//     scale-up necesita ~30s de averageUtilization > target)
//   - Endpoint /api01/hello con poco trabajo pero suficiente para saturar
//     uvicorn cuando hay miles de requests/s contra los pods.
import http from 'k6/http';

export const options = {
  scenarios: {
    burn: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 200 },   // ramp rápido
        { duration: '120s', target: 200 },  // sustained — HPA escala
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  // Sin thresholds: este test mide CAPACIDAD, no latencia.
  thresholds: {},
};

const TARGET_URL = __ENV.TARGET_URL || 'http://api01.localhost:8888';

export default function () {
  // /api01/hello hace JSON render — más caro que /health, satura CPU más rápido.
  http.get(`${TARGET_URL}/api01/hello`);
  // Sin sleep — generar la mayor presión de CPU posible.
}
