
# GovernanceSummaryDto


## Properties

Name | Type
------------ | -------------
`days` | number
`totals` | [GovernanceTotalsDto](GovernanceTotalsDto.md)
`sources` | [Array&lt;SourceCoverageDto&gt;](SourceCoverageDto.md)
`governFirst` | [Array&lt;GovernFirstDto&gt;](GovernFirstDto.md)
`mine` | [GovernanceMineDto](GovernanceMineDto.md)

## Example

```typescript
import type { GovernanceSummaryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "days": null,
  "totals": null,
  "sources": null,
  "governFirst": null,
  "mine": null,
} satisfies GovernanceSummaryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as GovernanceSummaryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


