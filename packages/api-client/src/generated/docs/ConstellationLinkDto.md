
# ConstellationLinkDto


## Properties

Name | Type
------------ | -------------
`sourceAId` | string
`sourceBId` | string
`total` | number
`byClass` | [ConstellationClassCountsDto](ConstellationClassCountsDto.md)
`assetCount` | number
`duplicatePairCount` | number

## Example

```typescript
import type { ConstellationLinkDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "sourceAId": null,
  "sourceBId": null,
  "total": null,
  "byClass": null,
  "assetCount": null,
  "duplicatePairCount": null,
} satisfies ConstellationLinkDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ConstellationLinkDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


