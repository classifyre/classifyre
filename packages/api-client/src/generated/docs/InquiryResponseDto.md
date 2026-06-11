
# InquiryResponseDto


## Properties

Name | Type
------------ | -------------
`id` | string
`cases` | [Array&lt;InquiryLinkedCaseDto&gt;](InquiryLinkedCaseDto.md)
`title` | string
`description` | string
`status` | string
`aiMode` | string
`createdBy` | string
`matchAllSources` | boolean
`sourceIds` | Array&lt;string&gt;
`detectorTypes` | Array&lt;string&gt;
`customDetectorKeys` | Array&lt;string&gt;
`findingTypes` | Array&lt;string&gt;
`findingTypeRegex` | Array&lt;string&gt;
`findingValueRegex` | Array&lt;string&gt;
`matchCount` | number
`newMatchCount` | number
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { InquiryResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "cases": null,
  "title": null,
  "description": null,
  "status": null,
  "aiMode": null,
  "createdBy": null,
  "matchAllSources": null,
  "sourceIds": null,
  "detectorTypes": null,
  "customDetectorKeys": null,
  "findingTypes": null,
  "findingTypeRegex": null,
  "findingValueRegex": null,
  "matchCount": null,
  "newMatchCount": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies InquiryResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as InquiryResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


