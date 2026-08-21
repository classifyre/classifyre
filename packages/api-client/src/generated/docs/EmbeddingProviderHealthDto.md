
# EmbeddingProviderHealthDto


## Properties

Name | Type
------------ | -------------
`workerDisabled` | boolean
`workerRetryAt` | string
`requestErrorCount` | number
`lastRequestError` | string
`lastRequestErrorAt` | string

## Example

```typescript
import type { EmbeddingProviderHealthDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "workerDisabled": null,
  "workerRetryAt": null,
  "requestErrorCount": null,
  "lastRequestError": null,
  "lastRequestErrorAt": null,
} satisfies EmbeddingProviderHealthDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as EmbeddingProviderHealthDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


