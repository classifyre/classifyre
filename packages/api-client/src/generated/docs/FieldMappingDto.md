
# FieldMappingDto


## Properties

Name | Type
------------ | -------------
`downstream` | string
`upstreams` | Array&lt;string&gt;
`transform` | string
`type` | string

## Example

```typescript
import type { FieldMappingDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "downstream": null,
  "upstreams": null,
  "transform": null,
  "type": null,
} satisfies FieldMappingDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as FieldMappingDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


