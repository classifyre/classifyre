
# LinkSupportDto


## Properties

Name | Type
------------ | -------------
`targetType` | string
`targetId` | string
`stance` | string
`weight` | number
`note` | string

## Example

```typescript
import type { LinkSupportDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "targetType": null,
  "targetId": null,
  "stance": null,
  "weight": null,
  "note": null,
} satisfies LinkSupportDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as LinkSupportDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


