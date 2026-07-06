
# ChatBotTestResultDto


## Properties

Name | Type
------------ | -------------
`ok` | boolean
`checks` | [Array&lt;ChatBotTestCheckDto&gt;](ChatBotTestCheckDto.md)

## Example

```typescript
import type { ChatBotTestResultDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "ok": null,
  "checks": null,
} satisfies ChatBotTestResultDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ChatBotTestResultDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


