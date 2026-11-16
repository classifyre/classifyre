
# AccessRequestOptionsDto


## Properties

Name | Type
------------ | -------------
`target` | [AccessRequestTargetDto](AccessRequestTargetDto.md)
`canQuery` | boolean
`readsInClear` | boolean
`groups` | [Array&lt;AccessRequestGroupDto&gt;](AccessRequestGroupDto.md)
`deciders` | [Array&lt;AccessRequestDeciderDto&gt;](AccessRequestDeciderDto.md)
`pending` | [AccessRequestDto](AccessRequestDto.md)
`roles` | Array&lt;string&gt;
`defaultDays` | number
`maxDays` | number

## Example

```typescript
import type { AccessRequestOptionsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "target": null,
  "canQuery": null,
  "readsInClear": null,
  "groups": null,
  "deciders": null,
  "pending": null,
  "roles": null,
  "defaultDays": null,
  "maxDays": null,
} satisfies AccessRequestOptionsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AccessRequestOptionsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


