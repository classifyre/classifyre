
# EmbeddingSettingValueDto


## Properties

Name | Type
------------ | -------------
`value` | object
`deploymentDefault` | object
`overridden` | boolean

## Example

```typescript
import type { EmbeddingSettingValueDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "value": null,
  "deploymentDefault": null,
  "overridden": null,
} satisfies EmbeddingSettingValueDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as EmbeddingSettingValueDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


