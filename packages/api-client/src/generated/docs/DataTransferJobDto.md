
# DataTransferJobDto


## Properties

Name | Type
------------ | -------------
`id` | string
`kind` | string
`status` | string
`scopes` | Array&lt;string&gt;
`conflictMode` | string
`fileName` | string
`fileSize` | number
`checksum` | string
`downloadAvailable` | boolean
`totalRows` | number
`processedRows` | number
`skippedRows` | number
`percent` | number
`currentTable` | string
`counts` | object
`warnings` | Array&lt;string&gt;
`errorMessage` | string
`cancelRequested` | boolean
`startedAt` | string
`finishedAt` | string
`expiresAt` | string
`createdAt` | string

## Example

```typescript
import type { DataTransferJobDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "kind": null,
  "status": null,
  "scopes": null,
  "conflictMode": null,
  "fileName": null,
  "fileSize": null,
  "checksum": null,
  "downloadAvailable": null,
  "totalRows": null,
  "processedRows": null,
  "skippedRows": null,
  "percent": null,
  "currentTable": null,
  "counts": {"sources":4,"findings":5120},
  "warnings": null,
  "errorMessage": null,
  "cancelRequested": null,
  "startedAt": null,
  "finishedAt": null,
  "expiresAt": null,
  "createdAt": null,
} satisfies DataTransferJobDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DataTransferJobDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


