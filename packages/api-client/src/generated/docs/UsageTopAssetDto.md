
# UsageTopAssetDto


## Properties

Name | Type
------------ | -------------
`assetId` | string
`name` | string
`sourceId` | string
`sourceName` | string
`reads` | number
`exports` | number
`readers` | number
`previous` | number

## Example

```typescript
import type { UsageTopAssetDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetId": null,
  "name": null,
  "sourceId": null,
  "sourceName": null,
  "reads": null,
  "exports": null,
  "readers": null,
  "previous": null,
} satisfies UsageTopAssetDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UsageTopAssetDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


