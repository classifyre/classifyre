
# DataRequestDescribeResultDto


## Properties

Name | Type
------------ | -------------
`cached` | boolean
`sqlHash` | string
`describe` | { [key: string]: any; }
`error` | { [key: string]: any; }
`check` | [DataRequestCheckResultDto](DataRequestCheckResultDto.md)

## Example

```typescript
import type { DataRequestDescribeResultDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "cached": null,
  "sqlHash": null,
  "describe": null,
  "error": null,
  "check": null,
} satisfies DataRequestDescribeResultDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DataRequestDescribeResultDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


