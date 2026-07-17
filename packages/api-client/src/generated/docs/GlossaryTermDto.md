
# GlossaryTermDto


## Properties

Name | Type
------------ | -------------
`id` | string
`term` | string
`aliases` | Array&lt;string&gt;
`entityType` | string
`notes` | string
`refType` | string
`refId` | string
`origin` | string
`verified` | boolean
`verifiedBy` | string
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { GlossaryTermDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "term": null,
  "aliases": null,
  "entityType": null,
  "notes": null,
  "refType": null,
  "refId": null,
  "origin": null,
  "verified": null,
  "verifiedBy": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies GlossaryTermDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as GlossaryTermDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


