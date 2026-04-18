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
S3 endpoint URL for the API and init jobs.
  - SeaweedFS: derived from the release name and configured S3 port.
  - External  : objectStorage.external.endpoint (may be empty for AWS S3).
*/}}
{{- define "classifyre.s3Endpoint" -}}
{{- if .Values.objectStorage.seaweedfs.enabled -}}
  {{- if .Values.objectStorage.seaweedfs.endpointOverride -}}
    {{- .Values.objectStorage.seaweedfs.endpointOverride -}}
  {{- else -}}
    {{- printf "http://%s-seaweedfs-s3.%s.svc.cluster.local:%d" .Release.Name .Release.Namespace (.Values.objectStorage.seaweedfs.s3Port | int) -}}
  {{- end -}}
{{- else -}}
  {{- .Values.objectStorage.external.endpoint -}}
{{- end -}}
{{- end -}}

{{/*
Name of the secret that holds S3 access-key-id and secret-access-key.
*/}}
{{- define "classifyre.s3SecretName" -}}
{{- if .Values.objectStorage.seaweedfs.enabled -}}
  {{- default (printf "%s-s3-credentials" (include "classifyre.fullname" .)) .Values.objectStorage.seaweedfs.existingSecret -}}
{{- else -}}
  {{- default (printf "%s-s3-credentials" (include "classifyre.fullname" .)) .Values.objectStorage.external.existingSecret -}}
{{- end -}}
{{- end -}}

{{/*
Key names inside the S3 credentials secret.
*/}}
{{- define "classifyre.s3SecretAccessKeyIdKey" -}}
{{- if .Values.objectStorage.seaweedfs.enabled -}}
  {{- .Values.objectStorage.seaweedfs.existingSecretAccessKeyIdKey -}}
{{- else -}}
  {{- .Values.objectStorage.external.existingSecretAccessKeyIdKey -}}
{{- end -}}
{{- end -}}

{{- define "classifyre.s3SecretSecretAccessKeyKey" -}}
{{- if .Values.objectStorage.seaweedfs.enabled -}}
  {{- .Values.objectStorage.seaweedfs.existingSecretSecretAccessKeyKey -}}
{{- else -}}
  {{- .Values.objectStorage.external.existingSecretSecretAccessKeyKey -}}
{{- end -}}
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
