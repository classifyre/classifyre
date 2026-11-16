
# AssetRowRuleDto


## Properties

Name | Type
------------ | -------------
`id` | string
`principalRef` | string
`principal` | [GovernancePrincipalDto](GovernancePrincipalDto.md)
`conditions` | [Array&lt;RowConditionDto&gt;](RowConditionDto.md)
`updatedAt` | Date
`updatedBy` | string

## Example

```typescript
import type { AssetRowRuleDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "principalRef": group:9f2c…,
  "principal": null,
  "conditions": null,
  "updatedAt": null,
  "updatedBy": null,
} satisfies AssetRowRuleDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AssetRowRuleDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


