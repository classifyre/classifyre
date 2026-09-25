
# CaseBoardResponseDto


## Properties

Name | Type
------------ | -------------
`board` | [CaseBoardMetaDto](CaseBoardMetaDto.md)
`items` | [Array&lt;BoardItemDto&gt;](BoardItemDto.md)
`links` | [Array&lt;BoardLinkDto&gt;](BoardLinkDto.md)
`evidence` | [Array&lt;CaseEvidenceDto&gt;](CaseEvidenceDto.md)
`graph` | [GraphResponseDto](GraphResponseDto.md)
`supports` | [Array&lt;BoardSupportDto&gt;](BoardSupportDto.md)
`threads` | [Array&lt;BoardThreadSummaryDto&gt;](BoardThreadSummaryDto.md)

## Example

```typescript
import type { CaseBoardResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "board": null,
  "items": null,
  "links": null,
  "evidence": null,
  "graph": null,
  "supports": null,
  "threads": null,
} satisfies CaseBoardResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseBoardResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


