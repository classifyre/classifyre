
# ExploreViewDto


## Properties

Name | Type
------------ | -------------
`id` | string
`name` | string
`description` | string
`seedIds` | Array&lt;string&gt;
`seeds` | [Array&lt;ExploreAssetRefDto&gt;](ExploreAssetRefDto.md)
`view` | string
`kinds` | [Array&lt;ExploreKind&gt;](ExploreKind.md)
`depth` | number
`direction` | string
`positions` | [{ [key: string]: ExplorePositionDto; }](ExplorePositionDto.md)
`createdBy` | string
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { ExploreViewDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "name": null,
  "description": null,
  "seedIds": null,
  "seeds": null,
  "view": null,
  "kinds": null,
  "depth": null,
  "direction": null,
  "positions": null,
  "createdBy": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies ExploreViewDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ExploreViewDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


