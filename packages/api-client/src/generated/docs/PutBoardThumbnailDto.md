
# PutBoardThumbnailDto


## Properties

Name | Type
------------ | -------------
`sketch` | { [key: string]: any; }
`signature` | string
`version` | number

## Example

```typescript
import type { PutBoardThumbnailDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "sketch": null,
  "signature": null,
  "version": null,
} satisfies PutBoardThumbnailDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as PutBoardThumbnailDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


