
# RoleDto


## Properties

Name | Type
------------ | -------------
`key` | string
`title` | string
`scopes` | Array&lt;string&gt;
`capabilities` | Array&lt;string&gt;

## Example

```typescript
import type { RoleDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "key": investigator,
  "title": Investigator,
  "scopes": null,
  "capabilities": null,
} satisfies RoleDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RoleDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


