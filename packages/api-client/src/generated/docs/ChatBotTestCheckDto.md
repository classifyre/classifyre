
# ChatBotTestCheckDto


## Properties

Name | Type
------------ | -------------
`id` | string
`ok` | boolean
`code` | string
`params` | { [key: string]: string; }
`detail` | string

## Example

```typescript
import type { ChatBotTestCheckDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": botToken,
  "ok": null,
  "code": slackAuthenticated,
  "params": null,
  "detail": Authenticated as @classifyre-bot in workspace Acme.,
} satisfies ChatBotTestCheckDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ChatBotTestCheckDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


