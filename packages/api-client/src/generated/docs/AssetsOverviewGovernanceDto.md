
# AssetsOverviewGovernanceDto


## Properties

Name | Type
------------ | -------------
`governed` | number
`ungoverned` | number
`certified` | number
`failing` | number
`requestsForMe` | number

## Example

```typescript
import type { AssetsOverviewGovernanceDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "governed": null,
  "ungoverned": null,
  "certified": null,
  "failing": null,
  "requestsForMe": null,
} satisfies AssetsOverviewGovernanceDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AssetsOverviewGovernanceDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


