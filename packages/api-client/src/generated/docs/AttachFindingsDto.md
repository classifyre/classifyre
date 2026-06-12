
# AttachFindingsDto


## Properties

Name | Type
------------ | -------------
`findingIds` | Array&lt;string&gt;
`addedBy` | string

## Example

```typescript
import type { AttachFindingsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "findingIds": null,
  "addedBy": null,
} satisfies AttachFindingsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AttachFindingsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


