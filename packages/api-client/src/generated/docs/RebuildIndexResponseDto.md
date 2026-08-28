
# RebuildIndexResponseDto


## Properties

Name | Type
------------ | -------------
`pairs` | number
`patterns` | number
`lineageCovered` | number
`hairballDemoted` | boolean
`durationMs` | number

## Example

```typescript
import type { RebuildIndexResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "pairs": null,
  "patterns": null,
  "lineageCovered": null,
  "hairballDemoted": null,
  "durationMs": null,
} satisfies RebuildIndexResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RebuildIndexResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


