/**
 * Next.js instrumentation hook — runs once at server startup.
 *
 * OTel is only initialised for the Node.js runtime; the Edge runtime is
 * intentionally skipped (no OTel span support in Edge middleware).
 *
 * Opt-out: set TELEMETRY_DISABLED=1 or DO_NOT_TRACK=1 in the environment.
 */

export async function register() {
  if (
    process.env.TELEMETRY_DISABLED === '1' ||
    process.env.DO_NOT_TRACK === '1' ||
    process.env.CLASSIFYRE_TELEMETRY === 'false'
  ) {
    return;
  }

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerOTel } = await import('@vercel/otel');
    registerOTel({
      serviceName: 'classifyre-web',
      attributes: {
        'service.version': process.env.SERVICE_VERSION ?? '0.0.0',
        'deployment.environment.name':
          process.env.DEPLOY_ENV ?? process.env.NODE_ENV ?? 'production',
        'service.namespace': 'classifyre',
        'service.instance.id': process.env.CLASSIFYRE_INSTANCE_ID ?? '',
      },
    });
  }
}
