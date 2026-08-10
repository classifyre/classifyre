
# AiProviderConfigTestResultDto


## Properties

Name | Type
------------ | -------------
`status` | string
`category` | string
`provider` | string
`model` | string
`message` | string
`details` | Array&lt;string&gt;
`durationMs` | number
`inputTokens` | number
`outputTokens` | number
`responsePreview` | string

## Example

```typescript
import type { AiProviderConfigTestResultDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "status": PASS,
  "category": CONNECTION,
  "provider": CLAUDE,
  "model": claude-sonnet-4-5,
  "message": null,
  "details": null,
  "durationMs": 842,
  "inputTokens": 42,
  "outputTokens": 18,
  "responsePreview": null,
} satisfies AiProviderConfigTestResultDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AiProviderConfigTestResultDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


