
# UpdateCustomDetectorDto


## Properties

Name | Type
------------ | -------------
`name` | string
`key` | string
`description` | string
`method` | string
`isActive` | boolean
`config` | { [key: string]: any; }

## Example

```typescript
import type { UpdateCustomDetectorDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "name": DACH Contract Risk Terms,
  "key": cust_dach_contract_risk,
  "description": Detect legal/compliance risk language in contracts,
  "method": CLASSIFIER,
  "isActive": null,
  "config": null,
} satisfies UpdateCustomDetectorDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UpdateCustomDetectorDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


