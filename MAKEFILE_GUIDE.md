# Guía rápida de comandos — webserver-api01

> App Python FastAPI con estrategia **BlueGreen** vía ArgoRollouts.
> Este repo no tiene Makefile — los comandos son `docker`, `git` y `k6`.

---

## Desarrollo local

```bash
# Instalar dependencias
pip install -e .

# Correr en modo desarrollo
uvicorn app.main:app --reload --port 8000

# Probar endpoints
curl localhost:8000/health
curl localhost:8000/version
curl localhost:8000/api01/hello
curl localhost:8000/api01/metrics
```

---

## Docker

```bash
# Build local
docker build -t local/api01:test .

# Correr el contenedor
docker run --rm -p 8000:8000 -e APP_VERSION=0.1.0 local/api01:test

# Build + tag + push para DockerHub
docker build -t valentinobruno/webserver-api01:v1.0.0 .
docker push valentinobruno/webserver-api01:v1.0.0
```

---

## Disparar el pipeline CI/CD

```bash
# BlueGreen (deployment en paralelo, requiere promoción manual)
git tag -a v1.0.0 -m "strategy:BlueGreen"
git push origin v1.0.0

# RollingUpdate (sin annotation = default)
git tag v1.0.0
git push origin v1.0.0
```

El tag push dispara el webhook → Tekton EventListener → PipelineRun en el cluster.

---

## Gestión del rollout BlueGreen

```bash
# Ver estado del rollout
kubectl argo rollouts get rollout webserver-api01 -n dev --watch

# Promover (switchear tráfico a la versión green)
kubectl argo rollouts promote webserver-api01 -n dev

# Abortar y volver a la versión anterior (stable)
kubectl argo rollouts abort webserver-api01 -n dev
```

---

## Load tests con k6

```bash
# Smoke test (verifica que la app responde)
k6 run loadtest/smoke.js -e BASE_URL=http://localhost:8000

# Load test contra el preview service (durante BlueGreen, antes de promover)
k6 run loadtest/load-bluegreen.js -e PREVIEW_URL=http://preview-service:8000
```

---

## Estructura del repo

```
webserver-api01/
├── Dockerfile
├── pyproject.toml          ← FastAPI + uvicorn + structlog + prometheus_client
├── app/
│   ├── main.py             ← endpoints /, /health, /version, /api01/hello, /api01/metrics
│   └── logging_config.py   ← logging estructurado con structlog (JSON)
├── loadtest/
│   ├── smoke.js            ← smoke test básico
│   └── load-bluegreen.js   ← load test para el preview service
└── .tekton/
    └── pipelinerun.yaml    ← template del PipelineRun (Tekton usa esto)
```
