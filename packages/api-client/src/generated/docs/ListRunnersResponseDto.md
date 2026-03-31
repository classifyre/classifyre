
# ListRunnersResponseDto


## Properties

Name | Type
------------ | -------------
`runners` | [Array&lt;RunnerDto&gt;](RunnerDto.md)
`total` | number
`skip` | number
`take` | number

## Example

```typescript
import type { ListRunnersResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "runners": null,
  "total": null,
  "skip": null,
  "take": null,
} satisfies ListRunnersResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ListRunnersResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


