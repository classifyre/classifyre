
# AuditEventDto


## Properties

Name | Type
------------ | -------------
`id` | string
`occurredAt` | Date
`actor` | string
`via` | string
`channel` | string
`capability` | string
`operation` | string
`entityType` | string
`entityId` | string
`entityName` | string
`fields` | Array&lt;string&gt;
`changes` | [Array&lt;AuditChangeDto&gt;](AuditChangeDto.md)
`status` | number

## Example

```typescript
import type { AuditEventDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "occurredAt": null,
  "actor": mcp:2c7b9260-cc88-45f8-9459-defe4a662708,
  "via": mcp-token,
  "channel": null,
  "capability": source.manage,
  "operation": PUT /sources/:id,
  "entityType": sources,
  "entityId": null,
  "entityName": null,
  "fields": null,
  "changes": null,
  "status": null,
} satisfies AuditEventDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AuditEventDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


