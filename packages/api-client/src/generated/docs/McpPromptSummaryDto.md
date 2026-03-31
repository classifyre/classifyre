
# McpPromptSummaryDto


## Properties

Name | Type
------------ | -------------
`name` | string
`title` | string
`description` | string

## Example

```typescript
import type { McpPromptSummaryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "name": brainstorm_custom_detector,
  "title": Brainstorm Custom Detector,
  "description": Guide an MCP client to propose regex, classifier, or entity detector configs before training.,
} satisfies McpPromptSummaryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as McpPromptSummaryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


