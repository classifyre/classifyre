
# UpsertGlossaryTermDto


## Properties

Name | Type
------------ | -------------
`id` | string
`term` | string
`kind` | string
`key` | string
`aliases` | Array&lt;string&gt;
`codes` | Array&lt;string&gt;
`hiddenAliases` | Array&lt;string&gt;
`definition` | string
`schemeId` | string
`schemeKey` | string
`steward` | string
`status` | string
`entityType` | string
`notes` | string
`createNew` | boolean
`refType` | string
`refId` | string
`author` | string

## Example

```typescript
import type { UpsertGlossaryTermDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "term": null,
  "kind": null,
  "key": null,
  "aliases": null,
  "codes": null,
  "hiddenAliases": null,
  "definition": null,
  "schemeId": null,
  "schemeKey": null,
  "steward": null,
  "status": null,
  "entityType": null,
  "notes": null,
  "createNew": null,
  "refType": null,
  "refId": null,
  "author": null,
} satisfies UpsertGlossaryTermDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UpsertGlossaryTermDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


