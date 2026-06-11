
# AgentLogDto


## Properties

Name | Type
------------ | -------------
`id` | string
`channel` | string
`level` | string
`message` | string
`payload` | object
`createdAt` | Date

## Example

```typescript
import type { AgentLogDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "channel": null,
  "level": null,
  "message": null,
  "payload": null,
  "createdAt": null,
} satisfies AgentLogDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AgentLogDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


