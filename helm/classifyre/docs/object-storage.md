# Object Storage (S3-compatible)

Classifyre uses S3-compatible object storage to persist **runner logs** and **sandbox file uploads**. When object storage is not configured the application still works — logs are visible live during a run but are discarded once it completes, and the UI shows a warning banner on the Logs tab.

## What is stored

| Purpose | Bucket | Key pattern |
|---------|--------|-------------|
| Runner (scan) logs | `objectStorage.bucket` | `{logPrefix}{sourceId}/{runnerId}.ndjson` |
| Sandbox uploaded files | `objectStorage.sandboxBucket` | varies |

## Disabled mode (default)

By default `objectStorage.enabled` is `false`. No S3 credentials are required and no S3-related environment variables are injected into the API container. The API stores logs in memory for the duration of the run, then discards them. The web UI displays an amber warning banner on the scan Logs tab:

> **Log Persistence Unavailable** — This instance has no object storage (S3) configured. Scan logs are visible in real time during a run, but are not retained once the run completes.

## Enabling object storage

Set `objectStorage.enabled: true` in your values file and supply credentials for any S3-compatible provider.

### Quick-reference: provider settings

| Provider | `endpoint` | `forcePathStyle` | `region` |
|----------|-----------|------------------|----------|
| AWS S3 | *(empty)* | `false` | e.g. `us-east-1` |
| Google Cloud Storage | *(empty)* | `false` | e.g. `us-central1` |
| Backblaze B2 | `https://s3.<region>.backblazeb2.com` | `false` | e.g. `us-west-004` |
| MinIO | `http://minio.<ns>.svc.cluster.local:9000` | `true` | any |
| Garage | `http://<svc>:3900` | `true` | any |

### AWS S3

```yaml
objectStorage:
  enabled: true
  bucket: my-classifyre-logs
  sandboxBucket: my-classifyre-sandbox
  region: us-east-1
  forcePathStyle: false
  existingSecret: classifyre-s3-credentials   # keys: access-key-id, secret-access-key
```

Minimum IAM policy for the credentials:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::my-classifyre-logs",
        "arn:aws:s3:::my-classifyre-logs/*",
        "arn:aws:s3:::my-classifyre-sandbox",
        "arn:aws:s3:::my-classifyre-sandbox/*"
      ]
    }
  ]
}
```

### Backblaze B2

```yaml
objectStorage:
  enabled: true
  bucket: my-classifyre-logs
  sandboxBucket: my-classifyre-sandbox
  endpoint: "https://s3.us-west-004.backblazeb2.com"
  region: us-west-004
  forcePathStyle: false
  existingSecret: classifyre-s3-credentials
```

### MinIO (self-hosted in-cluster)

```yaml
objectStorage:
  enabled: true
  bucket: classifyre-logs
  sandboxBucket: classifyre-sandbox
  endpoint: "http://minio.minio-ns.svc.cluster.local:9000"
  forcePathStyle: true
  accessKeyId: minioadmin
  secretAccessKey: minioadmin
```

### Garage (self-hosted)

```yaml
objectStorage:
  enabled: true
  bucket: classifyre-logs
  sandboxBucket: classifyre-sandbox
  endpoint: "http://garage.storage-ns.svc.cluster.local:3900"
  forcePathStyle: true
  existingSecret: classifyre-s3-credentials
```

## Using an existing Kubernetes Secret

For production, store credentials in a Secret created outside Helm:

```bash
kubectl create secret generic classifyre-s3-credentials \
  --from-literal=access-key-id=AKIA... \
  --from-literal=secret-access-key=...
```

Then reference it in values:

```yaml
objectStorage:
  enabled: true
  existingSecret: classifyre-s3-credentials
  # existingSecretAccessKeyIdKey: access-key-id      (default)
  # existingSecretSecretAccessKeyKey: secret-access-key (default)
```

If your Secret uses different key names, override them:

```yaml
objectStorage:
  existingSecret: my-s3-secret
  existingSecretAccessKeyIdKey: aws_access_key_id
  existingSecretSecretAccessKeyKey: aws_secret_access_key
```

## All-in-one Docker image

The all-in-one Docker image has no embedded object storage. To enable S3 persistence, pass the relevant environment variables at runtime:

```bash
docker run \
  -e S3_ENDPOINT=https://s3.us-east-1.amazonaws.com \
  -e S3_BUCKET=my-classifyre-logs \
  -e S3_SANDBOX_BUCKET=my-classifyre-sandbox \
  -e S3_REGION=us-east-1 \
  -e S3_FORCE_PATH_STYLE=false \
  -e S3_ACCESS_KEY_ID=AKIA... \
  -e S3_SECRET_ACCESS_KEY=... \
  classifyre/all-in-one:latest
```

When these variables are not set, the image runs without object storage and logs stream in-memory only.
