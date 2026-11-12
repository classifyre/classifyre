
# AssetUsageDto


## Properties

Name | Type
------------ | -------------
`days` | number
`reads` | number
`exports` | number
`readers` | number
`perDay` | [Array&lt;UsageDayDto&gt;](UsageDayDto.md)
`topReaders` | [Array&lt;UsageReaderDto&gt;](UsageReaderDto.md)
`exportsByFormat` | [Array&lt;UsageFormatDto&gt;](UsageFormatDto.md)

## Example

```typescript
import type { AssetUsageDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "days": null,
  "reads": null,
  "exports": null,
  "readers": null,
  "perDay": null,
  "topReaders": null,
  "exportsByFormat": null,
} satisfies AssetUsageDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AssetUsageDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


