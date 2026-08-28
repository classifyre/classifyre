
# ReviewPortfolioResponseDto


## Properties

Name | Type
------------ | -------------
`patterns` | [Array&lt;ReviewPatternDto&gt;](ReviewPatternDto.md)
`sources` | [ReviewSourceGraphDto](ReviewSourceGraphDto.md)
`totalPairs` | number
`decidedPairs` | number
`decidedByAgent` | number
`assetsAffected` | number
`totalAssets` | number
`relatedMin` | number
`duplicateMin` | number
`computedAt` | string
`lineageHairball` | boolean

## Example

```typescript
import type { ReviewPortfolioResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "patterns": null,
  "sources": null,
  "totalPairs": null,
  "decidedPairs": null,
  "decidedByAgent": null,
  "assetsAffected": null,
  "totalAssets": null,
  "relatedMin": null,
  "duplicateMin": null,
  "computedAt": null,
  "lineageHairball": null,
} satisfies ReviewPortfolioResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ReviewPortfolioResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


