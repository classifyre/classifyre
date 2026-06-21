
# HarnessToolsResponseDto


## Properties

Name | Type
------------ | -------------
`tools` | [Array&lt;HarnessToolDto&gt;](HarnessToolDto.md)
`missions` | [Array&lt;HarnessMissionDto&gt;](HarnessMissionDto.md)

## Example

```typescript
import type { HarnessToolsResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "tools": null,
  "missions": null,
} satisfies HarnessToolsResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as HarnessToolsResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


