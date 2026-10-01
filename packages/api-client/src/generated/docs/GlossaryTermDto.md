
# GlossaryTermDto


## Properties

Name | Type
------------ | -------------
`id` | string
`key` | string
`previousKeys` | Array&lt;string&gt;
`term` | string
`kind` | string
`status` | string
`aliases` | Array&lt;string&gt;
`codes` | Array&lt;string&gt;
`hiddenAliases` | Array&lt;string&gt;
`proposedAliases` | Array&lt;string&gt;
`definition` | string
`entityType` | string
`notes` | string
`steward` | string
`schemeId` | string
`scheme` | [GlossarySchemeRefDto](GlossarySchemeRefDto.md)
`replacedById` | string
`deprecatedAt` | Date
`sourceIri` | string
`packKey` | string
`origin` | string
`verified` | boolean
`verifiedBy` | string
`approvedAt` | Date
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { GlossaryTermDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "key": null,
  "previousKeys": null,
  "term": null,
  "kind": null,
  "status": null,
  "aliases": null,
  "codes": null,
  "hiddenAliases": null,
  "proposedAliases": null,
  "definition": null,
  "entityType": null,
  "notes": null,
  "steward": null,
  "schemeId": null,
  "scheme": null,
  "replacedById": null,
  "deprecatedAt": null,
  "sourceIri": null,
  "packKey": null,
  "origin": null,
  "verified": null,
  "verifiedBy": null,
  "approvedAt": null,
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


