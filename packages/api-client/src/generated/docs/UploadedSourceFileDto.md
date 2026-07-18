
# UploadedSourceFileDto


## Properties

Name | Type
------------ | -------------
`id` | string
`sourceId` | string
`fileName` | string
`declaredMimeType` | string
`fileExtension` | string
`fileSizeBytes` | number
`contentHash` | string
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { UploadedSourceFileDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "sourceId": null,
  "fileName": null,
  "declaredMimeType": null,
  "fileExtension": null,
  "fileSizeBytes": null,
  "contentHash": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies UploadedSourceFileDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UploadedSourceFileDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


