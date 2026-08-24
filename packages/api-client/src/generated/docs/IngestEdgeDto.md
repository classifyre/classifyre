
# IngestEdgeDto


## Properties

Name | Type
------------ | -------------
`fromType` | string
`fromId` | string
`fromHash` | string
`toType` | string
`toId` | string
`toHash` | string
`toUrn` | string
`fromUrn` | string
`relationType` | string
`relationClass` | string
`granularity` | string
`method` | string
`fieldMappings` | Array&lt;{ [key: string]: any; }&gt;
`evidence` | { [key: string]: any; }
`viaId` | string
`viaUrn` | string
`confidence` | number

## Example

```typescript
import type { IngestEdgeDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "fromType": null,
  "fromId": null,
  "fromHash": null,
  "toType": null,
  "toId": null,
  "toHash": null,
  "toUrn": null,
  "fromUrn": null,
  "relationType": null,
  "relationClass": null,
  "granularity": null,
  "method": null,
  "fieldMappings": null,
  "evidence": null,
  "viaId": null,
  "viaUrn": null,
  "confidence": null,
} satisfies IngestEdgeDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as IngestEdgeDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


