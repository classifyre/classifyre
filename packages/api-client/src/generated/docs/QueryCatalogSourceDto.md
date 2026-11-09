
# QueryCatalogSourceDto


## Properties

Name | Type
------------ | -------------
`id` | string
`name` | string
`type` | string
`sqlName` | string
`queryable` | boolean
`tables` | [Array&lt;QueryCatalogTableDto&gt;](QueryCatalogTableDto.md)

## Example

```typescript
import type { QueryCatalogSourceDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "name": null,
  "type": null,
  "sqlName": shop_lake,
  "queryable": null,
  "tables": null,
} satisfies QueryCatalogSourceDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QueryCatalogSourceDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


