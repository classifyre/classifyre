
# GlossaryImportDto


## Properties

Name | Type
------------ | -------------
`format` | string
`content` | string
`dryRun` | boolean
`conflict` | string
`language` | string
`asDraft` | boolean
`schemeKey` | string

## Example

```typescript
import type { GlossaryImportDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "format": null,
  "content": null,
  "dryRun": null,
  "conflict": null,
  "language": null,
  "asDraft": null,
  "schemeKey": null,
} satisfies GlossaryImportDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as GlossaryImportDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


