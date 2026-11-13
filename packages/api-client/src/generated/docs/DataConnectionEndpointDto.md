
# DataConnectionEndpointDto


## Properties

Name | Type
------------ | -------------
`enabled` | boolean
`host` | string
`port` | number
`database` | string
`sslMode` | string
`caCertificate` | string

## Example

```typescript
import type { DataConnectionEndpointDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "enabled": null,
  "host": null,
  "port": null,
  "database": null,
  "sslMode": null,
  "caCertificate": null,
} satisfies DataConnectionEndpointDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DataConnectionEndpointDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


