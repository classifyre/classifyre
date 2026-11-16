
# DescribeSharedDatasetDto


## Properties

Name | Type
------------ | -------------
`sql` | string
`owningGroupId` | string

## Example

```typescript
import type { DescribeSharedDatasetDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "sql": null,
  "owningGroupId": null,
} satisfies DescribeSharedDatasetDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DescribeSharedDatasetDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


