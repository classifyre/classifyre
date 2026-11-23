
# AssetRowsDto


## Properties

Name | Type
------------ | -------------
`assetId` | string
`enabled` | boolean
`rules` | [Array&lt;AssetRowRuleDto&gt;](AssetRowRuleDto.md)
`canGovern` | boolean
`readsEveryRow` | boolean
`readersWithoutRows` | [Array&lt;ReaderWithoutRowsDto&gt;](ReaderWithoutRowsDto.md)
`updatedAt` | Date
`updatedBy` | string

## Example

```typescript
import type { AssetRowsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetId": null,
  "enabled": null,
  "rules": null,
  "canGovern": null,
  "readsEveryRow": null,
  "readersWithoutRows": null,
  "updatedAt": null,
  "updatedBy": null,
} satisfies AssetRowsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AssetRowsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


