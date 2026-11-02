
# RunnerAugmentationEdgeDto


## Properties

Name | Type
------------ | -------------
`fromId` | string
`toId` | string
`fromUrn` | string
`toUrn` | string
`relationType` | string
`relationClass` | string
`method` | string
`confidence` | number
`evidence` | object

## Example

```typescript
import type { RunnerAugmentationEdgeDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "fromId": null,
  "toId": null,
  "fromUrn": null,
  "toUrn": null,
  "relationType": null,
  "relationClass": null,
  "method": null,
  "confidence": null,
  "evidence": null,
} satisfies RunnerAugmentationEdgeDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RunnerAugmentationEdgeDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


