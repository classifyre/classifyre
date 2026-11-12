
# ColumnFindingGroupDto


## Properties

Name | Type
------------ | -------------
`detectorType` | string
`findingType` | string
`count` | number
`maxSeverity` | string

## Example

```typescript
import type { ColumnFindingGroupDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "detectorType": PII,
  "findingType": EMAIL_ADDRESS,
  "count": null,
  "maxSeverity": null,
} satisfies ColumnFindingGroupDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ColumnFindingGroupDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


