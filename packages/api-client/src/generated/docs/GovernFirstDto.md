
# GovernFirstDto


## Properties

Name | Type
------------ | -------------
`assetId` | string
`name` | string
`sourceId` | string
`sourceName` | string
`reads` | number
`readers` | number

## Example

```typescript
import type { GovernFirstDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetId": null,
  "name": null,
  "sourceId": null,
  "sourceName": null,
  "reads": null,
  "readers": null,
} satisfies GovernFirstDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as GovernFirstDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


