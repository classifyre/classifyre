
# CustomDetectorResponseDto


## Properties

Name | Type
------------ | -------------
`id` | string
`key` | string
`name` | string
`description` | string
`method` | string
`isActive` | boolean
`version` | number
`config` | { [key: string]: any; }
`lastTrainedAt` | Date
`lastTrainingSummary` | { [key: string]: any; }
`latestTrainingRun` | [CustomDetectorTrainingRunDto](CustomDetectorTrainingRunDto.md)
`findingsCount` | number
`sourcesUsingCount` | number
`sourcesWithFindingsCount` | number
`recentSourceNames` | Array&lt;string&gt;
`sourcesUsing` | [Array&lt;CustomDetectorResponseDtoSourcesUsingInner&gt;](CustomDetectorResponseDtoSourcesUsingInner.md)
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { CustomDetectorResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "key": null,
  "name": null,
  "description": null,
  "method": null,
  "isActive": null,
  "version": null,
  "config": null,
  "lastTrainedAt": null,
  "lastTrainingSummary": null,
  "latestTrainingRun": null,
  "findingsCount": null,
  "sourcesUsingCount": null,
  "sourcesWithFindingsCount": null,
  "recentSourceNames": null,
  "sourcesUsing": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies CustomDetectorResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CustomDetectorResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


