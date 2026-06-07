
# HypothesisResponseDto


## Properties

Name | Type
------------ | -------------
`id` | string
`caseId` | string
`statement` | string
`status` | string
`confidence` | number
`createdBy` | string
`supportingCount` | number
`contradictingCount` | number
`createdAt` | Date
`updatedAt` | Date
`links` | [Array&lt;HypothesisSupportLinkDto&gt;](HypothesisSupportLinkDto.md)

## Example

```typescript
import type { HypothesisResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "caseId": null,
  "statement": null,
  "status": null,
  "confidence": null,
  "createdBy": null,
  "supportingCount": null,
  "contradictingCount": null,
  "createdAt": null,
  "updatedAt": null,
  "links": null,
} satisfies HypothesisResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as HypothesisResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


