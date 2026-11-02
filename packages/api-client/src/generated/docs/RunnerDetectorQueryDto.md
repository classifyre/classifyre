
# RunnerDetectorQueryDto


## Properties

Name | Type
------------ | -------------
`type` | Array&lt;string&gt;
`includeInactive` | boolean
`limit` | number
`cursor` | string

## Example

```typescript
import type { RunnerDetectorQueryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "type": null,
  "includeInactive": null,
  "limit": null,
  "cursor": null,
} satisfies RunnerDetectorQueryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RunnerDetectorQueryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


