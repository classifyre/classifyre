
# ExploreLinkStarterDto


## Properties

Name | Type
------------ | -------------
`id` | string
`relationType` | string
`note` | string
`from` | [ExploreAssetRefDto](ExploreAssetRefDto.md)
`to` | [ExploreAssetRefDto](ExploreAssetRefDto.md)
`createdAt` | Date

## Example

```typescript
import type { ExploreLinkStarterDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "relationType": null,
  "note": null,
  "from": null,
  "to": null,
  "createdAt": null,
} satisfies ExploreLinkStarterDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ExploreLinkStarterDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


