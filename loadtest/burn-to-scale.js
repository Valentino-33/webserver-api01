// burn-to-scale.js — usado por el Task `run-burn-to-scale` del pipeline
// (Stage 7) para validar que el HPA escala al cruzar el target de CPU.
//
// NO valida latencia ni errores — eso es Stage 5. Acá la única dimensión
// que importa es "¿se gatilla scale-up?". El éxito/falla lo decide el step
// kubectl monitor-hpa del Task, NO los thresholds de k6.
//
// Estrategia de carga:
//   - 200 VUs sostenidos sin sleep entre requests → push máximo de CPU.
//   - Duración suficiente para que HPA haga su evaluation (default 15s
//     resync, scale-up necesita ~30s de averageUtilization > target).
//   - Endpoint /api01/hello: barato pero suficiente para saturar CPU de
//     uvicorn cuando hay miles de requests/s contra 1 pod a 300m.
import http from 'k6/http';

export const options = {
  scenarios: {
    burn: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 200 },   // ramp rápido
        { duration: '120s', target: 200 },  // sustained — el HPA debe escalar acá
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  // Sin thresholds: este test mide CAPACIDAD, no latencia.
  // Marcar errores es esperado bajo CPU saturada; los marca el dashboard
  // de Grafana pero no son señal de regresión para Stage 7.
  thresholds: {},
};

const TARGET_URL = __ENV.TARGET_URL || 'http://api01.localhost:8888';

export default function () {
  // Endpoint con un poco de trabajo (json render). /health es más barato
  // pero a igualdad de RPS quema menos CPU.
  http.get(`${TARGET_URL}/api01/hello`);
  // Sin sleep — generar la mayor presión de CPU posible.
}
