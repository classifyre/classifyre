
# FindingsDiscoveryTotalsDto


## Properties

Name | Type
------------ | -------------
`total` | number
`bySeverity` | [FindingsDiscoverySeverityBreakdownDto](FindingsDiscoverySeverityBreakdownDto.md)
`byStatus` | [FindingsDiscoveryStatusBreakdownDto](FindingsDiscoveryStatusBreakdownDto.md)

## Example

```typescript
import type { FindingsDiscoveryTotalsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "total": null,
  "bySeverity": null,
  "byStatus": null,
} satisfies FindingsDiscoveryTotalsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as FindingsDiscoveryTotalsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


