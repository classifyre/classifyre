
# ChatBotResponseDto


## Properties

Name | Type
------------ | -------------
`id` | string
`platform` | string
`name` | string
`enabled` | boolean
`botTokenPreview` | string
`appTokenPreview` | string
`capabilityGroups` | Array&lt;string&gt;
`agentKinds` | Array&lt;string&gt;
`allowMutations` | boolean
`lastError` | string
`lastConnectedAt` | Date
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { ChatBotResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "platform": TELEGRAM,
  "name": Ops Telegram bot,
  "enabled": null,
  "botTokenPreview": 8123…kXw,
  "appTokenPreview": xapp…9Qz,
  "capabilityGroups": null,
  "agentKinds": null,
  "allowMutations": null,
  "lastError": null,
  "lastConnectedAt": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies ChatBotResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ChatBotResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


