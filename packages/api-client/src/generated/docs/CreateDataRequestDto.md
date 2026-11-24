
# CreateDataRequestDto


## Properties

Name | Type
------------ | -------------
`title` | string
`description` | string
`priority` | string
`routeGroupId` | string
`audienceGroupId` | string
`spec` | { [key: string]: any; }

## Example

```typescript
import type { CreateDataRequestDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "title": null,
  "description": null,
  "priority": null,
  "routeGroupId": null,
  "audienceGroupId": null,
  "spec": null,
} satisfies CreateDataRequestDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreateDataRequestDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


