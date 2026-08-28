
# RejectCauseLabelDto


## Properties

Name | Type
------------ | -------------
`label` | string
`share` | number
`weight` | number
`values` | Array&lt;string&gt;

## Example

```typescript
import type { RejectCauseLabelDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "label": null,
  "share": null,
  "weight": null,
  "values": null,
} satisfies RejectCauseLabelDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RejectCauseLabelDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


