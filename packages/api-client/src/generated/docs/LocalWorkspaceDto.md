
# LocalWorkspaceDto


## Properties

Name | Type
------------ | -------------
`id` | string
`slug` | string
`name` | string

## Example

```typescript
import type { LocalWorkspaceDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "slug": null,
  "name": null,
} satisfies LocalWorkspaceDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as LocalWorkspaceDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


