
# RowConditionDto


## Properties

Name | Type
------------ | -------------
`column` | string
`op` | string
`values` | [Array&lt;RowConditionDtoValuesInner&gt;](RowConditionDtoValuesInner.md)

## Example

```typescript
import type { RowConditionDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "column": region,
  "op": null,
  "values": ["Tirol","Salzburg"],
} satisfies RowConditionDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RowConditionDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


