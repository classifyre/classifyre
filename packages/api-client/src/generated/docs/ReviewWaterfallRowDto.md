
# ReviewWaterfallRowDto


## Properties

Name | Type
------------ | -------------
`label` | string
`potential` | number
`actual` | number
`penalty` | number
`sharedCount` | number
`aCount` | number
`bCount` | number
`weight` | number

## Example

```typescript
import type { ReviewWaterfallRowDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "label": null,
  "potential": null,
  "actual": null,
  "penalty": null,
  "sharedCount": null,
  "aCount": null,
  "bCount": null,
  "weight": null,
} satisfies ReviewWaterfallRowDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ReviewWaterfallRowDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


