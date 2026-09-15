
# FindingBulkOperationDto


## Properties

Name | Type
------------ | -------------
`id` | string
`kind` | string
`status` | string
`totalEstimate` | number
`processed` | number
`changed` | number
`exempted` | number
`percent` | number
`counts` | object
`warnings` | Array&lt;string&gt;
`filters` | object
`target` | object
`errorMessage` | string
`cancelRequested` | boolean
`createdBy` | string
`createdAt` | Date
`startedAt` | Date
`finishedAt` | Date

## Example

```typescript
import type { FindingBulkOperationDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "kind": null,
  "status": null,
  "totalEstimate": null,
  "processed": null,
  "changed": null,
  "exempted": null,
  "percent": null,
  "counts": null,
  "warnings": null,
  "filters": null,
  "target": null,
  "errorMessage": null,
  "cancelRequested": null,
  "createdBy": null,
  "createdAt": null,
  "startedAt": null,
  "finishedAt": null,
} satisfies FindingBulkOperationDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as FindingBulkOperationDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


