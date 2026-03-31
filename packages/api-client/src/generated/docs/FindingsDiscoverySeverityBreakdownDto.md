
# FindingsDiscoverySeverityBreakdownDto


## Properties

Name | Type
------------ | -------------
`critical` | number
`high` | number
`medium` | number
`low` | number
`info` | number

## Example

```typescript
import type { FindingsDiscoverySeverityBreakdownDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "critical": null,
  "high": null,
  "medium": null,
  "low": null,
  "info": null,
} satisfies FindingsDiscoverySeverityBreakdownDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as FindingsDiscoverySeverityBreakdownDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


