
# ScanCacheEntryDto


## Properties

Name | Type
------------ | -------------
`hash` | string
`checksum` | string
`contentHash` | string
`scopeFingerprint` | string
`detectors` | { [key: string]: string; }
`findingsTotal` | number
`findingsBySeverity` | { [key: string]: any; }
`findingsByDetector` | { [key: string]: any; }
`emptyText` | boolean
`textExtractionStatus` | string

## Example

```typescript
import type { ScanCacheEntryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "hash": null,
  "checksum": null,
  "contentHash": null,
  "scopeFingerprint": null,
  "detectors": null,
  "findingsTotal": null,
  "findingsBySeverity": null,
  "findingsByDetector": null,
  "emptyText": null,
  "textExtractionStatus": null,
} satisfies ScanCacheEntryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ScanCacheEntryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


