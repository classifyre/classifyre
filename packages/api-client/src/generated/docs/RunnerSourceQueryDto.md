
# RunnerSourceQueryDto


## Properties

Name | Type
------------ | -------------
`search` | string
`type` | Array&lt;string&gt;
`status` | Array&lt;string&gt;
`limit` | number
`cursor` | string

## Example

```typescript
import type { RunnerSourceQueryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "search": null,
  "type": null,
  "status": null,
  "limit": null,
  "cursor": null,
} satisfies RunnerSourceQueryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RunnerSourceQueryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


