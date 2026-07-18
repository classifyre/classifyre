
# CreateCaseEventDto


## Properties

Name | Type
------------ | -------------
`occurredAt` | Date
`precision` | string
`title` | string
`description` | string
`confidence` | number
`findingIds` | Array&lt;string&gt;
`evidenceIds` | Array&lt;string&gt;
`createdBy` | string

## Example

```typescript
import type { CreateCaseEventDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "occurredAt": null,
  "precision": null,
  "title": null,
  "description": null,
  "confidence": null,
  "findingIds": null,
  "evidenceIds": null,
  "createdBy": null,
} satisfies CreateCaseEventDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreateCaseEventDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


