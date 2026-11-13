
# DataConnectionReachableSourceDto


## Properties

Name | Type
------------ | -------------
`id` | string
`name` | string
`sqlName` | string
`open` | boolean
`tables` | [Array&lt;DataConnectionReachableTableDto&gt;](DataConnectionReachableTableDto.md)

## Example

```typescript
import type { DataConnectionReachableSourceDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "name": null,
  "sqlName": null,
  "open": null,
  "tables": null,
} satisfies DataConnectionReachableSourceDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DataConnectionReachableSourceDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


