
# ChatBotActivityEntryDto


## Properties

Name | Type
------------ | -------------
`at` | Date
`level` | string
`code` | string
`params` | { [key: string]: string; }
`message` | string

## Example

```typescript
import type { ChatBotActivityEntryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "at": null,
  "level": INFO,
  "code": slackMention,
  "params": null,
  "message": Mention from U0123ABC in C0456DEF.,
} satisfies ChatBotActivityEntryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ChatBotActivityEntryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


