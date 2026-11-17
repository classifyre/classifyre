
# GovernanceDashboardDto


## Properties

Name | Type
------------ | -------------
`scope` | string
`days` | number
`totals` | [DashboardTotalsDto](DashboardTotalsDto.md)
`quality` | [DashboardQualityDto](DashboardQualityDto.md)
`failing` | [Array&lt;DashboardFailingAssetDto&gt;](DashboardFailingAssetDto.md)
`incomplete` | [Array&lt;DashboardIncompleteAssetDto&gt;](DashboardIncompleteAssetDto.md)
`incompleteCount` | number
`governFirst` | [Array&lt;GovernFirstDto&gt;](GovernFirstDto.md)
`coverage` | [Array&lt;SourceCoverageDto&gt;](SourceCoverageDto.md)

## Example

```typescript
import type { GovernanceDashboardDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "scope": null,
  "days": null,
  "totals": null,
  "quality": null,
  "failing": null,
  "incomplete": null,
  "incompleteCount": null,
  "governFirst": null,
  "coverage": null,
} satisfies GovernanceDashboardDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as GovernanceDashboardDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


