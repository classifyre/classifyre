
# UpdateFindingDto


## Properties

Name | Type
------------ | -------------
`status` | string
`severity` | string
`changeReason` | string

## Example

```typescript
import type { UpdateFindingDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "status": null,
  "severity": null,
  "changeReason": null,
} satisfies UpdateFindingDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UpdateFindingDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


