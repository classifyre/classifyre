
# TrainingExampleDto


## Properties

Name | Type
------------ | -------------
`id` | string
`customDetectorId` | string
`label` | string
`text` | string
`value` | string
`accepted` | boolean
`source` | string
`createdAt` | Date

## Example

```typescript
import type { TrainingExampleDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "customDetectorId": null,
  "label": null,
  "text": null,
  "value": null,
  "accepted": null,
  "source": null,
  "createdAt": null,
} satisfies TrainingExampleDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as TrainingExampleDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


