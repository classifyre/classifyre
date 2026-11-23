
# ReaderWithoutRowsDto


## Properties

Name | Type
------------ | -------------
`groupId` | string
`path` | string
`roleKey` | string

## Example

```typescript
import type { ReaderWithoutRowsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "groupId": null,
  "path": /admins,
  "roleKey": tenant-admin,
} satisfies ReaderWithoutRowsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ReaderWithoutRowsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


