
# HarnessMissionDto


## Properties

Name | Type
------------ | -------------
`kind` | string
`goal` | string
`allowedTools` | Array&lt;string&gt;
`maxIterations` | number

## Example

```typescript
import type { HarnessMissionDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "kind": null,
  "goal": null,
  "allowedTools": null,
  "maxIterations": null,
} satisfies HarnessMissionDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as HarnessMissionDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


