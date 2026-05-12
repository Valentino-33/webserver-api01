# webserver-api01

API Python (FastAPI) con estrategia de deployment **BlueGreen** vía ArgoRollouts.

## Endpoints

| Método | Path | Descripción |
|---|---|---|
| GET | `/` | Info del servicio y versión |
| GET | `/health` | Health check (liveness/readiness probe de K8s) |
| GET | `/version` | Versión actual |
| GET | `/api01/hello` | Endpoint de negocio |
| GET | `/api01/metrics` | Métricas Prometheus |

## Correr local

```bash
pip install -e .
uvicorn app.main:app --reload --port 8000
curl localhost:8000/health
```

## Docker

```bash
docker build -t local/api01:test .
docker run --rm -p 8000:8000 -e APP_VERSION=0.1.0 local/api01:test
```

## Estrategia de deploy — BlueGreen

El pipeline de Tekton crea la versión "green" en paralelo. ArgoRollouts corre
`loadtest/load-bluegreen.js` contra el `preview` service antes del switch.
Solo si pasan los checks se promueve.

## Disparar el pipeline

```bash
git tag -a v1.0.0 -m "strategy:BlueGreen"
git push origin v1.0.0
```

## Load tests

```bash
k6 run loadtest/smoke.js -e BASE_URL=http://localhost:8000
k6 run loadtest/load-bluegreen.js -e PREVIEW_URL=http://preview-service:8000
```
