
# ExploreNodeDto


## Properties

Name | Type
------------ | -------------
`id` | string
`type` | string
`label` | string
`assetType` | string
`sourceType` | string
`sourceName` | string
`sourceId` | string
`foreign` | boolean
`depth` | number
`side` | string
`kinds` | [Array&lt;ExploreKind&gt;](ExploreKind.md)
`caseIds` | Array&lt;string&gt;
`inquiryIds` | Array&lt;string&gt;

## Example

```typescript
import type { ExploreNodeDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "type": null,
  "label": null,
  "assetType": null,
  "sourceType": null,
  "sourceName": null,
  "sourceId": null,
  "foreign": null,
  "depth": null,
  "side": null,
  "kinds": null,
  "caseIds": null,
  "inquiryIds": null,
} satisfies ExploreNodeDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ExploreNodeDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


