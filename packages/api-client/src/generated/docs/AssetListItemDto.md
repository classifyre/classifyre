
# AssetListItemDto


## Properties

Name | Type
------------ | -------------
`id` | string
`hash` | string
`checksum` | string
`name` | string
`externalUrl` | string
`links` | Array&lt;string&gt;
`assetType` | string
`sourceType` | string
`sourceId` | string
`runnerId` | string
`lastScannedAt` | Date
`status` | string
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { AssetListItemDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "hash": null,
  "checksum": null,
  "name": null,
  "externalUrl": null,
  "links": null,
  "assetType": null,
  "sourceType": null,
  "sourceId": null,
  "runnerId": null,
  "lastScannedAt": null,
  "status": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies AssetListItemDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AssetListItemDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


