
# McpToolParameterDto


## Properties

Name | Type
------------ | -------------
`name` | string
`type` | string
`required` | boolean
`description` | string
`format` | string
`enumValues` | Array&lt;string&gt;

## Example

```typescript
import type { McpToolParameterDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "name": sourceId,
  "type": string,
  "required": true,
  "description": Source type id from list_source_types, e.g. POSTGRESQL,
  "format": uuid,
  "enumValues": ["PENDING","RUNNING","COMPLETED","ERROR"],
} satisfies McpToolParameterDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as McpToolParameterDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


