
# UpdateAssetRowsDto


## Properties

Name | Type
------------ | -------------
`enabled` | boolean
`rules` | [Array&lt;RowRuleInputDto&gt;](RowRuleInputDto.md)

## Example

```typescript
import type { UpdateAssetRowsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "enabled": null,
  "rules": null,
} satisfies UpdateAssetRowsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UpdateAssetRowsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


