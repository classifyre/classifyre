
# AssetFindingSummaryDto


## Properties

Name | Type
------------ | -------------
`assetId` | string
`asset` | [AssetResponseDto](AssetResponseDto.md)
`source` | [SourceResponseDto](SourceResponseDto.md)
`totalFindings` | number
`lastDetectedAt` | Date
`highestSeverity` | string
`detectorCounts` | [Array&lt;AssetFindingDetectorCountDto&gt;](AssetFindingDetectorCountDto.md)
`severityCounts` | [Array&lt;AssetFindingSeverityCountDto&gt;](AssetFindingSeverityCountDto.md)
`statusCounts` | [Array&lt;AssetFindingStatusCountDto&gt;](AssetFindingStatusCountDto.md)
`findingTypeCounts` | [Array&lt;AssetFindingTypeCountDto&gt;](AssetFindingTypeCountDto.md)

## Example

```typescript
import type { AssetFindingSummaryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetId": null,
  "asset": null,
  "source": null,
  "totalFindings": null,
  "lastDetectedAt": null,
  "highestSeverity": null,
  "detectorCounts": null,
  "severityCounts": null,
  "statusCounts": null,
  "findingTypeCounts": null,
} satisfies AssetFindingSummaryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AssetFindingSummaryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


