
# FinalizeIngestRunDto


## Properties

Name | Type
------------ | -------------
`runnerId` | string
`seenHashes` | Array&lt;string&gt;

## Example

```typescript
import type { FinalizeIngestRunDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "runnerId": runner-123-abc,
  "seenHashes": ["hash-1","hash-2"],
} satisfies FinalizeIngestRunDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as FinalizeIngestRunDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


