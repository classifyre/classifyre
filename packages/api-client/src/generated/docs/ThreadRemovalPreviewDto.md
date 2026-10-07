
# ThreadRemovalPreviewDto


## Properties

Name | Type
------------ | -------------
`linkedFindings` | number
`linkedAssets` | number
`removableFindings` | number
`removableAssets` | number
`keptShared` | number
`keptNoted` | number
`rules` | number

## Example

```typescript
import type { ThreadRemovalPreviewDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "linkedFindings": null,
  "linkedAssets": null,
  "removableFindings": null,
  "removableAssets": null,
  "keptShared": null,
  "keptNoted": null,
  "rules": null,
} satisfies ThreadRemovalPreviewDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ThreadRemovalPreviewDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


