
# UpdateDataRequestSqlDto


## Properties

Name | Type
------------ | -------------
`sql` | string
`regenerate` | boolean
`baseVersion` | number
`clientId` | string

## Example

```typescript
import type { UpdateDataRequestSqlDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "sql": null,
  "regenerate": null,
  "baseVersion": null,
  "clientId": null,
} satisfies UpdateDataRequestSqlDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UpdateDataRequestSqlDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


