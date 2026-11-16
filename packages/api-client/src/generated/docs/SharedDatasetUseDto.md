
# SharedDatasetUseDto


## Properties

Name | Type
------------ | -------------
`datasetId` | string
`sqlName` | string
`name` | string
`owner` | [SharedDatasetActorDto](SharedDatasetActorDto.md)
`owningGroup` | [SharedDatasetGroupDto](SharedDatasetGroupDto.md)
`block` | [SharedDatasetBlockDto](SharedDatasetBlockDto.md)
`reads30d` | number
`canBlock` | boolean

## Example

```typescript
import type { SharedDatasetUseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "datasetId": null,
  "sqlName": null,
  "name": null,
  "owner": null,
  "owningGroup": null,
  "block": null,
  "reads30d": null,
  "canBlock": null,
} satisfies SharedDatasetUseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SharedDatasetUseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


