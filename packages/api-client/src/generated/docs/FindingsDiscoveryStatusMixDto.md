
# FindingsDiscoveryStatusMixDto


## Properties

Name | Type
------------ | -------------
`open` | number
`falsePositive` | number
`resolved` | number
`ignored` | number
`total` | number

## Example

```typescript
import type { FindingsDiscoveryStatusMixDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "open": null,
  "falsePositive": null,
  "resolved": null,
  "ignored": null,
  "total": null,
} satisfies FindingsDiscoveryStatusMixDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as FindingsDiscoveryStatusMixDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


