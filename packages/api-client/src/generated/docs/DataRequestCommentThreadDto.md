
# DataRequestCommentThreadDto


## Properties

Name | Type
------------ | -------------
`id` | string
`title` | string
`createdBy` | string
`resolvedAt` | Date
`resolvedBy` | string
`entryCount` | number
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { DataRequestCommentThreadDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "title": null,
  "createdBy": null,
  "resolvedAt": null,
  "resolvedBy": null,
  "entryCount": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies DataRequestCommentThreadDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DataRequestCommentThreadDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


