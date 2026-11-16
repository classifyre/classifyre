
# QueryRunMaskDto


## Properties

Name | Type
------------ | -------------
`table` | string
`action` | string
`column` | string
`mask` | string

## Example

```typescript
import type { QueryRunMaskDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "table": shop_lake.shop.customers,
  "action": null,
  "column": null,
  "mask": null,
} satisfies QueryRunMaskDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QueryRunMaskDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


