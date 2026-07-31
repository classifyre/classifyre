
# TransferScopeDto


## Properties

Name | Type
------------ | -------------
`id` | string
`label` | string
`description` | string
`dependsOn` | Array&lt;string&gt;
`heavy` | boolean
`redactsSecrets` | boolean
`rows` | number

## Example

```typescript
import type { TransferScopeDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": findings,
  "label": Findings,
  "description": null,
  "dependsOn": null,
  "heavy": null,
  "redactsSecrets": null,
  "rows": 4312,
} satisfies TransferScopeDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as TransferScopeDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


