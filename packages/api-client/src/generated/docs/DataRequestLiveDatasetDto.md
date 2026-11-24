
# DataRequestLiveDatasetDto


## Properties

Name | Type
------------ | -------------
`assetId` | string
`sqlName` | string
`domain` | string
`name` | string
`currentVersion` | number
`deliveredVersion` | number
`status` | string
`reason` | string

## Example

```typescript
import type { DataRequestLiveDatasetDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetId": null,
  "sqlName": null,
  "domain": null,
  "name": null,
  "currentVersion": null,
  "deliveredVersion": null,
  "status": null,
  "reason": null,
} satisfies DataRequestLiveDatasetDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DataRequestLiveDatasetDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


