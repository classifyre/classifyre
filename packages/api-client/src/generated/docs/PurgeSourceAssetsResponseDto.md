
# PurgeSourceAssetsResponseDto


## Properties

Name | Type
------------ | -------------
`purgedAssets` | number
`matchedAssets` | number
`dryRun` | boolean
`predicate` | { [key: string]: any; }

## Example

```typescript
import type { PurgeSourceAssetsResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "purgedAssets": null,
  "matchedAssets": null,
  "dryRun": null,
  "predicate": null,
} satisfies PurgeSourceAssetsResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as PurgeSourceAssetsResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


