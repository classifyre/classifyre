
# DataConnectionExposureDto


## Properties

Name | Type
------------ | -------------
`open` | boolean
`inheritedFromSource` | boolean
`openedBy` | string
`openedAt` | Date

## Example

```typescript
import type { DataConnectionExposureDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "open": null,
  "inheritedFromSource": null,
  "openedBy": null,
  "openedAt": null,
} satisfies DataConnectionExposureDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DataConnectionExposureDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


