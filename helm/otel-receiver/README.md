# otel-receiver

![Version: 0.1.0](https://img.shields.io/badge/Version-0.1.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square)

Self-hosted observability stack for Classifyre — OpenTelemetry Collector gateway in front of Grafana, Tempo (traces), Loki (logs) and Mimir (metrics).  Deploy this chart once, then point every Classifyre instance at the Collector endpoint.

**Homepage:** <https://github.com/unstructured/classifyre>

## Maintainers

| Name | Email | Url |
| ---- | ------ | --- |
| Classifyre Team |  |  |

## Requirements

| Repository | Name | Version |
|------------|------|---------|
| https://grafana.github.io/helm-charts | grafana | 10.5.15 |
| https://grafana.github.io/helm-charts | loki | 7.0.0 |
| https://grafana.github.io/helm-charts | mimir-distributed | 6.1.0 |
| https://grafana.github.io/helm-charts | promtail | 6.17.1 |
| https://grafana.github.io/helm-charts | tempo | 1.24.4 |
| https://open-telemetry.github.io/opentelemetry-helm-charts | opentelemetry-collector | 0.159.1 |

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| grafana | object | `{"adminPassword":"changeme","enabled":true,"grafana.ini":{"analytics":{"check_for_updates":false,"reporting_enabled":false},"server":{"root_url":"%(protocol)s://%(domain)s/"}},"initChownData":{"enabled":false},"persistence":{"enabled":true,"size":"5Gi"},"resources":{"limits":{"cpu":"1","memory":"512Mi"},"requests":{"cpu":"100m","memory":"128Mi"}},"sidecar":{"dashboards":{"enabled":true,"folderAnnotation":"grafana_folder","label":"grafana_dashboard","labelValue":"1","provider":{"foldersFromFilesStructure":false}},"datasources":{"enabled":true,"label":"grafana_datasource","labelValue":"1"}}}` | ------------------------------------------------------------------------- |
| loki | object | `{"backend":{"replicas":0},"chunksCache":{"enabled":false},"deploymentMode":"SingleBinary","enabled":true,"loki":{"auth_enabled":false,"commonConfig":{"replication_factor":1},"schemaConfig":{"configs":[{"from":"2024-01-01","index":{"period":"24h","prefix":"loki_index_"},"object_store":"filesystem","schema":"v13","store":"tsdb"}]},"storage":{"type":"filesystem"}},"read":{"replicas":0},"resultsCache":{"enabled":false},"singleBinary":{"persistence":{"enabled":true,"size":"20Gi"},"replicas":1,"resources":{"limits":{"cpu":"2","memory":"2Gi"},"requests":{"cpu":"100m","memory":"256Mi"}}},"write":{"replicas":0}}` | ------------------------------------------------------------------------- |
| mimir-distributed | object | `{"alertmanager":{"enabled":true,"replicas":1,"resources":{"requests":{"cpu":"50m","memory":"128Mi"}}},"compactor":{"persistentVolume":{"enabled":true,"size":"20Gi"},"replicas":1,"resources":{"requests":{"cpu":"100m","memory":"256Mi"}}},"distributor":{"replicas":1,"resources":{"requests":{"cpu":"100m","memory":"256Mi"}}},"enabled":true,"global":{"extraEnvFrom":[]},"ingester":{"persistentVolume":{"enabled":true,"size":"20Gi"},"replicas":1,"resources":{"limits":{"cpu":"2","memory":"4Gi"},"requests":{"cpu":"100m","memory":"512Mi"}}},"mimir":{"structuredConfig":{"alertmanager_storage":{"backend":"filesystem","filesystem":{"dir":"/data/mimir/alertmanager"}},"blocks_storage":{"backend":"filesystem","filesystem":{"dir":"/data/mimir/blocks"}},"common":{"storage":{"backend":"filesystem","filesystem":{"dir":"/data/mimir"}}},"compactor":{"data_dir":"/data/mimir/compactor"},"multitenancy_enabled":false,"ruler_storage":{"backend":"filesystem","filesystem":{"dir":"/data/mimir/ruler"}}}},"querier":{"replicas":1,"resources":{"requests":{"cpu":"100m","memory":"256Mi"}}},"query-frontend":{"replicas":1,"resources":{"requests":{"cpu":"100m","memory":"128Mi"}}},"ruler":{"replicas":1,"resources":{"requests":{"cpu":"50m","memory":"128Mi"}}},"store-gateway":{"persistentVolume":{"enabled":true,"size":"20Gi"},"replicas":1,"resources":{"requests":{"cpu":"100m","memory":"256Mi"}}}}` | ------------------------------------------------------------------------- |
| opentelemetry-collector | object | `{"config":{"exporters":{"debug":{"verbosity":"basic"},"loki":{"default_labels_enabled":{"exporter":false,"job":true,"service_name":true},"endpoint":"http://{{ .Release.Name }}-loki-gateway:80/loki/api/v1/push","headers":{"X-Scope-OrgID":"classifyre"}},"otlphttp/tempo":{"endpoint":"http://{{ .Release.Name }}-tempo:4318"},"prometheusremotewrite/mimir":{"endpoint":"http://{{ .Release.Name }}-mimir-distributed-nginx/api/v1/push","headers":{"X-Scope-OrgID":"classifyre"}}},"processors":{"batch":{"send_batch_size":8192,"timeout":"200ms"},"memory_limiter":{"check_interval":"1s","limit_percentage":75,"spike_limit_percentage":15},"transform/pii":{"error_mode":"ignore","trace_statements":[{"conditions":["name == \"exception\""],"context":"spanevent","statements":["replace_pattern(attributes[\"exception.stacktrace\"], \"/(?:home|Users|root)/[^/\\\\s]+\", \"/home/[REDACTED]\")","replace_pattern(attributes[\"exception.message\"], \"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\\\.[a-zA-Z]{2,}\", \"[EMAIL_REDACTED]\")"]}]}},"receivers":{"otlp":{"protocols":{"grpc":{"endpoint":"0.0.0.0:4317"},"http":{"endpoint":"0.0.0.0:4318"}}}},"service":{"pipelines":{"logs":{"exporters":["loki"],"processors":["memory_limiter","batch"],"receivers":["otlp"]},"metrics":{"exporters":["prometheusremotewrite/mimir"],"processors":["memory_limiter","batch"],"receivers":["otlp"]},"traces":{"exporters":["otlphttp/tempo"],"processors":["memory_limiter","transform/pii","batch"],"receivers":["otlp"]}},"telemetry":{"metrics":{"address":"0.0.0.0:8888"}}}},"enabled":true,"image":{"repository":"otel/opentelemetry-collector-contrib","tag":"0.155.0"},"mode":"deployment","ports":{"metrics":{"containerPort":8888,"enabled":true,"protocol":"TCP","servicePort":8888},"otlp":{"containerPort":4317,"enabled":true,"protocol":"TCP","servicePort":4317},"otlp-http":{"containerPort":4318,"enabled":true,"protocol":"TCP","servicePort":4318}},"replicaCount":1,"resources":{"limits":{"cpu":"1","memory":"512Mi"},"requests":{"cpu":"100m","memory":"128Mi"}}}` | ------------------------------------------------------------------------- |
| tempo | object | `{"enabled":true,"persistence":{"enabled":true,"size":"20Gi"},"tempo":{"metricsGenerator":{"enabled":true,"processor":{"local_blocks":{"filter_server_spans":false,"flush_to_storage":false}},"storage":{"path":"/var/tempo/generator/wal","remote_write":[]},"traces_storage":{"path":"/var/tempo/generator/traces"}},"overrides":{"defaults":{"metrics_generator":{"processors":["local-blocks"]}},"per_tenant_override_config":"/conf/overrides.yaml"},"resources":{"limits":{"cpu":"2","memory":"2Gi"},"requests":{"cpu":"100m","memory":"256Mi"}},"storage":{"trace":{"backend":"local","local":{"path":"/var/tempo/traces"},"wal":{"path":"/var/tempo/wal"}}}}}` | ------------------------------------------------------------------------- |

----------------------------------------------
Autogenerated from chart metadata using [helm-docs v1.14.2](https://github.com/norwoodj/helm-docs/releases/v1.14.2)
