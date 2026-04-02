# classifyre

Production-ready Helm chart for Classifyre (web, api, and Kubernetes CLI jobs)

## Purpose

This chart deploys Classifyre API and Web services with Kubernetes-native CLI job execution.

## Production Guidance

1. Use dedicated images for API, Web, and CLI jobs.
2. Prefer `postgres.mode=external` or `postgres.mode=cnpg` for production environments.
3. Treat `postgres.mode=embedded` as local/dev convenience.
4. Pin image tags to immutable versions (avoid `latest`).
5. Configure ingress TLS, resource requests/limits, and scheduling policy per environment.
6. Configure `CLASSIFYRE_MASKED_CONFIG_KEY` through Helm-managed or existing Kubernetes Secret.

## Masked Config Encryption Key (Production)

The API requires `CLASSIFYRE_MASKED_CONFIG_KEY` to encrypt/decrypt source `masked` fields.

### Option A: Existing Secret (recommended)

```bash
kubectl -n classifyre create secret generic classifyre-api-secrets \
  --from-literal=CLASSIFYRE_MASKED_CONFIG_KEY="$(openssl rand -base64 32)"

helm upgrade --install classifyre ./helm/classifyre \
  -n classifyre \
  --set api.maskedConfigEncryption.existingSecret='classifyre-api-secrets' \
  --set api.maskedConfigEncryption.secretKey='CLASSIFYRE_MASKED_CONFIG_KEY'
```

### Option B: Chart-managed Secret

- Set `api.maskedConfigEncryption.value` explicitly, or
- Leave `api.maskedConfigEncryption.autoGenerate=true` (default) to generate a random key.

The chart uses `lookup` to reuse an existing generated key on upgrades.

## Quick Start (External Postgres)

```bash
kubectl create namespace classifyre
kubectl -n classifyre create secret generic classifyre-db --from-literal=password='<db-password>'

helm upgrade --install classifyre ./helm/classifyre \
  -n classifyre \
  --set postgres.mode=external \
  --set postgres.external.host='<db-host>' \
  --set postgres.external.port=5432 \
  --set postgres.external.database='classifyre' \
  --set postgres.external.username='classifyre' \
  --set postgres.external.existingSecret='classifyre-db' \
  --set postgres.external.existingSecretPasswordKey='password'
```

## Quick Start (CloudNativePG)

