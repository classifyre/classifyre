
# McpServerTestResultDto


## Properties

Name | Type
------------ | -------------
`ok` | boolean
`tools` | Array&lt;string&gt;
`error` | string

## Example

```typescript
import type { McpServerTestResultDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "ok": null,
  "tools": null,
  "error": null,
} satisfies McpServerTestResultDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as McpServerTestResultDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


