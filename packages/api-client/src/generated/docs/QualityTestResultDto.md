
# QualityTestResultDto


## Properties

Name | Type
------------ | -------------
`measuredValue` | number
`passed` | boolean
`error` | string
`rowsChecked` | number
`sql` | string
`tookMs` | number
`failure` | string

## Example

```typescript
import type { QualityTestResultDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "measuredValue": null,
  "passed": null,
  "error": null,
  "rowsChecked": null,
  "sql": null,
  "tookMs": null,
  "failure": null,
} satisfies QualityTestResultDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QualityTestResultDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


