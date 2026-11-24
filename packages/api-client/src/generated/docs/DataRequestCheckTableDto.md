
# DataRequestCheckTableDto


## Properties

Name | Type
------------ | -------------
`assetId` | string
`sqlName` | string
`sourceId` | string
`_exists` | boolean
`groupCanQuery` | boolean
`maskedColumns` | Array&lt;string&gt;
`hiddenColumnCount` | number

## Example

```typescript
import type { DataRequestCheckTableDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetId": null,
  "sqlName": null,
  "sourceId": null,
  "_exists": null,
  "groupCanQuery": null,
  "maskedColumns": null,
  "hiddenColumnCount": null,
} satisfies DataRequestCheckTableDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DataRequestCheckTableDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


