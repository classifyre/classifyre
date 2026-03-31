
# FindingsDiscoveryResponseDto


## Properties

Name | Type
------------ | -------------
`windowDays` | number
`includeResolved` | boolean
`totals` | [FindingsDiscoveryTotalsDto](FindingsDiscoveryTotalsDto.md)
`activity` | [FindingsDiscoveryActivityDto](FindingsDiscoveryActivityDto.md)
`topAssets` | [Array&lt;FindingsDiscoveryTopAssetDto&gt;](FindingsDiscoveryTopAssetDto.md)
`recentRuns` | [Array&lt;DiscoveryRecentRunDto&gt;](DiscoveryRecentRunDto.md)

## Example

```typescript
import type { FindingsDiscoveryResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "windowDays": null,
  "includeResolved": null,
  "totals": null,
  "activity": null,
  "topAssets": null,
  "recentRuns": null,
} satisfies FindingsDiscoveryResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as FindingsDiscoveryResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


