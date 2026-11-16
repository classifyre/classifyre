
# SharedDatasetColumnDto


## Properties

Name | Type
------------ | -------------
`name` | string
`type` | string
`floor` | string
`from` | [Array&lt;SharedDatasetUpstreamDto&gt;](SharedDatasetUpstreamDto.md)
`upstreams` | [Array&lt;SharedDatasetUpstreamDto&gt;](SharedDatasetUpstreamDto.md)
`traced` | boolean
`transform` | string

## Example

```typescript
import type { SharedDatasetColumnDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "name": null,
  "type": null,
  "floor": null,
  "from": null,
  "upstreams": null,
  "traced": null,
  "transform": AGGREGATED,
} satisfies SharedDatasetColumnDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SharedDatasetColumnDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


