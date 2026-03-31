
# McpOverviewResponseDto


## Properties

Name | Type
------------ | -------------
`endpointPath` | string
`transport` | string
`authScheme` | string
`tokenPrefix` | string
`authHeaderExample` | string
`bestPractices` | Array&lt;string&gt;
`capabilityGroups` | [Array&lt;McpCapabilityGroupDto&gt;](McpCapabilityGroupDto.md)
`prompts` | [Array&lt;McpPromptSummaryDto&gt;](McpPromptSummaryDto.md)

## Example

```typescript
import type { McpOverviewResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "endpointPath": /mcp,
  "transport": Streamable HTTP (JSON response mode),
  "authScheme": Bearer token,
  "tokenPrefix": inmcp,
  "authHeaderExample": Authorization: Bearer inmcp_6c0ae0a4-2740-4c37-aa29-c9c69522e053.qxMSu7K1aK0pgr1Z4vPqIYFJ3ijS2n2OQq8v3hVC-TM,
  "bestPractices": ["Generate one token per MCP client or workspace.","Store tokens in a secret manager, not in plain text config files.","Rotate by creating a replacement token, then revoke the old one.","Tokens are hashed at rest and shown only once after creation."],
  "capabilityGroups": null,
  "prompts": null,
} satisfies McpOverviewResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as McpOverviewResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


