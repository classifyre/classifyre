
# UpdateCaseDto


## Properties

Name | Type
------------ | -------------
`title` | string
`description` | string
`status` | string
`severity` | string
`assignee` | string
`conclusion` | string

## Example

```typescript
import type { UpdateCaseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "title": null,
  "description": null,
  "status": null,
  "severity": null,
  "assignee": null,
  "conclusion": null,
} satisfies UpdateCaseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UpdateCaseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


