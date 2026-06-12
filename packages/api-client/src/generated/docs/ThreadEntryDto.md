
# ThreadEntryDto


## Properties

Name | Type
------------ | -------------
`id` | string
`threadId` | string
`entryType` | string
`body` | string
`metadata` | object
`author` | string
`createdAt` | Date

## Example

```typescript
import type { ThreadEntryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "threadId": null,
  "entryType": null,
  "body": null,
  "metadata": null,
  "author": null,
  "createdAt": null,
} satisfies ThreadEntryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ThreadEntryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


