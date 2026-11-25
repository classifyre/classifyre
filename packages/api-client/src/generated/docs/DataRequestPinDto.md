
# DataRequestPinDto


## Properties

Name | Type
------------ | -------------
`threadId` | string
`anchor` | [DataRequestPinAnchorDto](DataRequestPinAnchorDto.md)
`x` | number
`y` | number

## Example

```typescript
import type { DataRequestPinDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "threadId": null,
  "anchor": null,
  "x": null,
  "y": null,
} satisfies DataRequestPinDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DataRequestPinDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


