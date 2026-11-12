
# AssetColumnDto


## Properties

Name | Type
------------ | -------------
`name` | string
`type` | string
`businessName` | string
`description` | string
`term` | [ColumnTermDto](ColumnTermDto.md)
`criticalDataElement` | boolean
`classification` | string
`derivedClassification` | string
`effectiveClassification` | string
`findings` | [Array&lt;ColumnFindingGroupDto&gt;](ColumnFindingGroupDto.md)
`reviewedAt` | Date
`reviewedBy` | string
`updatedAt` | Date
`updatedBy` | string

## Example

```typescript
import type { AssetColumnDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "name": null,
  "type": null,
  "businessName": null,
  "description": null,
  "term": null,
  "criticalDataElement": null,
  "classification": null,
  "derivedClassification": null,
  "effectiveClassification": null,
  "findings": null,
  "reviewedAt": null,
  "reviewedBy": null,
  "updatedAt": null,
  "updatedBy": null,
} satisfies AssetColumnDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AssetColumnDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


