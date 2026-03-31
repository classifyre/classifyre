
# CreateGlossaryTermDto


## Properties

Name | Type
------------ | -------------
`displayName` | string
`description` | string
`category` | string
`filterMapping` | [GlossaryFilterMappingDto](GlossaryFilterMappingDto.md)
`color` | string
`icon` | string

## Example

```typescript
import type { CreateGlossaryTermDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "displayName": Security Threats,
  "description": All findings related to security vulnerabilities including exposed secrets and malware signatures,
  "category": Security,
  "filterMapping": null,
  "color": #ff2b2b,
  "icon": shield-alert,
} satisfies CreateGlossaryTermDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreateGlossaryTermDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


