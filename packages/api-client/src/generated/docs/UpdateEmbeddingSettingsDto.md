
# UpdateEmbeddingSettingsDto


## Properties

Name | Type
------------ | -------------
`enabled` | boolean
`provider` | string
`model` | string
`revision` | string
`dimensions` | number
`pooling` | string
`normalize` | boolean
`aiProviderConfigId` | string
`batchSize` | number
`workerConcurrency` | number
`maxParallelCalls` | number
`intraOpThreads` | number
`dtype` | string
`device` | string
`autoBackfill` | boolean
`hnswM` | number
`hnswEfConstruction` | number
`hnswEfSearch` | number

## Example

```typescript
import type { UpdateEmbeddingSettingsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "enabled": null,
  "provider": null,
  "model": null,
  "revision": null,
  "dimensions": null,
  "pooling": null,
  "normalize": null,
  "aiProviderConfigId": null,
  "batchSize": null,
  "workerConcurrency": null,
  "maxParallelCalls": null,
  "intraOpThreads": null,
  "dtype": null,
  "device": null,
  "autoBackfill": null,
  "hnswM": null,
  "hnswEfConstruction": null,
  "hnswEfSearch": null,
} satisfies UpdateEmbeddingSettingsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UpdateEmbeddingSettingsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


