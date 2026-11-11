
# MeResponseDto


## Properties

Name | Type
------------ | -------------
`actor` | [MeActorDto](MeActorDto.md)
`capabilities` | Array&lt;string&gt;

## Example

```typescript
import type { MeResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "actor": null,
  "capabilities": null,
} satisfies MeResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as MeResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


