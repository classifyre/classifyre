
# DataRequestCheckResultDto


## Properties

Name | Type
------------ | -------------
`ok` | boolean
`sql` | string
`routeGroup` | [DataRequestGroupRefDto](DataRequestGroupRefDto.md)
`precheckError` | { [key: string]: any; }
`diagnostics` | Array&lt;object&gt;
`tables` | [Array&lt;DataRequestCheckTableDto&gt;](DataRequestCheckTableDto.md)
`problems` | Array&lt;string&gt;

## Example

```typescript
import type { DataRequestCheckResultDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "ok": null,
  "sql": null,
  "routeGroup": null,
  "precheckError": null,
  "diagnostics": null,
  "tables": null,
  "problems": null,
} satisfies DataRequestCheckResultDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DataRequestCheckResultDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


