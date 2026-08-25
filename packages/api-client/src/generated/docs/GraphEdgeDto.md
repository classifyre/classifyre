
# GraphEdgeDto


## Properties

Name | Type
------------ | -------------
`id` | string
`fromType` | string
`fromId` | string
`toType` | string
`toId` | string
`relationType` | string
`confidence` | number
`origin` | string
`crossHypothesis` | boolean
`relationClass` | string
`granularity` | string
`method` | string
`fieldMappings` | [Array&lt;FieldMappingDto&gt;](FieldMappingDto.md)
`evidence` | { [key: string]: any; }

## Example

```typescript
import type { GraphEdgeDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "fromType": null,
  "fromId": null,
  "toType": null,
  "toId": null,
  "relationType": null,
  "confidence": null,
  "origin": null,
  "crossHypothesis": null,
  "relationClass": null,
  "granularity": null,
  "method": null,
  "fieldMappings": null,
  "evidence": null,
} satisfies GraphEdgeDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as GraphEdgeDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


