
# CreateSharedDatasetDto


## Properties

Name | Type
------------ | -------------
`name` | string
`domain` | string
`description` | string
`sql` | string
`owningGroupId` | string
`audience` | [Array&lt;SharedDatasetAudienceDto&gt;](SharedDatasetAudienceDto.md)

## Example

```typescript
import type { CreateSharedDatasetDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "name": orders_by_region,
  "domain": sales,
  "description": null,
  "sql": null,
  "owningGroupId": null,
  "audience": null,
} satisfies CreateSharedDatasetDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreateSharedDatasetDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


