
# QueryRunRowFilterDto


## Properties

Name | Type
------------ | -------------
`anyOf` | Array&lt;Array&lt;RowConditionDto&gt;&gt;
`table` | string

## Example

```typescript
import type { QueryRunRowFilterDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "anyOf": null,
  "table": shop_lake.shop.customers,
} satisfies QueryRunRowFilterDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QueryRunRowFilterDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


