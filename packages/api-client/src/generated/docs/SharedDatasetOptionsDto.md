
# SharedDatasetOptionsDto


## Properties

Name | Type
------------ | -------------
`canShare` | boolean
`viaRole` | boolean
`groups` | [Array&lt;SharedDatasetGroupDto&gt;](SharedDatasetGroupDto.md)
`domains` | Array&lt;string&gt;

## Example

```typescript
import type { SharedDatasetOptionsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "canShare": null,
  "viaRole": null,
  "groups": null,
  "domains": null,
} satisfies SharedDatasetOptionsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SharedDatasetOptionsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


