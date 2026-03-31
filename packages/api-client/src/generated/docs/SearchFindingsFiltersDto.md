
# SearchFindingsFiltersDto


## Properties

Name | Type
------------ | -------------
`detectorType` | Array&lt;string&gt;
`customDetectorKey` | Array&lt;string&gt;
`runnerId` | Array&lt;string&gt;
`findingType` | Array&lt;string&gt;
`category` | Array&lt;string&gt;
`severity` | Array&lt;string&gt;
`status` | Array&lt;string&gt;
`includeResolved` | boolean
`detectionIdentity` | Array&lt;string&gt;
`firstDetectedAfter` | Date
`lastDetectedBefore` | Date

## Example

```typescript
import type { SearchFindingsFiltersDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "detectorType": null,
  "customDetectorKey": null,
  "runnerId": null,
  "findingType": null,
  "category": null,
  "severity": null,
  "status": null,
  "includeResolved": null,
  "detectionIdentity": null,
  "firstDetectedAfter": null,
  "lastDetectedBefore": null,
} satisfies SearchFindingsFiltersDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SearchFindingsFiltersDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


