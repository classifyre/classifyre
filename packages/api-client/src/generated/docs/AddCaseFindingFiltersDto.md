
# AddCaseFindingFiltersDto


## Properties

Name | Type
------------ | -------------
`action` | string
`inquiryId` | string
`rules` | [Array&lt;CaseFindingFilterRuleDto&gt;](CaseFindingFilterRuleDto.md)
`removeEmptiedAssets` | boolean
`clientId` | string

## Example

```typescript
import type { AddCaseFindingFiltersDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "action": null,
  "inquiryId": null,
  "rules": null,
  "removeEmptiedAssets": null,
  "clientId": null,
} satisfies AddCaseFindingFiltersDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AddCaseFindingFiltersDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