```bash
helm upgrade --install classifyre ./helm/classifyre \
  -n classifyre \
  --create-namespace \
  --set postgres.mode=cnpg \
  --set postgres.cnpg.appPassword='<app-password>'
```

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| api.affinity | object | `{}` | API scheduling: affinity rules. When empty, default soft anti-affinity is applied. |
| api.args | list | `[]` | Optional API container args override. |
| api.autoscaling.enabled | bool | `true` | Enable HPA for API deployment. |
| api.autoscaling.maxReplicas | int | `10` | Maximum API replicas under HPA. |
| api.autoscaling.minReplicas | int | `2` | Minimum API replicas under HPA. |
| api.autoscaling.targetCPUUtilizationPercentage | int | `70` | Target average CPU utilization for API HPA. |
| api.autoscaling.targetMemoryUtilizationPercentage | int | `75` | Target average memory utilization for API HPA. |
| api.cliJobs.activeDeadlineSeconds | int | `3600` | Max runtime per CLI job (seconds). |
| api.cliJobs.affinity | object | `{}` | CLI job scheduling: affinity rules. |
| api.cliJobs.autoInstallOptionalDeps | bool | `true` | Allow CLI to auto-install optional detector dependencies. |
| api.cliJobs.automountServiceAccountToken | bool | `false` | Mount service account token into CLI job pods. |
| api.cliJobs.backoffLimit | int | `2` | Retry attempts for failed CLI jobs. |
| api.cliJobs.cleanupPolicy | string | `"always"` | Cleanup policy for CLI jobs: none, failed, or always. |
| api.cliJobs.containerSecurityContext | object | `{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]},"readOnlyRootFilesystem":false}` | Container security context for CLI job container. |
| api.cliJobs.enabled | bool | `true` | Enable Kubernetes-backed CLI jobs. |
| api.cliJobs.extraEnv | list | `[]` | Additional environment variables for CLI jobs (list of EnvVar objects; supports secretKeyRef etc.). |
| api.cliJobs.image.pullPolicy | string | `"IfNotPresent"` | CLI job image pull policy. |
| api.cliJobs.image.repository | string | `"classifyre/cli"` | CLI job image repository. |
| api.cliJobs.image.tag | string | `""` | CLI job image tag. Defaults to the chart appVersion when empty. |
| api.cliJobs.namespace | string | `""` | Namespace used for CLI jobs. Empty means release namespace. |
| api.cliJobs.nodeSelector | object | `{}` | CLI job scheduling: node selector. |
| api.cliJobs.podSecurityContext | object | `{"fsGroup":10001,"runAsGroup":10001,"runAsNonRoot":true,"runAsUser":10001,"seccompProfile":{"type":"RuntimeDefault"}}` | Pod security context for CLI job pods. |
| api.cliJobs.pollIntervalMs | int | `2000` | Poll interval while waiting for job completion (milliseconds). |
| api.cliJobs.priorityClassName | string | `""` | CLI job priority class. |
| api.cliJobs.resources.limits | object | `{"cpu":"2","memory":"4Gi"}` | CLI job resource limits. |
| api.cliJobs.resources.requests | object | `{"cpu":"500m","memory":"1Gi"}` | CLI job resource requests. |
| api.cliJobs.serviceAccountName | string | `""` | Service account for CLI jobs. Empty uses API service account. |
| api.cliJobs.tolerations | list | `[]` | CLI job scheduling: tolerations. |
| api.cliJobs.ttlSecondsAfterFinished | int | `1800` | TTL for completed CLI jobs (seconds). Ignored when cleanup policy deletes jobs immediately. |
| api.cliJobs.uvCache.accessModes | list | `["ReadWriteMany"]` | Access modes for uv cache PVC. |
| api.cliJobs.uvCache.enabled | bool | `true` | Enable shared PVC for uv cache. |
| api.cliJobs.uvCache.existingClaim | string | `""` | Existing PVC name for uv cache. Empty creates a new PVC. |
| api.cliJobs.uvCache.mountPath | string | `"/cache/uv"` | Mount path for uv cache in CLI job container. |
| api.cliJobs.uvCache.size | string | `"20Gi"` | Requested size for uv cache PVC. |
| api.cliJobs.uvCache.storageClassName | string | `""` | Storage class for uv cache PVC. |
| api.cliJobs.waitTimeoutSeconds | int | `3900` | Max time API waits for job completion (seconds). |
| api.cliJobs.workDir | string | `"/app/apps/cli"` | Working directory inside CLI job container. |
| api.command | list | `[]` | Optional API container command override. |
| api.containerSecurityContext.allowPrivilegeEscalation | bool | `false` | Disallow privilege escalation in API container. |
| api.containerSecurityContext.capabilities.drop | list | `["ALL"]` | Drop all Linux capabilities in API container. |
| api.containerSecurityContext.readOnlyRootFilesystem | bool | `false` | path the app writes to at runtime (e.g. /tmp, log dirs). Hardening step for advanced users. |
| api.env.ENVIRONMENT | string | `"kubernetes"` | Execution mode used by API. |
| api.env.NODE_ENV | string | `"production"` | Runtime environment passed to API container. |
| api.env.PORT | string | `"8000"` | API listen port. |
| api.env.RUNNER_LOGS_DIR | string | `"/var/lib/classifyre/runner-logs"` | Filesystem directory for runner execution logs. |
| api.env.TEMP_DIR | string | `"/tmp"` | Temporary directory used by API. |
| api.extraEnv | list | `[]` | Extra environment variables for API container. |
| api.extraEnvFrom | list | `[]` | Extra envFrom sources for API container. |
| api.image.pullPolicy | string | `"IfNotPresent"` | API image pull policy. |
| api.image.repository | string | `"classifyre/api"` | API container image repository. |
| api.image.tag | string | `""` | API container image tag. Defaults to the chart appVersion when empty. |
| api.lifecycle | object | `{"preStop":{"exec":{"command":["/bin/sh","-c","sleep 5"]}}}` | during rolling updates by giving kube-proxy time to drain in-flight requests. |
| api.livenessProbe.enabled | bool | `true` | Enable API liveness probe. |
| api.livenessProbe.failureThreshold | int | `6` | API liveness failure threshold. |
| api.livenessProbe.initialDelaySeconds | int | `30` | Delay before starting API liveness checks. |
| api.livenessProbe.path | string | `"/ping"` | HTTP path for API liveness probe. |
| api.livenessProbe.periodSeconds | int | `15` | API liveness check period. |
| api.livenessProbe.timeoutSeconds | int | `5` | API liveness check timeout. |
| api.maskedConfigEncryption.autoGenerate | bool | `true` | Generated key is persisted via Kubernetes Secret lookup across upgrades. |
| api.maskedConfigEncryption.existingSecret | string | `""` | When set, chart will not create or manage this secret. |
| api.maskedConfigEncryption.secretKey | string | `"CLASSIFYRE_MASKED_CONFIG_KEY"` | Secret key name used for CLASSIFYRE_MASKED_CONFIG_KEY. |
| api.maskedConfigEncryption.secretName | string | `""` | Secret name created by this chart when existingSecret is empty. |
| api.maskedConfigEncryption.value | string | `""` | Must be exactly 32 chars when using raw string format. |
| api.migration.containerSecurityContext | object | `{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]}}` | Override with runAsUser/runAsNonRoot: false if the migration toolchain requires root (e.g. Prisma on Bun). |
| api.migration.enabled | bool | `true` | Run database migrations as an API init container. |
| api.migration.script | string | `"npx prisma migrate deploy --schema /app/api/prisma/schema.prisma"` | Migration command/script. |
| api.nodeSelector | object | `{}` | API scheduling: node selector. |
| api.pdb.enabled | bool | `true` | Enable PodDisruptionBudget for API deployment. |
| api.pdb.minAvailable | int | `1` | API minimum pods available during disruptions. |
| api.podAnnotations | object | `{}` | Additional pod annotations for API deployment. |
| api.podLabels | object | `{}` | Additional pod labels for API deployment. |
| api.podSecurityContext.fsGroup | int | `10001` | API fsGroup for mounted volumes. |
| api.podSecurityContext.runAsGroup | int | `10001` | API pod group ID. |
| api.podSecurityContext.runAsNonRoot | bool | `true` | Require API container to run as non-root. |
| api.podSecurityContext.runAsUser | int | `10001` | API pod user ID. |
| api.podSecurityContext.seccompProfile.type | string | `"RuntimeDefault"` | API pod seccomp profile type. |
| api.priorityClassName | string | `""` | API pod priority class. |
| api.readinessProbe.enabled | bool | `true` | Enable API readiness probe. |
| api.readinessProbe.failureThreshold | int | `6` | API readiness failure threshold. |
| api.readinessProbe.initialDelaySeconds | int | `10` | Delay before starting API readiness checks. |
| api.readinessProbe.path | string | `"/ping"` | HTTP path for API readiness probe. |
| api.readinessProbe.periodSeconds | int | `10` | API readiness check period. |
| api.readinessProbe.timeoutSeconds | int | `3` | API readiness check timeout. |
| api.replicaCount | int | `2` | Number of API replicas when autoscaling is disabled. |
| api.resources.limits | object | `{"cpu":"1","memory":"1Gi"}` | API resource limits. |
| api.resources.requests | object | `{"cpu":"250m","memory":"512Mi"}` | API resource requests. |
| api.runnerLogs.accessModes | list | `["ReadWriteMany"]` | Access modes for runner logs PVC. |
| api.runnerLogs.enabled | bool | `true` | Enable PVC-backed storage for runner logs. |
| api.runnerLogs.existingClaim | string | `""` | Existing PVC name for runner logs. Empty creates a new PVC. |
| api.runnerLogs.mountPath | string | `"/var/lib/classifyre/runner-logs"` | Mount path for runner logs directory. |
| api.runnerLogs.size | string | `"20Gi"` | Requested size for runner logs PVC. |
| api.runnerLogs.storageClassName | string | `""` | Storage class for runner logs PVC. |
| api.service.annotations | object | `{}` | Additional API service annotations. |
| api.service.nodePort | string | `nil` | Fixed nodePort when `type` is `NodePort` or `LoadBalancer`. |
| api.service.port | int | `8000` | API service port. |
| api.service.type | string | `"ClusterIP"` | API service type. |
| api.startCommand | string | `"node dist/src/main.js"` | Default API process command when `command/args` are not set. |
| api.startupProbe.enabled | bool | `true` | Enable API startup probe. |
| api.startupProbe.failureThreshold | int | `30` | API startup failure threshold. |
| api.startupProbe.path | string | `"/ping"` | HTTP path for API startup probe. |
| api.startupProbe.periodSeconds | int | `10` | API startup check period. |
| api.startupProbe.timeoutSeconds | int | `3` | API startup check timeout. |
| api.strategy | object | `{}` | API deployment strategy override. |
| api.terminationGracePeriodSeconds | string | `nil` | API pod termination grace period (seconds). Set to null to use Kubernetes default. |
| api.tolerations | list | `[]` | API scheduling: tolerations. |
| api.topologySpreadConstraints | list | `[]` | API topology spread constraints. When empty, a default hostname spread is applied. |
| api.workingDir | string | `""` | Working directory used by default shell command. |
| commonAnnotations | object | `{}` | Additional annotations added to supported chart resources. |
| commonLabels | object | `{}` | Additional labels added to all chart resources. |
| frontend.affinity | object | `{}` | Web scheduling: affinity rules. When empty, default soft anti-affinity is applied. |
| frontend.args | list | `[]` | Optional web container args override. |
| frontend.autoscaling.enabled | bool | `true` | Enable HPA for web deployment. |
| frontend.autoscaling.maxReplicas | int | `10` | Maximum web replicas under HPA. |
| frontend.autoscaling.minReplicas | int | `2` | Minimum web replicas under HPA. |
| frontend.autoscaling.targetCPUUtilizationPercentage | int | `70` | Target average CPU utilization for web HPA. |
| frontend.autoscaling.targetMemoryUtilizationPercentage | int | `75` | Target average memory utilization for web HPA. |
| frontend.command | list | `[]` | Optional web container command override. |
| frontend.containerSecurityContext.allowPrivilegeEscalation | bool | `false` | Disallow privilege escalation in web container. |
| frontend.containerSecurityContext.capabilities.drop | list | `["ALL"]` | Drop all Linux capabilities in web container. |
| frontend.containerSecurityContext.readOnlyRootFilesystem | bool | `false` | path the app writes to at runtime. Hardening step for advanced users. |
| frontend.env.HOSTNAME | string | `"0.0.0.0"` | Bind address for Next.js standalone server. |
| frontend.env.NEXT_PUBLIC_API_URL | string | `"/api"` | Browser-side API base path. |
| frontend.env.NODE_ENV | string | `"production"` | Runtime environment passed to web container. |
| frontend.env.PORT | string | `"3100"` | Web listen port. |
| frontend.extraEnv | list | `[]` | Extra environment variables for web container. |
| frontend.extraEnvFrom | list | `[]` | Extra envFrom sources for web container. |
| frontend.image.pullPolicy | string | `"IfNotPresent"` | Web image pull policy. |
| frontend.image.repository | string | `"classifyre/web"` | Web container image repository. |
| frontend.image.tag | string | `""` | Web container image tag. Defaults to the chart appVersion when empty. |
| frontend.lifecycle | object | `{"preStop":{"exec":{"command":["/bin/sh","-c","sleep 5"]}}}` | Lifecycle hooks for the web container. |
| frontend.livenessProbe.enabled | bool | `true` | Enable web liveness probe. |
| frontend.livenessProbe.failureThreshold | int | `6` | Web liveness failure threshold. |
| frontend.livenessProbe.initialDelaySeconds | int | `30` | Delay before starting web liveness checks. |
| frontend.livenessProbe.path | string | `"/"` | HTTP path for web liveness probe. |
| frontend.livenessProbe.periodSeconds | int | `15` | Web liveness check period. |
| frontend.livenessProbe.timeoutSeconds | int | `5` | Web liveness check timeout. |
| frontend.nodeSelector | object | `{}` | Web scheduling: node selector. |
| frontend.pdb.enabled | bool | `true` | Enable PodDisruptionBudget for web deployment. |
| frontend.pdb.minAvailable | int | `1` | Web minimum pods available during disruptions. |
| frontend.podAnnotations | object | `{}` | Additional pod annotations for web deployment. |
| frontend.podLabels | object | `{}` | Additional pod labels for web deployment. |
| frontend.podSecurityContext.fsGroup | int | `10001` | Web fsGroup for mounted volumes. |
| frontend.podSecurityContext.runAsGroup | int | `10001` | Web pod group ID. |
| frontend.podSecurityContext.runAsNonRoot | bool | `true` | Require web container to run as non-root. |
| frontend.podSecurityContext.runAsUser | int | `10001` | Web pod user ID. |
| frontend.podSecurityContext.seccompProfile.type | string | `"RuntimeDefault"` | Web pod seccomp profile type. |
| frontend.priorityClassName | string | `""` | Web pod priority class. |
| frontend.readinessProbe.enabled | bool | `true` | Enable web readiness probe. |
| frontend.readinessProbe.failureThreshold | int | `6` | Web readiness failure threshold. |
| frontend.readinessProbe.initialDelaySeconds | int | `10` | Delay before starting web readiness checks. |
| frontend.readinessProbe.path | string | `"/"` | HTTP path for web readiness probe. |
| frontend.readinessProbe.periodSeconds | int | `10` | Web readiness check period. |
| frontend.readinessProbe.timeoutSeconds | int | `3` | Web readiness check timeout. |
| frontend.replicaCount | int | `2` | Number of web replicas when autoscaling is disabled. |
| frontend.resources.limits | object | `{"cpu":"1","memory":"1Gi"}` | Web resource limits. |
| frontend.resources.requests | object | `{"cpu":"200m","memory":"384Mi"}` | Web resource requests. |
| frontend.service.annotations | object | `{}` | Additional web service annotations. |
| frontend.service.nodePort | string | `nil` | Fixed nodePort when `type` is `NodePort` or `LoadBalancer`. |
| frontend.service.port | int | `3100` | Web service port. |
| frontend.service.type | string | `"ClusterIP"` | Web service type. |
| frontend.startCommand | string | `"node /app/apps/web/server.js"` | Default web process command when `command/args` are not set. |
| frontend.startupProbe.enabled | bool | `true` | Enable web startup probe. |
| frontend.startupProbe.failureThreshold | int | `30` | Web startup failure threshold. |
| frontend.startupProbe.path | string | `"/"` | HTTP path for web startup probe. |
| frontend.startupProbe.periodSeconds | int | `10` | Web startup check period. |
| frontend.startupProbe.timeoutSeconds | int | `3` | Web startup check timeout. |
| frontend.strategy | object | `{}` | Web deployment strategy override. |
| frontend.terminationGracePeriodSeconds | string | `nil` | Web pod termination grace period (seconds). Set to null to use Kubernetes default. |
| frontend.tolerations | list | `[]` | Web scheduling: tolerations. |
| frontend.topologySpreadConstraints | list | `[]` | Web topology spread constraints. When empty, a default hostname spread is applied. |
| fullnameOverride | string | `""` | Fully override release-based resource names. |
| imagePullSecrets | list | `[]` | Image pull secrets for all workloads. |
| ingress.annotations | object | `{}` | Shared ingress annotations (nginx-specific rewrite annotations are applied to API ingress automatically). |
| ingress.className | string | `"nginx"` | Ingress class name. |
| ingress.enabled | bool | `false` | Enable ingress resources for web/api/socket routes. |
| ingress.host | string | `""` | Hostname for all ingress rules. Required when ingress.enabled=true. |
| ingress.tls | list | `[]` | TLS configuration for ingress. |
| nameOverride | string | `""` | Override chart name used in resource names. |
| networkPolicy.enabled | bool | `false` | Enable network policies for API and web pods. |
| networkPolicy.ingressNamespaceSelector | object | `{}` | Namespace selector allowed to reach API/web when network policy is enabled. |
| postgres.cnpg.appPassword | string | `""` | Application password for generated CNPG secret. |
| postgres.cnpg.bootstrapSecretName | string | `""` | Existing CNPG app secret name. |
| postgres.cnpg.clusterName | string | `"classifyre-cnpg"` | CloudNativePG cluster resource name. |
| postgres.cnpg.database | string | `"classifyre"` | Database bootstrapped by CNPG. |
| postgres.cnpg.imageName | string | `"ghcr.io/cloudnative-pg/postgresql:17"` | CNPG Postgres image. |
| postgres.cnpg.instances | int | `3` | Number of CNPG instances. |
| postgres.cnpg.storage.size | string | `"20Gi"` | CNPG storage size per instance. |
| postgres.cnpg.storage.storageClassName | string | `""` | CNPG storage class name. |
| postgres.cnpg.superuserSecretName | string | `""` | Existing CNPG superuser secret name. |
| postgres.cnpg.user | string | `"classifyre"` | Owner user bootstrapped by CNPG. |
| postgres.connection.sslMode | string | `"disable"` | sslmode used by API when connecting to PostgreSQL (`disable`, `require`, `verify-ca`, `verify-full`). |
| postgres.embedded.affinity | object | `{}` | Embedded Postgres scheduling: affinity rules. |
| postgres.embedded.containerSecurityContext | object | `{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]}}` | Embedded Postgres container security context. |
| postgres.embedded.database | string | `"classifyre"` | Embedded Postgres database name. |
| postgres.embedded.existingSecret | string | `""` | Existing secret name holding embedded Postgres password. |
| postgres.embedded.existingSecretPasswordKey | string | `"password"` | Secret key name for embedded Postgres password. |
| postgres.embedded.image.pullPolicy | string | `"IfNotPresent"` | Embedded Postgres image pull policy. |
| postgres.embedded.image.repository | string | `"postgres"` | Embedded Postgres image repository. |
| postgres.embedded.image.tag | string | `"18"` | Embedded Postgres image tag. |
| postgres.embedded.nodeSelector | object | `{}` | Embedded Postgres scheduling: node selector. |
| postgres.embedded.password | string | `""` | Embedded Postgres password (required when existingSecret is empty). |
| postgres.embedded.persistence.accessModes | list | `["ReadWriteOnce"]` | Access modes for embedded Postgres PVC. |
| postgres.embedded.persistence.enabled | bool | `true` | Enable persistent volume for embedded Postgres data. |
| postgres.embedded.persistence.existingClaim | string | `""` | Existing PVC name for embedded Postgres data. |
| postgres.embedded.persistence.size | string | `"20Gi"` | Requested size for embedded Postgres PVC. |
| postgres.embedded.persistence.storageClassName | string | `""` | Storage class for embedded Postgres PVC. |
| postgres.embedded.podAnnotations | object | `{}` | Additional annotations for embedded Postgres pod. |
| postgres.embedded.podLabels | object | `{}` | Additional labels for embedded Postgres pod. |
| postgres.embedded.podSecurityContext | object | `{"fsGroup":999,"runAsGroup":999,"runAsUser":999,"seccompProfile":{"type":"RuntimeDefault"}}` | Embedded Postgres pod security context. |
| postgres.embedded.port | int | `5432` | Embedded Postgres service and container port. |
| postgres.embedded.priorityClassName | string | `""` | Embedded Postgres pod priority class. |
| postgres.embedded.resources.limits | object | `{"cpu":"1","memory":"1Gi"}` | Embedded Postgres resource limits. |
| postgres.embedded.resources.requests | object | `{"cpu":"100m","memory":"256Mi"}` | Embedded Postgres resource requests. |
| postgres.embedded.service.annotations | object | `{}` | Additional annotations for embedded Postgres service. |
| postgres.embedded.terminationGracePeriodSeconds | string | `nil` | Embedded Postgres pod termination grace period (seconds). Set to null to use Kubernetes default. |
| postgres.embedded.tolerations | list | `[]` | Embedded Postgres scheduling: tolerations. |
| postgres.embedded.username | string | `"postgres"` | Embedded Postgres user name. |
| postgres.external.database | string | `"classifyre"` | External Postgres database name. |
| postgres.external.existingSecret | string | `""` | Existing secret name for external Postgres credentials. |
| postgres.external.existingSecretPasswordKey | string | `"password"` | Secret key name for external Postgres password. |
| postgres.external.existingSecretUrlKey | string | `""` | Optional secret key containing full DATABASE_URL. |
| postgres.external.host | string | `""` | External Postgres host. |
| postgres.external.password | string | `""` | External Postgres password (required when existingSecret is empty). |
| postgres.external.port | int | `5432` | External Postgres port. |
| postgres.external.sslMode | string | `"disable"` | Deprecated: use `postgres.connection.sslMode` instead. |
| postgres.external.username | string | `"classifyre"` | External Postgres user name. |
| postgres.mode | string | `"external"` | PostgreSQL mode: external, cnpg, or embedded. |
| priorityClasses.batchName | string | `"batch-low-priority"` | Priority class name for batch workloads. |
| priorityClasses.batchValue | int | `1000` | Numeric priority value for batch workloads. |
| priorityClasses.create | bool | `false` | Create service and batch priority classes. |
| priorityClasses.serviceName | string | `"service-standard"` | Priority class name for service workloads. |
| priorityClasses.serviceValue | int | `10000` | Numeric priority value for service workloads. |
| rbac.create | bool | `true` | Create Role/RoleBinding for API CLI job orchestration. |
| serviceAccount.annotations | object | `{}` | Extra annotations for the API service account. |
| serviceAccount.automount | bool | `true` | Mount service account token into API pods (required for Kubernetes CLI jobs). |
| serviceAccount.create | bool | `true` | Create the API service account. |
| serviceAccount.name | string | `""` | Existing service account name to use when `create=false`. |
