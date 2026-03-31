
# AssistantControllerRespondRequest


## Properties

Name | Type
------------ | -------------
`messages` | [Array&lt;AssistantControllerRespondRequestMessagesInner&gt;](AssistantControllerRespondRequestMessagesInner.md)
`context` | object
`pendingConfirmation` | object

## Example

```typescript
import type { AssistantControllerRespondRequest } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "messages": null,
  "context": null,
  "pendingConfirmation": null,
} satisfies AssistantControllerRespondRequest

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AssistantControllerRespondRequest
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


