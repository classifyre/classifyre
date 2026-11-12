
# UpdateAssetGovernanceDto


## Properties

Name | Type
------------ | -------------
`description` | string
`usage` | string
`limitations` | string
`legalBasis` | string
`retention` | string
`status` | string

## Example

```typescript
import type { UpdateAssetGovernanceDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "description": null,
  "usage": null,
  "limitations": null,
  "legalBasis": null,
  "retention": 10 y,
  "status": null,
} satisfies UpdateAssetGovernanceDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UpdateAssetGovernanceDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


