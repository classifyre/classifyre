
# SharedDatasetInputDto


## Properties

Name | Type
------------ | -------------
`assetId` | string
`sqlName` | string
`name` | string
`sourceId` | string
`sourceName` | string
`answeredBy` | [Array&lt;SharedDatasetActorDto&gt;](SharedDatasetActorDto.md)
`groupCanQuery` | boolean
`groupRows` | string
`youGovern` | boolean
`blocked` | boolean

## Example

```typescript
import type { SharedDatasetInputDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetId": null,
  "sqlName": shop_lake.shop.orders,
  "name": null,
  "sourceId": null,
  "sourceName": null,
  "answeredBy": null,
  "groupCanQuery": null,
  "groupRows": null,
  "youGovern": null,
  "blocked": null,
} satisfies SharedDatasetInputDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SharedDatasetInputDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


