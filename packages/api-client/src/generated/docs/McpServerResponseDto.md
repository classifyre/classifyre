
# McpServerResponseDto


## Properties

Name | Type
------------ | -------------
`id` | string
`name` | string
`slug` | string
`transport` | string
`command` | string
`args` | Array&lt;string&gt;
`url` | string
`hasHeaders` | boolean
`enabled` | boolean
`trusted` | boolean
`agentKinds` | Array&lt;string&gt;
`toolAllowlist` | Array&lt;string&gt;
`discoveredTools` | Array&lt;string&gt;
`lastError` | string
`lastConnectedAt` | Date
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { McpServerResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "name": null,
  "slug": null,
  "transport": null,
  "command": null,
  "args": null,
  "url": null,
  "hasHeaders": null,
  "enabled": null,
  "trusted": null,
  "agentKinds": null,
  "toolAllowlist": null,
  "discoveredTools": null,
  "lastError": null,
  "lastConnectedAt": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies McpServerResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as McpServerResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


