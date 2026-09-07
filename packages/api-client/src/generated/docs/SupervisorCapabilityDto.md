
# SupervisorCapabilityDto


## Properties

Name | Type
------------ | -------------
`id` | string
`labelKey` | string
`description` | string
`enabled` | boolean
`alwaysOn` | boolean
`defaultOn` | boolean
`destructive` | boolean
`toolCount` | number

## Example

```typescript
import type { SupervisorCapabilityDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "labelKey": null,
  "description": null,
  "enabled": null,
  "alwaysOn": null,
  "defaultOn": null,
  "destructive": null,
  "toolCount": null,
} satisfies SupervisorCapabilityDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SupervisorCapabilityDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


