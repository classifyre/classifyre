
# UsageChannelDto


## Properties

Name | Type
------------ | -------------
`channel` | string
`reads` | number
`exports` | number

## Example

```typescript
import type { UsageChannelDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "channel": null,
  "reads": null,
  "exports": null,
} satisfies UsageChannelDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UsageChannelDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


