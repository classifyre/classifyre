
# UpdateCustomDetectorDto


## Properties

Name | Type
------------ | -------------
`name` | string
`key` | string
`description` | string
`isActive` | boolean
`pipelineSchema` | object

## Example

```typescript
import type { UpdateCustomDetectorDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "name": Support Ticket Extractor,
  "key": cust_support_ticket_extractor,
  "description": Extracts order IDs, amounts, and intent from support tickets,
  "isActive": null,
  "pipelineSchema": null,
} satisfies UpdateCustomDetectorDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UpdateCustomDetectorDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


