
# AssetResponseDto


## Properties

Name | Type
------------ | -------------
`id` | string
`name` | string
`hash` | string
`externalUrl` | string
`links` | Array&lt;string&gt;
`assetType` | string
`sourceType` | string

## Example

```typescript
import type { AssetResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "name": null,
  "hash": null,
  "externalUrl": null,
  "links": null,
  "assetType": null,
  "sourceType": null,
} satisfies AssetResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AssetResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


