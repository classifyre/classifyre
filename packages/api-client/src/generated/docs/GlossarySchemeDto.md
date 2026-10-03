
# GlossarySchemeDto


## Properties

Name | Type
------------ | -------------
`id` | string
`key` | string
`name` | string
`description` | string
`color` | string
`origin` | string
`packKey` | string
`packVersion` | string
`termCount` | number
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { GlossarySchemeDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "key": null,
  "name": null,
  "description": null,
  "color": null,
  "origin": null,
  "packKey": null,
  "packVersion": null,
  "termCount": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies GlossarySchemeDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as GlossarySchemeDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


