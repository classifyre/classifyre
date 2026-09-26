
# ApplyBoardOpsResponseDto


## Properties

Name | Type
------------ | -------------
`version` | number
`applied` | [Array&lt;AppliedBoardOpDto&gt;](AppliedBoardOpDto.md)
`rejected` | [Array&lt;RejectedBoardOpDto&gt;](RejectedBoardOpDto.md)
`stale` | boolean

## Example

```typescript
import type { ApplyBoardOpsResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "version": null,
  "applied": null,
  "rejected": null,
  "stale": null,
} satisfies ApplyBoardOpsResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ApplyBoardOpsResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


