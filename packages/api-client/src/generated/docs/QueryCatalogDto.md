
# QueryCatalogDto


## Properties

Name | Type
------------ | -------------
`enabled` | boolean
`canQueryAll` | boolean
`limits` | [QueryLimitsDto](QueryLimitsDto.md)
`sources` | [Array&lt;QueryCatalogSourceDto&gt;](QueryCatalogSourceDto.md)

## Example

```typescript
import type { QueryCatalogDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "enabled": null,
  "canQueryAll": null,
  "limits": null,
  "sources": null,
} satisfies QueryCatalogDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QueryCatalogDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


