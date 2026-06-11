
# CreateAgentMemoryDto


## Properties

Name | Type
------------ | -------------
`kind` | string
`key` | string
`content` | string
`tags` | Array&lt;string&gt;

## Example

```typescript
import type { CreateAgentMemoryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "kind": null,
  "key": null,
  "content": null,
  "tags": null,
} satisfies CreateAgentMemoryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreateAgentMemoryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


