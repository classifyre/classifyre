
# DataRequestPermissionsDto


## Properties

Name | Type
------------ | -------------
`isRequester` | boolean
`isTeam` | boolean
`isManager` | boolean
`canEditSpec` | boolean
`canEditSql` | boolean
`canPreview` | boolean
`canSelfServe` | boolean
`allowedActions` | Array&lt;string&gt;

## Example

```typescript
import type { DataRequestPermissionsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "isRequester": null,
  "isTeam": null,
  "isManager": null,
  "canEditSpec": null,
  "canEditSql": null,
  "canPreview": null,
  "canSelfServe": null,
  "allowedActions": null,
} satisfies DataRequestPermissionsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DataRequestPermissionsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


