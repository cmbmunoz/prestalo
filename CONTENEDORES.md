# Préstalo — Ejecución en contenedores

Guía rápida para construir, ejecutar y desplegar Préstalo como contenedores.

## 1. Desarrollo local (Docker Compose)

```bash
cp .env.example .env            # completar DB_PASSWORD y PRESTALO_SECRET
docker compose up --build       # levanta app + PostgreSQL
# App:  http://localhost:3000
# Salud: http://localhost:3000/health
```

Los scripts de `supabase/` (01…06) se aplican automáticamente al crear la base.

## 2. Construir y correr solo la imagen

```bash
docker build -t prestalo:1.0.0 .

docker run -p 3000:3000 \
  -e DATABASE_URL="postgres://user:pass@host:5432/prestalo_db" \
  -e DB_SSL=false \
  -e PRESTALO_SECRET="<secreto-largo>" \
  prestalo:1.0.0
```

- Con **Supabase**: no definir `DB_SSL` (o `DB_SSL=true`); usa la URL del pooler.
- Con **PostgreSQL interno** del clúster: `DB_SSL=false`.

## 3. Migraciones

Aplicar los scripts en orden contra la base destino, p. ej.:

```bash
for f in supabase/0*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

En producción, ejecutarlo como paso previo del despliegue (job de migración).

## 4. Tarea periódica (no-show)

Con varias réplicas web, poner `DISABLE_CRON=true` en ellas y ejecutar la rutina
como CronJob:

```bash
node jobs/expirar-noshow.js      # cada 5 min, programado por el orquestador
```

## 5. Publicar la imagen (registro)

```bash
docker tag prestalo:1.0.0 <registro-ust>/prestalo:1.0.0
docker push <registro-ust>/prestalo:1.0.0
```

## 6. Despliegue en Kubernetes / OpenShift

Manifiestos en `k8s/` (reemplazar `REGISTRO-UST/prestalo:1.0.0` por la imagen real):

```bash
kubectl create namespace prestalo

# Secretos (no usar el example con valores reales)
kubectl -n prestalo create secret generic prestalo-secrets \
  --from-literal=DATABASE_URL='postgres://user:pass@postgres:5432/prestalo_db' \
  --from-literal=PRESTALO_SECRET='<secreto-largo>'

kubectl -n prestalo apply -f k8s/configmap.yaml
kubectl -n prestalo apply -f k8s/job-migracion.yaml      # migra la base
kubectl -n prestalo wait --for=condition=complete job/prestalo-migracion --timeout=120s
kubectl -n prestalo apply -f k8s/deployment.yaml -f k8s/service.yaml -f k8s/ingress.yaml
kubectl -n prestalo apply -f k8s/cronjob-noshow.yaml     # tarea no-show
```

- **Web**: 2 réplicas con probes a `/health`, usuario no-root, FS de solo lectura y `DISABLE_CRON=true`.
- **no-show**: CronJob cada 5 min (no corre en las réplicas web).
- **OpenShift**: en vez de Ingress puede usarse un Route (ver nota en `k8s/ingress.yaml`).

## 7. CI/CD

- **GitHub Actions** (`.github/workflows/docker.yml`): build, escaneo Trivy y push a GHCR.
- **GitLab CI** (`.gitlab-ci.yml`): build con Kaniko, escaneo y deploy manual.

## 8. Variables de entorno

Ver `.env.example`. Los secretos (`DATABASE_URL`, `PRESTALO_SECRET`,
`ANTHROPIC_API_KEY`, SMTP, WhatsApp) se inyectan en tiempo de ejecución
mediante los Secrets del orquestador; nunca dentro de la imagen ni en el repo.
