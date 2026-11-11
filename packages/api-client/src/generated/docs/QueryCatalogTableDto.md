
# QueryCatalogTableDto


## Properties

Name | Type
------------ | -------------
`assetId` | string
`sourceId` | string
`name` | string
`schema` | string
`table` | string
`sqlName` | string
`columns` | [Array&lt;QueryColumnDto&gt;](QueryColumnDto.md)
`queryable` | boolean
`canQuery` | boolean
`reason` | string

## Example

```typescript
import type { QueryCatalogTableDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetId": null,
  "sourceId": null,
  "name": null,
  "schema": null,
  "table": null,
  "sqlName": shop_lake.shop.orders,
  "columns": null,
  "queryable": null,
  "canQuery": null,
  "reason": null,
} satisfies QueryCatalogTableDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QueryCatalogTableDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


