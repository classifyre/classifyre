
# NotificationAudienceDto


## Properties

Name | Type
------------ | -------------
`type` | string
`groupIds` | Array&lt;string&gt;
`updatedBy` | string
`updatedAt` | Date

## Example

```typescript
import type { NotificationAudienceDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "type": null,
  "groupIds": null,
  "updatedBy": null,
  "updatedAt": null,
} satisfies NotificationAudienceDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as NotificationAudienceDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


