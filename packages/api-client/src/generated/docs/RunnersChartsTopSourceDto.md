
# RunnersChartsTopSourceDto


## Properties

Name | Type
------------ | -------------
`sourceId` | string
`sourceName` | string
`runs` | number
`findings` | number
`assets` | number

## Example

```typescript
import type { RunnersChartsTopSourceDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "sourceId": null,
  "sourceName": null,
  "runs": null,
  "findings": null,
  "assets": null,
} satisfies RunnersChartsTopSourceDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RunnersChartsTopSourceDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


