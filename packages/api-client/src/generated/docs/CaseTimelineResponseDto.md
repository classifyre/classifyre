
# CaseTimelineResponseDto


## Properties

Name | Type
------------ | -------------
`items` | [Array&lt;CaseActivityDto&gt;](CaseActivityDto.md)
`nextCursor` | string

## Example

```typescript
import type { CaseTimelineResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "items": null,
  "nextCursor": null,
} satisfies CaseTimelineResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseTimelineResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


