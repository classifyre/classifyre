
# MeActorDto


## Properties

Name | Type
------------ | -------------
`id` | string
`displayName` | string
`kind` | string
`via` | string

## Example

```typescript
import type { MeActorDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "displayName": Jordan Reyes,
  "kind": null,
  "via": null,
} satisfies MeActorDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as MeActorDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


