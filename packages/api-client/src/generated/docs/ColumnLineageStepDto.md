
# ColumnLineageStepDto


## Properties

Name | Type
------------ | -------------
`assetId` | string
`assetLabel` | string
`urn` | string
`column` | string
`upstreams` | Array&lt;string&gt;
`transform` | string
`type` | string
`depth` | number

## Example

```typescript
import type { ColumnLineageStepDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetId": null,
  "assetLabel": null,
  "urn": null,
  "column": null,
  "upstreams": null,
  "transform": null,
  "type": null,
  "depth": null,
} satisfies ColumnLineageStepDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ColumnLineageStepDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


