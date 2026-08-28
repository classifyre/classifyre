
# ReviewDecisionRowDto


## Properties

Name | Type
------------ | -------------
`aId` | string
`bId` | string
`aName` | string
`bName` | string
`verdict` | string
`patternKey` | string
`scoreAtVerdict` | number
`currentScore` | number
`stale` | boolean
`decidedByKind` | string
`decidedAt` | string
`caseId` | string
`inquiryId` | string
`note` | string

## Example

```typescript
import type { ReviewDecisionRowDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "aId": null,
  "bId": null,
  "aName": null,
  "bName": null,
  "verdict": null,
  "patternKey": null,
  "scoreAtVerdict": null,
  "currentScore": null,
  "stale": null,
  "decidedByKind": null,
  "decidedAt": null,
  "caseId": null,
  "inquiryId": null,
  "note": null,
} satisfies ReviewDecisionRowDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ReviewDecisionRowDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


