
# RerunSandboxRunDto


## Properties

Name | Type
------------ | -------------
`detectors` | Array&lt;string&gt;
`skipDuplicateCheck` | boolean

## Example

```typescript
import type { RerunSandboxRunDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "detectors": [{"type":"SECRETS","enabled":true,"config":{}}],
  "skipDuplicateCheck": null,
} satisfies RerunSandboxRunDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RerunSandboxRunDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


