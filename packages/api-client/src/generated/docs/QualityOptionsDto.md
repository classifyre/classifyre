
# QualityOptionsDto


## Properties

Name | Type
------------ | -------------
`table` | string
`columns` | [Array&lt;QualityOptionColumnDto&gt;](QualityOptionColumnDto.md)
`rowCount` | number
`lastScannedAt` | Date
`openFindings` | number
`detectorTypes` | [Array&lt;QualityOptionCountDto&gt;](QualityOptionCountDto.md)
`customDetectors` | [Array&lt;QualityOptionCountDto&gt;](QualityOptionCountDto.md)
`findingTypes` | [Array&lt;QualityOptionCountDto&gt;](QualityOptionCountDto.md)
`categories` | [Array&lt;QualityOptionCountDto&gt;](QualityOptionCountDto.md)
`columnsWithFindings` | [Array&lt;QualityOptionCountDto&gt;](QualityOptionCountDto.md)

## Example

```typescript
import type { QualityOptionsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "table": null,
  "columns": null,
  "rowCount": null,
  "lastScannedAt": null,
  "openFindings": null,
  "detectorTypes": null,
  "customDetectors": null,
  "findingTypes": null,
  "categories": null,
  "columnsWithFindings": null,
} satisfies QualityOptionsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QualityOptionsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


