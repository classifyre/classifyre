
# UpdateAgentMemoryDto


## Properties

Name | Type
------------ | -------------
`content` | string
`tags` | Array&lt;string&gt;
`weight` | number

## Example

```typescript
import type { UpdateAgentMemoryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "content": null,
  "tags": null,
  "weight": null,
} satisfies UpdateAgentMemoryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UpdateAgentMemoryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


