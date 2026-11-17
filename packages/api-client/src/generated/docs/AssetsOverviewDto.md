
# AssetsOverviewDto


## Properties

Name | Type
------------ | -------------
`raw` | [AssetsOverviewRawDto](AssetsOverviewRawDto.md)
`governance` | [AssetsOverviewGovernanceDto](AssetsOverviewGovernanceDto.md)
`shared` | [AssetsOverviewSharedDto](AssetsOverviewSharedDto.md)

## Example

```typescript
import type { AssetsOverviewDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "raw": null,
  "governance": null,
  "shared": null,
} satisfies AssetsOverviewDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AssetsOverviewDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


