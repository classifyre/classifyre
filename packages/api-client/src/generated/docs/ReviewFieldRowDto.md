
# ReviewFieldRowDto


## Properties

Name | Type
------------ | -------------
`label` | string
`aValues` | Array&lt;string&gt;
`bValues` | Array&lt;string&gt;
`sharedValues` | [Array&lt;ReviewSharedValueDto&gt;](ReviewSharedValueDto.md)
`differs` | boolean

## Example

```typescript
import type { ReviewFieldRowDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "label": null,
  "aValues": null,
  "bValues": null,
  "sharedValues": null,
  "differs": null,
} satisfies ReviewFieldRowDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ReviewFieldRowDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


