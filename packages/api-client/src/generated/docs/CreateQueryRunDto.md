
# CreateQueryRunDto


## Properties

Name | Type
------------ | -------------
`sql` | string
`format` | string

## Example

```typescript
import type { CreateQueryRunDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "sql": SELECT * FROM shop_lake.shop.orders LIMIT 100,
  "format": null,
} satisfies CreateQueryRunDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreateQueryRunDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


