
# DataRequestOptionsDto


## Properties

Name | Type
------------ | -------------
`routeGroups` | [Array&lt;DataRequestGroupRefDto&gt;](DataRequestGroupRefDto.md)
`audienceGroups` | [Array&lt;DataRequestGroupRefDto&gt;](DataRequestGroupRefDto.md)
`canSelfServe` | boolean

## Example

```typescript
import type { DataRequestOptionsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "routeGroups": null,
  "audienceGroups": null,
  "canSelfServe": null,
} satisfies DataRequestOptionsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DataRequestOptionsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


