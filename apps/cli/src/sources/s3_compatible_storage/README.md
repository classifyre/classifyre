# S3-Compatible Storage Source

This source uses the `S3_COMPATIBLE_STORAGE` schema and reads credentials from `config.masked`.

## Schema Field Mapping

Use these schema paths when configuring any S3-compatible provider:

- `config.required.bucket`: Bucket name (for example `testclassifyrebucket`)
- `config.masked.aws_access_key_id`: Access key ID (not key name)
- `config.masked.aws_secret_access_key`: Secret access key
- `config.masked.aws_session_token`: Optional temporary session token
- `config.optional.connection.endpoint_url`: Provider S3 endpoint URL
- `config.optional.connection.region_name`: Region used for SigV4 signing
- `config.optional.connection.verify_ssl`: TLS verification toggle (default `true`)
- `config.optional.connection.request_timeout_seconds`: Network timeout for list/download calls
- `config.optional.connection.max_keys_per_page`: Max objects per list page
- `config.optional.connection.max_object_bytes`: Max bytes downloaded per object for preview/extraction
- `config.optional.scope.prefix`: Optional prefix filter
- `config.optional.scope.include_extensions`: Optional include extension filter
- `config.optional.scope.exclude_extensions`: Optional exclude extension filter
- `config.optional.scope.include_empty_objects`: Include zero-byte objects
- `config.optional.scope.include_object_metadata`: Include object metadata
- `config.optional.scope.include_content_preview`: Download content for MIME/text preview
- `config.sampling.strategy`: `RANDOM`, `LATEST`, or `ALL`
- `config.sampling.rows_per_page`: Item limit per sample run (default 100, ignored when strategy is `ALL`)

## Backblaze B2 Example

```json
{
  "type": "S3_COMPATIBLE_STORAGE",
  "required": {
    "bucket": "testclassifyrebucket"
  },
  "masked": {
    "aws_access_key_id": "002b0e7121683000000000001",
    "aws_secret_access_key": "K002ZQTPmV9xMTEGg/F3AGtDFzdZgnY"
  },
  "optional": {
    "connection": {
      "endpoint_url": "https://s3.us-west-002.backblazeb2.com",
      "region_name": "us-west-002",
      "verify_ssl": true,
      "request_timeout_seconds": 30
    },
    "scope": {
      "include_empty_objects": false,
      "include_object_metadata": true,
      "include_content_preview": true
    }
  },
  "sampling": {
    "strategy": "LATEST"
  }
}
```

## Common Misconfigurations

- `InvalidRequest: The Credential is malformed`:
  - `aws_access_key_id` is wrong (often secret key pasted into this field).
- `InvalidAccessKeyId`:
  - Access key ID does not exist for this B2 application key.
- `SUCCESS` but `Listed 0 object(s)`:
  - `optional.scope.prefix` does not match actual key paths, or extension filters exclude files.
