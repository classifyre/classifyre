/**
 * OpenTelemetry SDK initialisation — must run before any other module is loaded.
 *
 * Loaded via `node --require ./dist/src/tracing.js` so that auto-instrumentation
 * patches (HTTP, Fastify, pg, …) are applied before NestJS imports any modules.
 *
 * Opt-out: set TELEMETRY_DISABLED=1 or DO_NOT_TRACK=1 in the environment.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';

function isTelemetryEnabled(): boolean {
  if (process.env.TELEMETRY_DISABLED === '1') return false;
  if (process.env.DO_NOT_TRACK === '1') return false;
  if (process.env.CLASSIFYRE_TELEMETRY === 'false') return false;
  return true;
}

if (isTelemetryEnabled()) {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': 'classifyre-api',
      'service.version': process.env.SERVICE_VERSION ?? '0.0.0',
      'deployment.environment.name':
        process.env.DEPLOY_ENV ?? process.env.NODE_ENV ?? 'production',
      'service.namespace': 'classifyre',
      'service.instance.id': process.env.CLASSIFYRE_INSTANCE_ID ?? '',
    }),
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 15_000,
    }),
    logRecordProcessor: new BatchLogRecordProcessor(new OTLPLogExporter()),
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs instrumentation is too noisy in production
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  process.on('SIGTERM', () => {
    sdk
      .shutdown()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  });
}
