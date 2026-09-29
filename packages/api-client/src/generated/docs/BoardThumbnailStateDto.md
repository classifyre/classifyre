
# BoardThumbnailStateDto


## Properties

Name | Type
------------ | -------------
`signature` | string
`version` | number
`updatedAt` | Date
`written` | boolean

## Example

```typescript
import type { BoardThumbnailStateDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "signature": null,
  "version": null,
  "updatedAt": null,
  "written": null,
} satisfies BoardThumbnailStateDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BoardThumbnailStateDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


