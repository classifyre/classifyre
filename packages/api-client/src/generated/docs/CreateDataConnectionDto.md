
# CreateDataConnectionDto


## Properties

Name | Type
------------ | -------------
`name` | string
`expiresInDays` | number
`scope` | Array&lt;string&gt;

## Example

```typescript
import type { CreateDataConnectionDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "name": Power BI,
  "expiresInDays": null,
  "scope": null,
} satisfies CreateDataConnectionDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreateDataConnectionDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


