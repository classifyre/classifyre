
# SandboxRunDto


## Properties

Name | Type
------------ | -------------
`id` | string
`createdAt` | Date
`fileName` | string
`fileType` | string
`contentType` | string
`fileExtension` | string
`fileSizeBytes` | number
`detectors` | object
`findings` | object
`status` | string
`errorMessage` | string
`durationMs` | number

## Example

```typescript
import type { SandboxRunDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "createdAt": null,
  "fileName": null,
  "fileType": null,
  "contentType": null,
  "fileExtension": null,
  "fileSizeBytes": null,
  "detectors": null,
  "findings": null,
  "status": null,
  "errorMessage": null,
  "durationMs": null,
} satisfies SandboxRunDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SandboxRunDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


