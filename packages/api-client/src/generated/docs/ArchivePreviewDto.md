
# ArchivePreviewDto


## Properties

Name | Type
------------ | -------------
`uploadId` | string
`fileName` | string
`fileSize` | number
`createdAt` | string
`appVersion` | string
`sourceNamespace` | string
`scopes` | Array&lt;string&gt;
`rowsByScope` | object
`totalRows` | number

## Example

```typescript
import type { ArchivePreviewDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "uploadId": null,
  "fileName": null,
  "fileSize": null,
  "createdAt": null,
  "appVersion": null,
  "sourceNamespace": null,
  "scopes": null,
  "rowsByScope": {"sources":4,"findings":5120},
  "totalRows": null,
} satisfies ArchivePreviewDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ArchivePreviewDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


