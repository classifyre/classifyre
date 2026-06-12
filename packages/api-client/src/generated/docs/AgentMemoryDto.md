
# AgentMemoryDto


## Properties

Name | Type
------------ | -------------
`id` | string
`kind` | string
`key` | string
`content` | string
`tags` | Array&lt;string&gt;
`refType` | string
`refId` | string
`weight` | number
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { AgentMemoryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "kind": null,
  "key": null,
  "content": null,
  "tags": null,
  "refType": null,
  "refId": null,
  "weight": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies AgentMemoryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AgentMemoryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


