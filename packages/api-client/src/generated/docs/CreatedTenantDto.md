
# CreatedTenantDto


## Properties

Name | Type
------------ | -------------
`tenant` | [PlatformTenantDto](PlatformTenantDto.md)
`temporaryPassword` | string

## Example

```typescript
import type { CreatedTenantDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "tenant": null,
  "temporaryPassword": null,
} satisfies CreatedTenantDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreatedTenantDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


