
# QueryCatalogRelationDto


## Properties

Name | Type
------------ | -------------
`fromAssetId` | string
`fromColumn` | string
`toAssetId` | string
`toColumn` | string
`constraintName` | string
`cardinality` | string

## Example

```typescript
import type { QueryCatalogRelationDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "fromAssetId": null,
  "fromColumn": null,
  "toAssetId": null,
  "toColumn": null,
  "constraintName": null,
  "cardinality": null,
} satisfies QueryCatalogRelationDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QueryCatalogRelationDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


