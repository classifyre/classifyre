
# MatchOptionCustomDetectorDto


## Properties

Name | Type
------------ | -------------
`key` | string
`name` | string
`answerDimension` | string
`suggestedMatcher` | string
`findingTypes` | Array&lt;string&gt;
`openFindings` | number
`pipelineType` | string

## Example

```typescript
import type { MatchOptionCustomDetectorDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "key": null,
  "name": null,
  "answerDimension": null,
  "suggestedMatcher": null,
  "findingTypes": null,
  "openFindings": null,
  "pipelineType": null,
} satisfies MatchOptionCustomDetectorDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as MatchOptionCustomDetectorDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


