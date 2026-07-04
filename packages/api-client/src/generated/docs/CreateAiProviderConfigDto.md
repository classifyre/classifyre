
# CreateAiProviderConfigDto


## Properties

Name | Type
------------ | -------------
`name` | string
`provider` | string
`model` | string
`apiKey` | string
`baseUrl` | string
`contextSize` | number
`supportsVision` | boolean
`inputCostPerMTok` | number
`outputCostPerMTok` | number

## Example

```typescript
import type { CreateAiProviderConfigDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "name": Production Claude,
  "provider": CLAUDE,
  "model": claude-sonnet-4-5,
  "apiKey": sk-proj-...,
  "baseUrl": https://openrouter.ai/api/v1,
  "contextSize": 200000,
  "supportsVision": false,
  "inputCostPerMTok": 3,
  "outputCostPerMTok": 15,
} satisfies CreateAiProviderConfigDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreateAiProviderConfigDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


