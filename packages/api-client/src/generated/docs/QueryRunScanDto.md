
# QueryRunScanDto


## Properties

Name | Type
------------ | -------------
`table` | string
`requests` | number
`rows` | number
`pushed` | Array&lt;string&gt;
`ms` | number
`scans` | number

## Example

```typescript
import type { QueryRunScanDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "table": null,
  "requests": null,
  "rows": null,
  "pushed": null,
  "ms": null,
  "scans": null,
} satisfies QueryRunScanDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QueryRunScanDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


