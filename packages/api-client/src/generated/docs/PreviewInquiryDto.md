
# PreviewInquiryDto


## Properties

Name | Type
------------ | -------------
`matchAllSources` | boolean
`sourceIds` | Array&lt;string&gt;
`detectorTypes` | Array&lt;string&gt;
`customDetectorKeys` | Array&lt;string&gt;
`findingTypes` | Array&lt;string&gt;
`findingTypeRegex` | Array&lt;string&gt;
`findingValueRegex` | Array&lt;string&gt;

## Example

```typescript
import type { PreviewInquiryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "matchAllSources": null,
  "sourceIds": null,
  "detectorTypes": null,
  "customDetectorKeys": null,
  "findingTypes": null,
  "findingTypeRegex": null,
  "findingValueRegex": null,
} satisfies PreviewInquiryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as PreviewInquiryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


