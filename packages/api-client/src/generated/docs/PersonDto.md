
# PersonDto


## Properties

Name | Type
------------ | -------------
`id` | string
`username` | string
`email` | string
`firstName` | string
`lastName` | string
`enabled` | boolean
`fromDirectory` | boolean
`createdHere` | boolean
`groupIds` | Array&lt;string&gt;
`isYou` | boolean

## Example

```typescript
import type { PersonDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "username": ada@example.test,
  "email": null,
  "firstName": null,
  "lastName": null,
  "enabled": null,
  "fromDirectory": null,
  "createdHere": null,
  "groupIds": null,
  "isYou": null,
} satisfies PersonDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as PersonDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


