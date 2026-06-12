
# MatchOptionsResponseDto


## Properties

Name | Type
------------ | -------------
`sources` | [Array&lt;MatchOptionSourceDto&gt;](MatchOptionSourceDto.md)
`customDetectors` | [Array&lt;MatchOptionCustomDetectorDto&gt;](MatchOptionCustomDetectorDto.md)
`findingTypes` | [Array&lt;MatchOptionFindingTypeDto&gt;](MatchOptionFindingTypeDto.md)

## Example

```typescript
import type { MatchOptionsResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "sources": null,
  "customDetectors": null,
  "findingTypes": null,
} satisfies MatchOptionsResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as MatchOptionsResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


