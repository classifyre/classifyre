
# PayloadCursorEntryDto


## Properties

Name | Type
------------ | -------------
`hash` | string
`cursor` | { [key: string]: any; }

## Example

```typescript
import type { PayloadCursorEntryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "hash": null,
  "cursor": null,
} satisfies PayloadCursorEntryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as PayloadCursorEntryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


