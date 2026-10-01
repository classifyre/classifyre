
# CustomDetectorFileDto


## Properties

Name | Type
------------ | -------------
`id` | string
`customDetectorId` | string
`fileName` | string
`declaredMimeType` | string
`fileSizeBytes` | number
`contentHash` | string
`createdAt` | Date

## Example

```typescript
import type { CustomDetectorFileDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "customDetectorId": null,
  "fileName": null,
  "declaredMimeType": null,
  "fileSizeBytes": null,
  "contentHash": null,
  "createdAt": null,
} satisfies CustomDetectorFileDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CustomDetectorFileDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


