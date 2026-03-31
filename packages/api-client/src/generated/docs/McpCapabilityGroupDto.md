
# McpCapabilityGroupDto


## Properties

Name | Type
------------ | -------------
`id` | string
`title` | string
`description` | string
`toolNames` | Array&lt;string&gt;
`operations` | Array&lt;string&gt;

## Example

```typescript
import type { McpCapabilityGroupDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": sources,
  "title": Sources,
  "description": Create, validate, update, delete, and run ingestion sources from MCP.,
  "toolNames": ["search_sources","get_source","create_source","update_source","delete_source"],
  "operations": ["Search and filter sources","Validate source configs against JSON Schema","Trigger connection tests and runs"],
} satisfies McpCapabilityGroupDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as McpCapabilityGroupDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


