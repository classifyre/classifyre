
# UpdateChatBotDto


## Properties

Name | Type
------------ | -------------
`name` | string
`botToken` | string
`appToken` | string
`enabled` | boolean
`capabilityGroups` | Array&lt;string&gt;
`agentKinds` | Array&lt;string&gt;
`allowMutations` | boolean

## Example

```typescript
import type { UpdateChatBotDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "name": null,
  "botToken": null,
  "appToken": null,
  "enabled": null,
  "capabilityGroups": null,
  "agentKinds": null,
  "allowMutations": null,
} satisfies UpdateChatBotDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UpdateChatBotDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


