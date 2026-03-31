
# UpdateGlossaryTermDto


## Properties

Name | Type
------------ | -------------
`displayName` | string
`description` | string
`category` | string
`filterMapping` | [GlossaryFilterMappingDto](GlossaryFilterMappingDto.md)
`color` | string
`icon` | string
`isActive` | boolean

## Example

```typescript
import type { UpdateGlossaryTermDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "displayName": null,
  "description": null,
  "category": null,
  "filterMapping": null,
  "color": null,
  "icon": null,
  "isActive": null,
} satisfies UpdateGlossaryTermDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UpdateGlossaryTermDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


