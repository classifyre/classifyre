
# SearchSourcesTotalsDto


## Properties

Name | Type
------------ | -------------
`total` | number
`healthy` | number
`errors` | number
`running` | number

## Example

```typescript
import type { SearchSourcesTotalsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "total": null,
  "healthy": null,
  "errors": null,
  "running": null,
} satisfies SearchSourcesTotalsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SearchSourcesTotalsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


