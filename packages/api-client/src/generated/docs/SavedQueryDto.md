
# SavedQueryDto


## Properties

Name | Type
------------ | -------------
`id` | string
`name` | string
`sql` | string
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { SavedQueryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "name": null,
  "sql": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies SavedQueryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SavedQueryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


