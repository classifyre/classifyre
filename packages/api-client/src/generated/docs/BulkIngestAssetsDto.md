
# BulkIngestAssetsDto


## Properties

Name | Type
------------ | -------------
`runnerId` | string
`assets` | Array&lt;object&gt;
`finalizeRun` | boolean

## Example

```typescript
import type { BulkIngestAssetsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "runnerId": runner-123-abc,
  "assets": [{"hash":"V09SRFBSRVNTXyNfaHR0cHM6Ly9ibG9nLmV4YW1wbGUuY29tXyNfcG9zdHNfMTIz","name":"My Document","external_url":"https://blog.example.com/posts/my-document","checksum":"a1b2c3d4","links":[],"asset_type":"URL","created_at":"2023-01-01T12:00:00Z","updated_at":"2023-01-01T12:00:00Z","findings":[{"finding_type":"email","category":"pii","severity":"medium","confidence":0.95,"matched_content":"john@example.com"}]}],
  "finalizeRun": null,
} satisfies BulkIngestAssetsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BulkIngestAssetsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


