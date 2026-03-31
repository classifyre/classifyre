
# CustomDetectorExampleDto


## Properties

Name | Type
------------ | -------------
`name` | string
`method` | string
`description` | string
`config` | { [key: string]: any; }

## Example

```typescript
import type { CustomDetectorExampleDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "name": null,
  "method": null,
  "description": null,
  "config": null,
} satisfies CustomDetectorExampleDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CustomDetectorExampleDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


