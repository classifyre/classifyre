
# BulkUpdateSourcesDto


## Properties

Name | Type
------------ | -------------
`ids` | Array&lt;string&gt;
`filters` | [SearchSourcesFiltersDto](SearchSourcesFiltersDto.md)
`schedule` | [BulkUpdateSourcesScheduleDto](BulkUpdateSourcesScheduleDto.md)
`sampling` | [BulkUpdateSourcesSamplingDto](BulkUpdateSourcesSamplingDto.md)

## Example

```typescript
import type { BulkUpdateSourcesDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "ids": null,
  "filters": null,
  "schedule": null,
  "sampling": null,
} satisfies BulkUpdateSourcesDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BulkUpdateSourcesDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


