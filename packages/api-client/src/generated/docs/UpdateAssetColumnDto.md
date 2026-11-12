
# UpdateAssetColumnDto


## Properties

Name | Type
------------ | -------------
`businessName` | string
`description` | string
`termId` | string
`criticalDataElement` | boolean
`classification` | string
`reviewClassification` | boolean

## Example

```typescript
import type { UpdateAssetColumnDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "businessName": null,
  "description": null,
  "termId": null,
  "criticalDataElement": null,
  "classification": null,
  "reviewClassification": null,
} satisfies UpdateAssetColumnDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UpdateAssetColumnDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


