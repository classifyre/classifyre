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
