
# McpToolSummaryDto


## Properties

Name | Type
------------ | -------------
`name` | string
`title` | string
`description` | string
`groupId` | string
`groupTitle` | string
`readOnly` | boolean
`destructive` | boolean
`idempotent` | boolean
`parameters` | [Array&lt;McpToolParameterDto&gt;](McpToolParameterDto.md)
`returnsJson` | boolean

## Example

```typescript
import type { McpToolSummaryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "name": list_source_runs,
  "title": List Source Runs,
  "description": List runs for a single source.,
  "groupId": runs,
  "groupTitle": Runs,
  "readOnly": true,
  "destructive": false,
  "idempotent": true,
  "parameters": null,
  "returnsJson": true,
} satisfies McpToolSummaryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as McpToolSummaryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


