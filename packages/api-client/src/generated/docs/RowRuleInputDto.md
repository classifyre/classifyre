
# RowRuleInputDto


## Properties

Name | Type
------------ | -------------
`id` | string
`principalRef` | string
`conditions` | [Array&lt;RowConditionDto&gt;](RowConditionDto.md)

## Example

```typescript
import type { RowRuleInputDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "principalRef": group:9f2c…,
  "conditions": null,
} satisfies RowRuleInputDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RowRuleInputDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


