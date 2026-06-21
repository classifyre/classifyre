
# CreateMcpServerDto


## Properties

Name | Type
------------ | -------------
`name` | string
`slug` | string
`transport` | string
`command` | string
`args` | Array&lt;string&gt;
`url` | string
`headers` | object
`enabled` | boolean
`trusted` | boolean
`agentKinds` | Array&lt;string&gt;
`toolAllowlist` | Array&lt;string&gt;

## Example

```typescript
import type { CreateMcpServerDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "name": null,
  "slug": null,
  "transport": null,
  "command": null,
  "args": null,
  "url": null,
  "headers": null,
  "enabled": null,
  "trusted": null,
  "agentKinds": null,
  "toolAllowlist": null,
} satisfies CreateMcpServerDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreateMcpServerDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


