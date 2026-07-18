{{- define "classifyre.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "classifyre.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "classifyre.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "classifyre.commonLabels" -}}
app.kubernetes.io/name: {{ include "classifyre.name" . }}
helm.sh/chart: {{ include "classifyre.chart" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{- define "classifyre.selectorLabels" -}}
app.kubernetes.io/name: {{ include "classifyre.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "classifyre.api.fullname" -}}
{{- printf "%s-api" (include "classifyre.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "classifyre.web.fullname" -}}
{{- printf "%s-web" (include "classifyre.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "classifyre.worker.fullname" -}}
{{- printf "%s-worker" (include "classifyre.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "classifyre.postgres.fullname" -}}
{{- printf "%s-postgres" (include "classifyre.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "classifyre.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (printf "%s-api" (include "classifyre.fullname" .)) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "classifyre.databaseHost" -}}
{{- if eq .Values.postgres.mode "cnpg" -}}
{{- printf "%s-rw" .Values.postgres.cnpg.clusterName -}}
{{- else if eq .Values.postgres.mode "embedded" -}}
{{- include "classifyre.postgres.fullname" . -}}
{{- else -}}
{{- .Values.postgres.external.host -}}
{{- end -}}
{{- end -}}

{{- define "classifyre.databasePort" -}}
{{- if eq .Values.postgres.mode "cnpg" -}}
5432
{{- else if eq .Values.postgres.mode "embedded" -}}
{{- .Values.postgres.embedded.port | toString -}}
{{- else -}}
{{- .Values.postgres.external.port | toString -}}
{{- end -}}
{{- end -}}

{{- define "classifyre.databaseName" -}}
{{- if eq .Values.postgres.mode "cnpg" -}}
{{- .Values.postgres.cnpg.database -}}
{{- else if eq .Values.postgres.mode "embedded" -}}
{{- .Values.postgres.embedded.database -}}
{{- else -}}
{{- .Values.postgres.external.database -}}
{{- end -}}
{{- end -}}

{{- define "classifyre.databaseUser" -}}
{{- if eq .Values.postgres.mode "cnpg" -}}
{{- .Values.postgres.cnpg.user -}}
{{- else if eq .Values.postgres.mode "embedded" -}}
{{- .Values.postgres.embedded.username -}}
{{- else -}}
{{- .Values.postgres.external.username -}}
{{- end -}}
{{- end -}}

{{- define "classifyre.databaseSecretName" -}}
{{- if eq .Values.postgres.mode "cnpg" -}}
{{- default (printf "%s-app" .Values.postgres.cnpg.clusterName) .Values.postgres.cnpg.bootstrapSecretName -}}
{{- else if eq .Values.postgres.mode "embedded" -}}
{{- default (printf "%s-db" (include "classifyre.fullname" .)) .Values.postgres.embedded.existingSecret -}}
{{- else -}}
{{- default (printf "%s-db" (include "classifyre.fullname" .)) .Values.postgres.external.existingSecret -}}
{{- end -}}
{{- end -}}

{{- define "classifyre.databasePasswordKey" -}}
{{- if eq .Values.postgres.mode "cnpg" -}}
password
{{- else if eq .Values.postgres.mode "embedded" -}}
{{- default "password" .Values.postgres.embedded.existingSecretPasswordKey -}}
{{- else -}}
{{- default "password" .Values.postgres.external.existingSecretPasswordKey -}}
{{- end -}}
{{- end -}}

{{- define "classifyre.databaseSslMode" -}}
{{- if and .Values.postgres.connection .Values.postgres.connection.sslMode -}}
{{- .Values.postgres.connection.sslMode -}}
{{- else -}}
{{- .Values.postgres.external.sslMode | default "disable" -}}
{{- end -}}
{{- end -}}

{{- define "classifyre.apiMaskedConfigSecretName" -}}
{{- if .Values.api.maskedConfigEncryption.existingSecret -}}
{{- .Values.api.maskedConfigEncryption.existingSecret -}}
{{- else -}}
{{- default (printf "%s-api-secrets" (include "classifyre.fullname" .)) .Values.api.maskedConfigEncryption.secretName -}}
{{- end -}}
{{- end -}}

{{- define "classifyre.apiMaskedConfigSecretKey" -}}
{{- default "CLASSIFYRE_MASKED_CONFIG_KEY" .Values.api.maskedConfigEncryption.secretKey -}}
{{- end -}}

{{/*
Resolved OTLP endpoint. Empty string when telemetry is disabled or no endpoint configured.
*/}}
{{- define "classifyre.otelEndpoint" -}}
{{- if .Values.telemetry.enabled -}}
{{- .Values.telemetry.otlpEndpoint -}}
{{- end -}}
{{- end -}}

{{/*
Name of the instance-ID ConfigMap.
*/}}
{{- define "classifyre.instanceIdConfigMapName" -}}
{{- if .Values.telemetry.instanceId.existingConfigMap -}}
{{- .Values.telemetry.instanceId.existingConfigMap -}}
{{- else -}}
{{- printf "%s-instance-id" (include "classifyre.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/*
S3 endpoint URL injected into the API. Empty string means AWS S3 (SDK auto-resolves).
*/}}
{{- define "classifyre.s3Endpoint" -}}
{{- .Values.objectStorage.endpoint -}}
{{- end -}}

{{/*
Name of the Kubernetes Secret holding S3 access-key-id and secret-access-key.
*/}}
{{- define "classifyre.s3SecretName" -}}
{{- if .Values.objectStorage.existingSecret -}}
  {{- .Values.objectStorage.existingSecret -}}
{{- else -}}
  {{- printf "%s-s3-credentials" (include "classifyre.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "classifyre.s3SecretAccessKeyIdKey" -}}
{{- .Values.objectStorage.existingSecretAccessKeyIdKey -}}
{{- end -}}

{{- define "classifyre.s3SecretSecretAccessKeyKey" -}}
{{- .Values.objectStorage.existingSecretSecretAccessKeyKey -}}
{{- end -}}

{{/*
Shared OTel environment variables injected into API, web, and CLI job containers.
Renders nothing when telemetry is disabled.
*/}}
{{- define "classifyre.telemetryEnv" -}}
{{- if .Values.telemetry.enabled -}}
- name: OTEL_EXPORTER_OTLP_ENDPOINT
  value: {{ include "classifyre.otelEndpoint" . | quote }}
- name: OTEL_EXPORTER_OTLP_PROTOCOL
  value: {{ .Values.telemetry.otlpProtocol | quote }}
- name: DEPLOY_ENV
  value: {{ .Values.telemetry.deployEnv | quote }}
{{- if .Values.telemetry.instanceId.enabled }}
- name: CLASSIFYRE_INSTANCE_ID
  valueFrom:
    configMapKeyRef:
      name: {{ include "classifyre.instanceIdConfigMapName" . }}
      key: {{ .Values.telemetry.instanceId.configMapKey }}
      optional: true
{{- end }}
{{- else -}}
- name: TELEMETRY_DISABLED
  value: "1"
{{- end -}}
{{- end -}}

{{/*
Shared runtime environment variables for API-image containers (API and worker
deployments): DB connection, masked-config key, embedding config, user-supplied
env, object storage, and telemetry. Both deployments run the exact same image and
process (`startCommand`), so they must see identical env aside from SERVICE_ROLE,
which each deployment sets on its own after including this block.
*/}}
{{- define "classifyre.api.env" -}}
- name: DB_HOST
  value: {{ include "classifyre.databaseHost" . | quote }}
- name: DB_PORT
  value: {{ include "classifyre.databasePort" . | quote }}
- name: DB_NAME
  value: {{ include "classifyre.databaseName" . | quote }}
- name: DB_USER
  value: {{ include "classifyre.databaseUser" . | quote }}
- name: DB_SSLMODE
  value: {{ include "classifyre.databaseSslMode" . | quote }}
- name: DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "classifyre.databaseSecretName" . }}
      key: {{ include "classifyre.databasePasswordKey" . }}
- name: CLASSIFYRE_MASKED_CONFIG_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "classifyre.apiMaskedConfigSecretName" . }}
      key: {{ include "classifyre.apiMaskedConfigSecretKey" . }}
- name: CLASSIFYRE_AUTO_MIGRATE
  value: {{ ternary "false" "true" .Values.api.migration.enabled | quote }}
{{- if and (eq .Values.postgres.mode "external") .Values.postgres.external.existingSecret .Values.postgres.external.existingSecretUrlKey }}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "classifyre.databaseSecretName" . }}
      key: {{ .Values.postgres.external.existingSecretUrlKey }}
{{- end }}
- name: EMBEDDING_ENABLED
  value: {{ .Values.api.embedding.enabled | quote }}
{{- if .Values.api.embedding.enabled }}
- name: EMBEDDING_PROVIDER
  value: {{ .Values.api.embedding.provider | quote }}
- name: EMBEDDING_MODEL
  value: {{ .Values.api.embedding.model | quote }}
- name: EMBEDDING_MODEL_REVISION
  value: {{ .Values.api.embedding.revision | quote }}
- name: EMBEDDING_DIMENSIONS
  value: {{ .Values.api.embedding.dimensions | quote }}
- name: EMBEDDING_POOLING
  value: {{ .Values.api.embedding.pooling | quote }}
- name: EMBEDDING_NORMALIZE
  value: {{ .Values.api.embedding.normalize | quote }}
- name: EMBEDDING_DTYPE
  value: {{ .Values.api.embedding.dtype | quote }}
- name: EMBEDDING_DEVICE
  value: {{ .Values.api.embedding.device | quote }}
- name: EMBEDDING_ALLOW_REMOTE_MODELS
  value: {{ .Values.api.embedding.allowRemoteModels | quote }}
{{- with .Values.api.embedding.localModelPath }}
- name: EMBEDDING_LOCAL_MODEL_PATH
  value: {{ . | quote }}
{{- end }}
- name: EMBEDDING_CACHE_DIR
  value: {{ .Values.api.embedding.cacheDir | quote }}
- name: EMBEDDING_BATCH_SIZE
  value: {{ .Values.api.embedding.batchSize | quote }}
- name: EMBEDDING_RETRY_SECONDS
  value: {{ .Values.api.embedding.retrySeconds | quote }}
- name: EMBEDDING_AUTO_BACKFILL
  value: {{ .Values.api.embedding.autoBackfill | quote }}
- name: EMBEDDING_WORKER_CONCURRENCY
  value: {{ .Values.api.embedding.workerConcurrency | quote }}
- name: EMBEDDING_MAX_PARALLEL_CALLS
  value: {{ .Values.api.embedding.maxParallelCalls | quote }}
- name: EMBEDDING_HNSW_M
  value: {{ .Values.api.embedding.hnsw.m | quote }}
- name: EMBEDDING_HNSW_EF_CONSTRUCTION
  value: {{ .Values.api.embedding.hnsw.efConstruction | quote }}
- name: EMBEDDING_HNSW_EF_SEARCH
  value: {{ .Values.api.embedding.hnsw.efSearch | quote }}
{{- with .Values.api.embedding.external.baseUrl }}
- name: EMBEDDING_BASE_URL
  value: {{ . | quote }}
{{- end }}
{{- with .Values.api.embedding.external.existingSecret }}
- name: EMBEDDING_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ . }}
      key: {{ $.Values.api.embedding.external.apiKeyKey }}
{{- end }}
{{- end }}
{{- range $key, $value := .Values.api.env }}
- name: {{ $key }}
  value: {{ $value | quote }}
{{- end }}
- name: POD_NAMESPACE
  valueFrom:
    fieldRef:
      fieldPath: metadata.namespace
{{- if .Values.api.cliJobs.enabled }}
- name: K8S_JOBS_ENABLED
  value: {{ ternary "1" "0" .Values.api.cliJobs.enabled | quote }}
- name: K8S_JOBS_NAMESPACE
  value: {{ default .Release.Namespace .Values.api.cliJobs.namespace | quote }}
- name: K8S_CLI_JOB_TEMPLATE_PATH
  value: /etc/classifyre/cli-job-template/job-template.json
- name: K8S_CLI_JOB_WAIT_TIMEOUT_SECONDS
  value: {{ .Values.api.cliJobs.waitTimeoutSeconds | quote }}
- name: K8S_CLI_JOB_POLL_INTERVAL_MS
  value: {{ .Values.api.cliJobs.pollIntervalMs | quote }}
- name: K8S_CLI_JOB_CLEANUP_POLICY
  value: {{ .Values.api.cliJobs.cleanupPolicy | quote }}
- name: K8S_CLI_JOB_WORKDIR
  value: {{ .Values.api.cliJobs.workDir | quote }}
{{- if .Values.api.cliJobs.huggingFace.existingSecret }}
- name: HF_TOKEN_INSTANCE_SET
  value: "1"
{{- end }}
{{- end }}
{{- /* ── S3 / object-storage configuration ─────────────────── */}}
- name: S3_CONFIGURED
  value: {{ .Values.objectStorage.enabled | quote }}
{{- if .Values.objectStorage.enabled }}
- name: S3_BUCKET
  value: {{ .Values.objectStorage.bucket | quote }}
- name: S3_LOG_PREFIX
  value: {{ .Values.objectStorage.logPrefix | quote }}
- name: S3_REGION
  value: {{ .Values.objectStorage.region | quote }}
- name: S3_FORCE_PATH_STYLE
  value: {{ .Values.objectStorage.forcePathStyle | quote }}
{{- $s3Endpoint := include "classifyre.s3Endpoint" . }}
{{- if $s3Endpoint }}
- name: S3_ENDPOINT
  value: {{ $s3Endpoint | quote }}
{{- end }}
- name: S3_ACCESS_KEY_ID
  valueFrom:
    secretKeyRef:
      name: {{ include "classifyre.s3SecretName" . }}
      key: {{ include "classifyre.s3SecretAccessKeyIdKey" . }}
- name: S3_SECRET_ACCESS_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "classifyre.s3SecretName" . }}
      key: {{ include "classifyre.s3SecretSecretAccessKeyKey" . }}
{{- end }}
{{- include "classifyre.telemetryEnv" . | nindent 0 }}
{{- with .Values.api.extraEnv }}
{{- toYaml . | nindent 0 }}
{{- end }}
{{- end -}}
