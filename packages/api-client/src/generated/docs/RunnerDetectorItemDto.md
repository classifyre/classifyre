
# RunnerDetectorItemDto


## Properties

Name | Type
------------ | -------------
`id` | string
`key` | string
`name` | string
`description` | string
`type` | string
`isActive` | boolean
`version` | number

## Example

```typescript
import type { RunnerDetectorItemDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "key": null,
  "name": null,
  "description": null,
  "type": null,
  "isActive": null,
  "version": null,
} satisfies RunnerDetectorItemDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RunnerDetectorItemDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


