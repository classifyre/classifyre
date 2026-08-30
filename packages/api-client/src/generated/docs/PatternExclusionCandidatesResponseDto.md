
# PatternExclusionCandidatesResponseDto


## Properties

Name | Type
------------ | -------------
`patternKey` | string
`ruleKind` | string
`candidates` | [Array&lt;PatternExclusionCandidateDto&gt;](PatternExclusionCandidateDto.md)
`totalCandidates` | number
`pairsDriven` | number
`truncated` | boolean
`labelCandidates` | [Array&lt;PatternLabelExclusionCandidateDto&gt;](PatternLabelExclusionCandidateDto.md)
`recommendation` | string

## Example

```typescript
import type { PatternExclusionCandidatesResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "patternKey": null,
  "ruleKind": null,
  "candidates": null,
  "totalCandidates": null,
  "pairsDriven": null,
  "truncated": null,
  "labelCandidates": null,
  "recommendation": null,
} satisfies PatternExclusionCandidatesResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as PatternExclusionCandidatesResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


